"use client";

import { motion } from "framer-motion";
import { AlarmClock, ArrowRight, Bug, FolderKanban, FolderPlus, Hand, ScanSearch, Siren, Timer, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { ScanTable } from "@/components/scans/ScanTable";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader, PageHeader } from "@/components/ui/Card";
import { BarList, RiskRing, SeverityDonut, TrendChart } from "@/components/ui/Charts";
import { CountUp, EmptyState, ErrorState, Rise, Skeleton, Stagger } from "@/components/ui/Misc";
import { cn, timeAgo, titleCase } from "@/lib/utils";
import { useGetDashboardQuery } from "@/store/api";
import { useAppSelector } from "@/store";

type Tone = "primary" | "critical" | "high" | "low" | "accent";
const TONE: Record<Tone, string> = { primary: "bg-primary-soft text-primary", critical: "bg-critical/12 text-critical", high: "bg-high/12 text-high", low: "bg-low/12 text-low", accent: "bg-accent/12 text-accent" };

function StatCard({ label, value, icon: Icon, tone, href, hint }: { label: string; value: number; icon: LucideIcon; tone: Tone; href: string; hint?: string }) {
  return (
    <Rise>
      <Link href={href} className="block h-full rounded-2xl focus-visible:outline-offset-4">
        <Card interactive className="h-full">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-muted">{label}</p>
              <CountUp value={value} className="mt-2 block text-3xl font-semibold tabular-nums tracking-tight" />
              {hint && <p className="mt-1 text-xs text-subtle">{hint}</p>}
            </div>
            <motion.span whileHover={{ rotate: [0, -12, 12, 0], scale: 1.15 }} className={cn("flex size-10 items-center justify-center rounded-xl", TONE[tone])}>
              <Icon className="size-5" aria-hidden />
            </motion.span>
          </div>
        </Card>
      </Link>
    </Rise>
  );
}

export default function DashboardPage() {
  const user = useAppSelector((state) => state.auth.user);
  const { data, isLoading, error, refetch } = useGetDashboardQuery(undefined, { pollingInterval: 20_000 });
  const firstName = (user?.full_name || user?.email || "").split(/[\s@]/)[0];

  if (error) return <ErrorState message="Could not load the dashboard." onRetry={refetch} />;

  const empty = data && data.cards.projects === 0;

  return (
    <>
      <PageHeader
        title={<>Hello{firstName ? `, ${firstName}` : ""} <motion.span className="inline-block origin-[70%_70%] align-middle text-primary" animate={{ rotate: [0, 16, -8, 14, -4, 0] }} transition={{ duration: 1.4, delay: 0.5 }}><Hand className="size-6" aria-hidden /></motion.span></>}
        description="Your security posture across every project, based on the latest completed scans."
        actions={
          <ButtonLink href="/projects/new" icon={<FolderPlus className="size-4" />}>
            New project
          </ButtonLink>
        }
      />

      {isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : empty ? (
        <Card>
          <EmptyState
            icon={<FolderKanban className="size-7" />}
            title="Create your first project"
            description="Add a repository for static analysis and/or a running application for dynamic testing. Results show up here."
            action={<ButtonLink href="/projects/new" icon={<FolderPlus className="size-4" />}>New project</ButtonLink>}
          />
        </Card>
      ) : (
        <Stagger className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <StatCard label="Projects" value={data.cards.projects} icon={FolderKanban} tone="primary" href="/projects" />
            <StatCard label="Open findings" value={data.cards.open_findings} icon={Bug} tone="high" href="/findings?triage_status=open&triage_status=confirmed" hint="Latest scans" />
            <StatCard label="P1: fix now" value={data.cards.p1_findings} icon={Siren} tone="critical" href="/findings?priority=P1" />
            <StatCard label="Overdue" value={data.cards.overdue_findings} icon={AlarmClock} tone="critical" href="/findings" hint="Past SLA" />
            <StatCard label="Running scans" value={data.cards.scans_running} icon={Timer} tone="low" href="/scans" />
            <StatCard label="Scans, 30 days" value={data.cards.scans_last_30_days} icon={ScanSearch} tone="accent" href="/scans" hint={`${data.cards.scans_total} total`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Rise>
              <Card className="h-full">
                <CardHeader title="Open findings by severity" description="Across the latest completed scans" />
                <SeverityDonut counts={data.severity_totals} />
              </Card>
            </Rise>
            <Rise className="lg:col-span-2">
              <Card className="h-full">
                <CardHeader title="Scan activity" description="Scans started per day, last 30 days" />
                {data.scan_trend.length ? <TrendChart data={data.scan_trend} /> : <p className="py-16 text-center text-sm text-muted">No scans in the last 30 days.</p>}
              </Card>
            </Rise>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Rise>
              <Card className="h-full">
                <CardHeader title="Top issue categories" description="Where most open findings come from" />
                <BarList
                  items={data.issue_category_totals.slice(0, 6).map((row) => ({ label: titleCase(row.vulnerability_class__issue_category ?? "uncategorized"), value: row.count }))}
                  color="var(--accent)"
                />
              </Card>
            </Rise>
            <Rise>
              <Card className="h-full">
                <CardHeader title="Riskiest projects" action={<Link href="/projects" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">All projects <ArrowRight className="size-3" /></Link>} />
                {data.riskiest_projects.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted">Run a scan to see risk scores.</p>
                ) : (
                  <ul className="space-y-1">
                    {data.riskiest_projects.map((project) => (
                      <li key={project.id}>
                        <Link href={`/projects/${project.id}`} className="flex items-center gap-4 rounded-xl p-2 transition-colors hover:bg-surface-2">
                          <RiskRing score={project.latest_risk_score} grade={project.latest_risk_grade} size={52} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{project.name}</p>
                            <p className="text-xs text-muted">
                              {project.open_findings_count} open · scanned {timeAgo(project.last_scanned_at)}
                            </p>
                          </div>
                          <ArrowRight className="size-4 text-subtle" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Rise>
          </div>

          <Rise>
            <Card padded={false}>
              <div className="p-5 pb-0">
                <CardHeader title="Recent scans" action={<Link href="/scans" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">View all <ArrowRight className="size-3" /></Link>} />
              </div>
              <ScanTable scans={data.recent_scans} />
            </Card>
          </Rise>
        </Stagger>
      )}
    </>
  );
}
