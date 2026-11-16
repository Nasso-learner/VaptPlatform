"use client";

import { Code2, Globe, ScanSearch } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Badge, GradeBadge, StatusBadge } from "@/components/ui/Badge";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/Misc";
import { formatDuration, timeAgo } from "@/lib/utils";
import type { Scan, ScanType } from "@/types/api";

export const ScanTypeBadge = ({ type }: { type: ScanType }) => (
  <Badge tone={type === "sast" ? "primary" : "low"}>
    {type === "sast" ? <Code2 className="size-3" /> : <Globe className="size-3" />}
    {type.toUpperCase()}
  </Badge>
);

type Props = {
  scans: Scan[] | undefined;
  loading?: boolean;
  showProject?: boolean;
  ordering?: string;
  onOrderingChange?: (ordering: string) => void;
  empty?: ReactNode;
};

export function ScanTable({ scans, loading, showProject = true, ordering, onOrderingChange, empty }: Props) {
  const router = useRouter();
  const columns: Column<Scan>[] = [
    ...(showProject ? [{ key: "project", header: "Project", cell: (s: Scan) => <span className="font-medium">{s.project_name}</span> }] : []),
    { key: "type", header: "Type", cell: (s) => <ScanTypeBadge type={s.scan_type} /> },
    {
      key: "status",
      header: "Status",
      cell: (s) => (
        <div className="space-y-1.5">
          <StatusBadge status={s.status} />
          {s.status !== "completed" && s.status !== "failed" && s.status !== "cancelled" && (
            <div className="h-1 w-24 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${s.progress_percent}%` }} />
            </div>
          )}
        </div>
      ),
    },
    { key: "grade", header: "Grade", sortKey: "risk_score", cell: (s) => <GradeBadge grade={s.risk_grade} /> },
    {
      key: "findings",
      header: "Findings",
      sortKey: "findings_count",
      cell: (s) => (
        <span className="tabular-nums">
          {s.findings_count}
          {s.new_findings_count > 0 && <span className="ml-1.5 text-xs text-high">+{s.new_findings_count} new</span>}
        </span>
      ),
    },
    { key: "duration", header: "Duration", hideBelow: "lg", cell: (s) => <span className="text-muted">{formatDuration(s.duration_seconds)}</span> },
    { key: "by", header: "Started by", hideBelow: "lg", cell: (s) => <span className="text-muted">{s.triggered_by ?? "Scheduler"}</span> },
    { key: "when", header: "When", sortKey: "created_at", cell: (s) => <span className="whitespace-nowrap text-muted">{timeAgo(s.created_at)}</span> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={scans}
      rowKey={(s) => s.id}
      loading={loading}
      ordering={ordering}
      onOrderingChange={onOrderingChange}
      onRowClick={(s) => router.push(`/scans/${s.id}`)}
      rowLabel={(s) => `Open ${s.scan_type.toUpperCase()} scan of ${s.project_name}`}
      empty={empty ?? <EmptyState icon={<ScanSearch className="size-7" />} title="No scans yet" description="Run a scan from a project to see results here." />}
    />
  );
}
