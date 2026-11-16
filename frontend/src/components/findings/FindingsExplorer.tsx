"use client";

import { ArrowUpRight, Search, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Badge, PriorityBadge, SeverityBadge, TriageBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Input, Select } from "@/components/ui/Field";
import { ChipGroup, EmptyState, ErrorState, Pagination, Segmented, TabLoader } from "@/components/ui/Misc";
import { PRIORITIES, SEVERITIES, SEVERITY_LABEL } from "@/lib/constants";
import { tabQuery, useDebounced, useMountFetch } from "@/lib/hooks";
import { cn, formatDate } from "@/lib/utils";
import { useGetFindingsQuery } from "@/store/api";
import type { Finding, Priority, Severity } from "@/types/api";

import { FindingDrawer } from "./FindingDrawer";

type StatusView = "active" | "all" | "closed";
const STATUS_PARAMS: Record<StatusView, string[]> = { active: ["open", "confirmed"], all: [], closed: ["false_positive", "accepted_risk", "fixed"] };
const PAGE_SIZE = 25;

export type FindingFilters = { severity?: Severity[]; priority?: Priority[]; view?: StatusView; search?: string };

type Props = {
  /** Locks the list to a project or scan (e.g. inside a project page). */
  fixed?: { project?: string; scan?: string };
  initial?: FindingFilters;
  showProject?: boolean;
};

export function FindingsExplorer({ fixed, initial, showProject = false }: Props) {
  const [severity, setSeverity] = useState<Severity[]>(initial?.severity ?? []);
  const [priority, setPriority] = useState<Priority[]>(initial?.priority ?? []);
  const [view, setView] = useState<StatusView>(initial?.view ?? "active");
  const [source, setSource] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);
  const [search, setSearch] = useState(initial?.search ?? "");
  const [ordering, setOrdering] = useState("-risk_score");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const debouncedSearch = useDebounced(search);

  const reset = <T,>(setter: (value: T) => void) => (value: T) => (setter(value), setPage(1));

  const { data, isFetching, isLoading, isUninitialized, error, refetch } = useGetFindingsQuery(
    {
      ...fixed,
      severity, priority, triage_status: STATUS_PARAMS[view], source_type: source, is_new: onlyNew ? "true" : undefined,
      search: debouncedSearch, ordering, page, page_size: PAGE_SIZE,
    },
    tabQuery,
  );
  const pending = useMountFetch(isFetching, isUninitialized);

  const columns: Column<Finding>[] = [
    { key: "severity", header: "Severity", sortKey: "severity", cell: (f) => <SeverityBadge severity={f.severity} /> },
    {
      key: "issue",
      header: "Issue",
      className: "max-w-[340px]",
      cell: (f) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{f.issue_name}</p>
          <p className="truncate font-mono text-xs text-muted" title={f.location}>{f.location || "—"}</p>
        </div>
      ),
    },
    ...(showProject ? [{ key: "project", header: "Project", hideBelow: "lg" as const, cell: (f: Finding) => <span className="text-muted">{f.project_name}</span> }] : []),
    { key: "priority", header: "Priority", sortKey: "priority", cell: (f) => <PriorityBadge priority={f.priority} /> },
    { key: "risk", header: "Risk", sortKey: "risk_score", hideBelow: "md", cell: (f) => <span className="tabular-nums">{f.risk_score}</span> },
    { key: "status", header: "Status", hideBelow: "sm", cell: (f) => <div className="flex items-center gap-1.5"><TriageBadge status={f.triage_status} />{f.is_new && <Badge tone="high">New</Badge>}</div> },
    { key: "engines", header: "Found by", hideBelow: "lg", cell: (f) => <span className="text-xs text-muted">{f.detected_by.join(" + ")}</span> },
    { key: "due", header: "Fix by", sortKey: "fix_due_date", hideBelow: "lg", cell: (f) => <span className={cn("whitespace-nowrap text-xs", f.fix_due_date && new Date(f.fix_due_date) < new Date() && f.triage_status === "open" ? "font-semibold text-critical" : "text-muted")}>{f.fix_due_date ? formatDate(f.fix_due_date, false) : "—"}</span> },
    { key: "open", header: "", className: "w-8", cell: () => <ArrowUpRight className="size-4 text-subtle" aria-hidden /> },
  ];

  if (pending) return <TabLoader label="Loading findings" />;

  return (
    <>
      <Card padded={false}>
        <div className="space-y-4 border-b border-border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-56 flex-1">
              <Input aria-label="Search findings" placeholder="Search by issue, file, URL, CWE…" icon={<Search className="size-4" />} value={search} onChange={(e) => reset(setSearch)(e.target.value)} />
            </div>
            <Segmented label="Status filter" value={view} onChange={reset(setView)} items={[{ value: "active", label: "Active" }, { value: "closed", label: "Closed" }, { value: "all", label: "All" }]} />
            <div className="w-40">
              <Select aria-label="Source type" value={source} onChange={(e) => reset(setSource)(e.target.value)}>
                <option value="">All sources</option>
                <option value="code">Source code</option>
                <option value="secret">Secrets</option>
                <option value="dependency">Dependencies</option>
                <option value="iac">Infrastructure</option>
                <option value="dast">Runtime (DAST)</option>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <ChipGroup label="Severity" selected={severity} onChange={reset(setSeverity)} options={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))} />
            <ChipGroup label="Priority" selected={priority} onChange={reset(setPriority)} options={PRIORITIES.map((p) => ({ value: p, label: p }))} />
            <ChipGroup label="Recency" selected={onlyNew ? ["new"] : []} onChange={(v) => reset(setOnlyNew)(v.length > 0)} options={[{ value: "new", label: "New since last scan" }]} />
          </div>
        </div>

        {error ? (
          <div className="p-4"><ErrorState message="Could not load findings." onRetry={refetch} /></div>
        ) : (
          <div className={cn("transition-opacity", isFetching && !isLoading && "opacity-60")}>
            <DataTable
              columns={columns}
              rows={data?.results}
              rowKey={(f) => f.id}
              loading={isLoading}
              ordering={ordering}
              onOrderingChange={reset(setOrdering)}
              onRowClick={(f) => setSelected(f.id)}
              rowLabel={(f) => `Open finding ${f.issue_name}`}
              empty={<EmptyState icon={<ShieldCheck className="size-7" />} title="No findings match" description="Nothing to fix here, or try widening your filters." />}
            />
            <Pagination page={page} count={data?.count ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
          </div>
        )}
      </Card>
      <FindingDrawer findingId={selected} onClose={() => setSelected(null)} />
    </>
  );
}
