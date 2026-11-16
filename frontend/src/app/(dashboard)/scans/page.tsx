"use client";

import { Search } from "lucide-react";
import { useState } from "react";

import { ScanTable } from "@/components/scans/ScanTable";
import { Card, PageHeader } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { ErrorState, Pagination, Segmented } from "@/components/ui/Misc";
import { useDebounced } from "@/lib/hooks";
import { useGetScansQuery } from "@/store/api";
import type { ScanType } from "@/types/api";

const PAGE_SIZE = 20;

export default function ScansPage() {
  const [type, setType] = useState<ScanType | "">("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [ordering, setOrdering] = useState("-created_at");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const back = <T,>(set: (v: T) => void) => (v: T) => (set(v), setPage(1));

  // Poll while the page is open so running scans advance without a refresh.
  const { data, isLoading, error, refetch } = useGetScansQuery({ scan_type: type, status, search: debounced, ordering, page, page_size: PAGE_SIZE }, { pollingInterval: 5000 });

  return (
    <>
      <PageHeader title="Scans" description="Every static and dynamic scan across your projects." />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="min-w-56 flex-1">
            <Input aria-label="Search scans" placeholder="Search by project, target or branch…" icon={<Search className="size-4" />} value={search} onChange={(e) => back(setSearch)(e.target.value)} />
          </div>
          <Segmented label="Scan type" value={type} onChange={back(setType)} items={[{ value: "", label: "All" }, { value: "sast", label: "SAST" }, { value: "dast", label: "DAST" }]} />
          <div className="w-40">
            <Select aria-label="Status" value={status} onChange={(e) => back(setStatus)(e.target.value)}>
              <option value="">Any status</option>
              <option value="completed">Completed</option>
              <option value="scanning">Running</option>
              <option value="queued">Queued</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </div>
        </div>
        {error ? (
          <div className="p-4"><ErrorState message="Could not load scans." onRetry={refetch} /></div>
        ) : (
          <>
            <ScanTable scans={data?.results} loading={isLoading} ordering={ordering} onOrderingChange={back(setOrdering)} />
            <Pagination page={page} count={data?.count ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
