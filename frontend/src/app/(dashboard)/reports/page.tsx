"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ReportActions } from "@/components/reports/ReportsPanel";
import { Badge } from "@/components/ui/Badge";
import { Card, PageHeader } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/Field";
import { EmptyState, ErrorState, Pagination } from "@/components/ui/Misc";
import { REPORT_FORMAT_INFO } from "@/lib/constants";
import { formatBytes, timeAgo } from "@/lib/utils";
import { useGetReportsQuery } from "@/store/api";
import type { Report } from "@/types/api";

const PAGE_SIZE = 20;
const TONE = { ready: "primary", failed: "critical", pending: "neutral", generating: "low" } as const;

const columns: Column<Report>[] = [
  { key: "file", header: "Report", cell: (r) => <div className="min-w-0"><p className="truncate font-medium">{REPORT_FORMAT_INFO[r.report_format]?.label ?? r.report_format}</p><p className="truncate text-xs text-muted">{r.filename || "—"}</p></div> },
  { key: "status", header: "Status", cell: (r) => <Badge tone={TONE[r.status]}>{r.status}</Badge> },
  { key: "size", header: "Size", hideBelow: "md", cell: (r) => <span className="text-muted">{r.file_size_bytes ? formatBytes(r.file_size_bytes) : "—"}</span> },
  { key: "when", header: "Generated", hideBelow: "sm", cell: (r) => <span className="whitespace-nowrap text-muted">{timeAgo(r.generated_at)}</span> },
  { key: "scan", header: "Scan", hideBelow: "md", cell: (r) => <Link href={`/scans/${r.scan}`} className="text-primary hover:underline">View scan</Link> },
  { key: "actions", header: "", cell: (r) => <ReportActions report={r} /> },
];

export default function ReportsPage() {
  const [format, setFormat] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useGetReportsQuery({ report_format: format, page, page_size: PAGE_SIZE });

  return (
    <>
      <PageHeader title="Reports" description="Generated automatically when a scan completes. Regenerate from the scan page." />
      <Card padded={false}>
        <div className="flex border-b border-border p-4">
          <div className="w-44">
            <Select aria-label="Format" value={format} onChange={(e) => (setFormat(e.target.value), setPage(1))}>
              <option value="">All formats</option>
              {Object.entries(REPORT_FORMAT_INFO).map(([value, info]) => <option key={value} value={value}>{info.label}</option>)}
            </Select>
          </div>
        </div>
        {error ? (
          <div className="p-4"><ErrorState message="Could not load reports." onRetry={refetch} /></div>
        ) : (
          <>
            <DataTable columns={columns} rows={data?.results} rowKey={(r) => r.id} loading={isLoading} empty={<EmptyState icon={<FileText className="size-7" />} title="No reports yet" description="Reports are created when a scan finishes." />} />
            <Pagination page={page} count={data?.count ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
