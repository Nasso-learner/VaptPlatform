"use client";

import { motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, Ban, Check, Cpu, GitCommitHorizontal, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";

import { FindingsExplorer } from "@/components/findings/FindingsExplorer";
import { ReportsPanel } from "@/components/reports/ReportsPanel";
import { ScanTypeBadge } from "@/components/scans/ScanTable";
import { Badge, PriorityBadge, SeverityBadge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, PageHeader } from "@/components/ui/Card";
import { BarList, RiskRing, SeverityDonut } from "@/components/ui/Charts";
import { ConfirmDialog } from "@/components/ui/Modal";
import { EmptyState, ErrorState, Rise, Skeleton, Stagger, TabLoader, Tabs } from "@/components/ui/Misc";
import { PRIORITIES, PRIORITY_LABEL, SCAN_STAGES, isActiveScan } from "@/lib/constants";
import { tabQuery, useMountFetch, useRefetchOnMount } from "@/lib/hooks";
import { bounce } from "@/lib/motion";
import { apiError, cn, formatDate, formatDuration, hasRole, titleCase } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useCancelScanMutation, useGetProjectQuery, useGetReportsQuery, useGetScanDiffQuery, useGetScanQuery, useGetScanSummaryQuery } from "@/store/api";
import type { ScanDetail } from "@/types/api";

type Tab = "overview" | "findings" | "changes" | "engines" | "reports";

