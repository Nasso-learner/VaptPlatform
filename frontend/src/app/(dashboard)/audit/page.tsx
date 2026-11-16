"use client";

import { ScrollText, Search } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Card, PageHeader } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Input, Select } from "@/components/ui/Field";
import { EmptyState, ErrorState, Pagination } from "@/components/ui/Misc";
import { useDebounced } from "@/lib/hooks";
import { formatDate } from "@/lib/utils";
import { useGetAuditLogsQuery } from "@/store/api";
import type { AuditLog } from "@/types/api";

const PAGE_SIZE = 25;
const GROUPS = ["auth", "user", "project", "member", "scan", "finding", "report", "schedule"];
const tone = (action: string) => (action.includes("delete") || action.includes("remove") || action.includes("fail") ? "critical" : action.includes("create") || action.includes("add") ? "primary" : "neutral");

const columns: Column<AuditLog>[] = [
  { key: "when", header: "When", sortKey: "created_at", cell: (l) => <span className="whitespace-nowrap text-muted">{formatDate(l.created_at)}</span> },
  { key: "actor", header: "Actor", cell: (l) => <span className="font-medium">{l.actor_email || "System"}</span> },
  { key: "action", header: "Action", sortKey: "action", cell: (l) => <Badge tone={tone(l.action)}>{l.action}</Badge> },
  { key: "target", header: "Target", className: "max-w-[320px]", cell: (l) => <div className="min-w-0"><p className="truncate">{l.target_label || l.target_type || "—"}</p>{l.project_name && <p className="truncate text-xs text-muted">{l.project_name}</p>}</div> },
  { key: "ip", header: "IP", hideBelow: "lg", cell: (l) => <span className="font-mono text-xs text-muted">{l.ip_address ?? "—"}</span> },
];

export default function AuditPage() {
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [ordering, setOrdering] = useState("-created_at");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const back = <T,>(set: (v: T) => void) => (v: T) => (set(v), setPage(1));
  const { data, isLoading, error, refetch } = useGetAuditLogsQuery({ search: debounced, action_prefix: group, ordering, page, page_size: PAGE_SIZE });

  return (
    <>
      <PageHeader title="Audit log" description="A record of who did what. Secrets are never stored. Administrators see everything; project owners see their projects." />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="min-w-56 flex-1"><Input aria-label="Search audit log" icon={<Search className="size-4" />} placeholder="Search actor, action or target…" value={search} onChange={(e) => back(setSearch)(e.target.value)} /></div>
          <div className="w-44"><Select aria-label="Category" value={group} onChange={(e) => back(setGroup)(e.target.value)}><option value="">All activity</option>{GROUPS.map((g) => <option key={g} value={g}>{g[0].toUpperCase() + g.slice(1)}</option>)}</Select></div>
        </div>
        {error ? (
          <div className="p-4"><ErrorState message="Could not load the audit log." onRetry={refetch} /></div>
        ) : (
          <>
            <DataTable columns={columns} rows={data?.results} rowKey={(l) => l.id} loading={isLoading} ordering={ordering} onOrderingChange={back(setOrdering)} empty={<EmptyState icon={<ScrollText className="size-7" />} title="No activity found" />} />
            <Pagination page={page} count={data?.count ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