function Stepper({ scan }: { scan: ScanDetail }) {
  const currentIndex = SCAN_STAGES.findIndex((s) => s.status === scan.status);
  const failed = scan.status === "failed" || scan.status === "cancelled";
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-semibold">{failed ? (scan.status === "failed" ? "Scan failed" : "Scan cancelled") : scan.status === "completed" ? "Scan complete" : "Scan in progress"}</p>
        <span className="text-sm tabular-nums text-muted">{scan.progress_percent}%</span>
      </div>
      <div className="mb-5 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={scan.progress_percent} aria-valuemin={0} aria-valuemax={100}>
        <motion.div className={cn("h-full rounded-full", failed ? "bg-critical" : "bg-primary")} initial={false} animate={{ width: `${scan.progress_percent}%` }} transition={{ type: "spring", stiffness: 120, damping: 18 }} />
      </div>
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-9">
        {SCAN_STAGES.map((stage, index) => {
          const done = scan.status === "completed" || (!failed && index < currentIndex);
          const current = !failed && index === currentIndex && scan.status !== "completed";
          return (
            <li key={stage.status} className="flex flex-col items-center gap-1.5 text-center">
              <motion.span
                animate={current ? { scale: [1, 1.18, 1] } : { scale: 1 }}
                transition={current ? { duration: 1.2, repeat: Infinity } : bounce}
                className={cn("flex size-7 items-center justify-center rounded-full border text-xs font-semibold", done ? "border-primary bg-primary text-primary-foreground" : current ? "border-primary text-primary" : "border-border text-subtle")}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : index + 1}
              </motion.span>
              <span className={cn("text-[11px]", current ? "font-semibold text-foreground" : "text-muted")}>{stage.label}</span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Overview({ scanId, done }: { scanId: string; done: boolean }) {
  const { data, isFetching, isUninitialized, isError, refetch } = useGetScanSummaryQuery(scanId, tabQuery);
  const pending = useMountFetch(isFetching, isUninitialized);
  if (pending || !data) return <TabLoader label="Loading overview" />;
  if (isError) return <ErrorState message="Could not load the scan summary." onRetry={refetch} />;
  if (!done) return <Card><EmptyState icon={<Cpu className="size-7" />} title="Results will appear here" description="Summary charts are available once the scan completes." /></Card>;
  const categories = data.issue_categories.filter((c) => c.total > 0);
  return (
    <Stagger className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Rise>
          <Card className="h-full">
            <CardHeader title="By severity" />
            <SeverityDonut counts={data.severity_counts} size={170} />
          </Card>
        </Rise>
        <Rise>
          <Card className="h-full">
            <CardHeader title="By priority" description="How urgently to act" />
            <ul className="space-y-3">
              {PRIORITIES.map((p) => (
                <li key={p} className="flex items-center gap-3">
                  <PriorityBadge priority={p} />
                  <span className="flex-1 text-sm text-muted">{PRIORITY_LABEL[p]}</span>
                  <span className="text-lg font-semibold tabular-nums">{data.priority_counts[p] ?? 0}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Rise>
        <Rise>
          <Card className="h-full">
            <CardHeader title="By category" />
            {categories.length ? <BarList items={categories.slice(0, 6).map((c) => ({ label: c.issue_category_label, value: c.total, sub: `${c.open} open` }))} color="var(--accent)" /> : <p className="py-8 text-center text-sm text-muted">Nothing found.</p>}
          </Card>
        </Rise>
      </div>
      <Rise>
        <Card>
          <CardHeader title="Top findings" description="Highest risk first. Open the Findings tab for everything." />
          {data.top_findings.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">This scan found no issues.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.top_findings.map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-3">
                  <SeverityBadge severity={f.severity} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{f.issue_name}</p>
                    <p className="truncate font-mono text-xs text-muted">{f.location}</p>
                  </div>
                  <PriorityBadge priority={f.priority} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Rise>
    </Stagger>
  );
}

function Changes({ scanId }: { scanId: string }) {
  const { data, isFetching, isUninitialized, isError, refetch } = useGetScanDiffQuery(scanId, tabQuery);
  const pending = useMountFetch(isFetching, isUninitialized);
  if (pending || !data) return <TabLoader label="Loading changes" />;
  if (isError) return <ErrorState message="Could not compare this scan." onRetry={refetch} />;
  if (!data.previous_scan) return <Card><EmptyState icon={<GitCommitHorizontal className="size-7" />} title="First scan of this target" description="Run another scan to see what was introduced and what was fixed." /></Card>;
  const groups = [
    { key: "new", label: "New since previous scan", icon: Plus, tone: "text-high", rows: data.new },
    { key: "fixed", label: "Fixed since previous scan", icon: Minus, tone: "text-primary", rows: data.fixed },
  ] as const;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Compared with the previous scan from {formatDate(data.previous_scan_created_at)}. {data.unchanged_count} issue{data.unchanged_count === 1 ? "" : "s"} unchanged.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        {groups.map(({ key, label, icon: Icon, tone, rows }) => (
          <Card key={key}>
            <CardHeader title={<span className={cn("flex items-center gap-2", tone)}><Icon className="size-4" aria-hidden />{label} ({rows.length})</span>} />
            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">None.</p>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 py-2.5">
                    <SeverityBadge severity={f.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{f.issue_name}</p>
                      <p className="truncate font-mono text-xs text-muted">{f.location}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function Engines({ scanId }: { scanId: string }) {
  const { data: scan, isFetching, isUninitialized, isError, refetch } = useGetScanQuery(scanId);
  useRefetchOnMount(refetch);
  const pending = useMountFetch(isFetching, isUninitialized);
  if (pending || !scan) return <TabLoader label="Loading engines" />;
  if (isError) return <ErrorState message="Could not load engine runs." onRetry={refetch} />;
  return (
    <Card padded={false}>
      <ul className="divide-y divide-border">
        {scan.engine_runs.length === 0 && <li className="p-8 text-center text-sm text-muted">No engines have run yet.</li>}
        {scan.engine_runs.map((run) => (
          <li key={run.engine} className="flex flex-wrap items-center gap-4 p-4">
            <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-muted"><Cpu className="size-5" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="font-medium capitalize">{run.engine} <span className="text-xs font-normal text-subtle">{run.engine_version}</span></p>
              <p className="text-xs text-muted">{run.status === "failed" ? run.error_message || "Engine failed" : `${run.raw_findings_count} raw finding${run.raw_findings_count === 1 ? "" : "s"} · ${formatDuration(run.duration_ms / 1000)}`}</p>
            </div>
            <Badge tone={run.status === "succeeded" ? "primary" : run.status === "failed" ? "critical" : "low"}>{run.status}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReportsTab({ scanId, canRegenerate }: { scanId: string; canRegenerate: boolean }) {
  const { data, isFetching, isUninitialized, isError, refetch } = useGetReportsQuery({ scan: scanId, page_size: 50 }, tabQuery);
  const pending = useMountFetch(isFetching, isUninitialized);
  if (pending) return <TabLoader label="Loading reports" />;
  if (isError) return <ErrorState message="Could not load reports." onRetry={refetch} />;
  return <ReportsPanel reports={data?.results ?? []} scanId={scanId} canRegenerate={canRegenerate} />;
}

export default function ScanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useAppSelector((state) => state.auth.user);
  const [tab, setTab] = useState<Tab>("overview");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { data: scan, error, refetch } = useGetScanQuery(id);
  const running = !!scan && isActiveScan(scan.status);
  // Poll only while the scan is running.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(refetch, 3000);
    return () => clearInterval(timer);
  }, [running, refetch]);
  const { data: project } = useGetProjectQuery(scan?.project ?? "", { skip: !scan });
  const [cancel, { isLoading: cancelling }] = useCancelScanMutation();

  if (error) return <ErrorState message="This scan could not be loaded. It may have been deleted, or you no longer have access." onRetry={refetch} />;
  if (!scan) return <Skeleton className="h-96 rounded-2xl" />;

  const active = isActiveScan(scan.status);
  const canAct = hasRole(project?.my_role, "analyst", user?.is_staff);
  const done = scan.status === "completed";

  const onCancel = async () => {
    const result = await cancel(id);
    setConfirmCancel(false);
    if ("error" in result) toast.error(apiError(result.error).message);
    else toast.success("Scan cancelled");
  };

  return (
    <>
      <PageHeader
        back={<Link href={`/projects/${scan.project}`} className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"><ArrowLeft className="size-3" aria-hidden />{scan.project_name}</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{scan.scan_type === "sast" ? "Static analysis" : "Dynamic testing"} <ScanTypeBadge type={scan.scan_type} /> <StatusBadge status={scan.status} /></span>}
        description={<>Started {formatDate(scan.created_at)}{scan.triggered_by ? ` by ${scan.triggered_by}` : " by the scheduler"} · {scan.target || "no target"}{scan.branch ? ` @ ${scan.branch}` : ""}{scan.commit_sha ? ` (${scan.commit_sha.slice(0, 8)})` : ""}</>}
        actions={active && canAct ? <Button variant="danger" icon={<Ban className="size-4" />} onClick={() => setConfirmCancel(true)}>Cancel scan</Button> : undefined}
      />

      <div className="space-y-6">
        {!done && <Stepper scan={scan} />}
        {scan.status === "failed" && (
          <div role="alert" className="flex gap-3 rounded-2xl border border-critical/40 bg-critical/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-critical" aria-hidden />
            <div>
              <p className="font-semibold text-critical">The scan could not finish</p>
              <p className="mt-1 text-muted">{scan.error_message || "An unexpected error occurred."}</p>
            </div>
          </div>
        )}

        {done && (
          <Rise>
            <Card className="flex flex-wrap items-center gap-6">
              <RiskRing score={scan.risk_score} grade={scan.risk_grade} size={88} />
              <dl className="grid flex-1 grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
                {[
                  ["Findings", String(scan.findings_count)],
                  ["New", String(scan.new_findings_count)],
                  ["Duration", formatDuration(scan.duration_seconds)],
                  ["Profile", titleCase(scan.configuration.profile ?? "standard")],
                  ["Engines", scan.engines.join(", ")],
                  ["Mode", scan.scan_type === "dast" ? (scan.configuration.active ? "Active" : "Passive") : "Static"],
                  ["Authenticated", scan.scan_type === "dast" ? (scan.configuration.authenticated ? "Yes" : "No") : "n/a"],
                  ["Completed", formatDate(scan.completed_at)],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs text-subtle">{label}</dt>
                    <dd className="mt-0.5 truncate font-medium" title={value}>{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </Rise>
        )}

        {(done || scan.engine_runs.length > 0) && (
          <>
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: "overview", label: "Overview" },
                { value: "findings", label: "Findings", count: scan.findings_count },
                { value: "changes", label: "Changes" },
                { value: "engines", label: "Engines", count: scan.engine_runs.length },
                { value: "reports", label: "Reports", count: scan.reports.length },
              ]}
            />
            <div>
              {tab === "overview" && <Overview scanId={id} done={done} />}
              {tab === "findings" && <FindingsExplorer fixed={{ scan: id }} initial={{ view: "all" }} />}
              {tab === "changes" && <Changes scanId={id} />}
              {tab === "engines" && <Engines scanId={id} />}
              {tab === "reports" && <ReportsTab scanId={id} canRegenerate={canAct && done} />}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog open={confirmCancel} onClose={() => setConfirmCancel(false)} onConfirm={onCancel} loading={cancelling} title="Cancel this scan?" description="Engines stop at the next safe point. Partial results are discarded." confirmLabel="Cancel scan" />
    </>
  );
}
