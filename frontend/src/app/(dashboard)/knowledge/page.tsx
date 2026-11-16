"use client";

import { BookOpen, Search } from "lucide-react";
import { useState } from "react";

import { PriorityBadge } from "@/components/ui/Badge";
import { Card, PageHeader } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { Drawer } from "@/components/ui/Modal";
import { EmptyState, ErrorState, Rise, Skeleton, Stagger } from "@/components/ui/Misc";
import { PRIORITIES } from "@/lib/constants";
import { useDebounced } from "@/lib/hooks";
import { useGetKnowledgeQuery } from "@/store/api";
import type { VulnerabilityClass } from "@/types/api";

export default function KnowledgePage() {
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("");
  const [selected, setSelected] = useState<VulnerabilityClass | null>(null);
  const debounced = useDebounced(search);
  const { data, isLoading, error, refetch } = useGetKnowledgeQuery({ search: debounced, base_priority: priority });

  return (
    <>
      <PageHeader title="Knowledge base" description="Plain-language explanations and fix guidance for every vulnerability class the platform detects." />
      <div className="mb-5 flex flex-wrap gap-3">
        <div className="min-w-56 flex-1"><Input aria-label="Search knowledge base" icon={<Search className="size-4" />} placeholder="Search SQL injection, XSS, secrets…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="w-44">
          <Select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </div>
      </div>

      {error ? (
        <ErrorState message="Could not load the knowledge base." onRetry={refetch} />
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
      ) : !data?.results.length ? (
        <Card><EmptyState icon={<BookOpen className="size-7" />} title="Nothing matches" description="Try a different search." /></Card>
      ) : (
        <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.results.map((item) => (
            <Rise key={item.id}>
              <button type="button" onClick={() => setSelected(item)} className="block h-full w-full rounded-2xl text-left">
                <Card interactive className="h-full">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-accent">{item.issue_category_label}</span>
                    <PriorityBadge priority={item.base_priority} />
                  </div>
                  <h3 className="font-semibold">{item.name}</h3>
                  <p className="mt-1 line-clamp-3 text-sm text-muted">{item.explanation}</p>
                  <p className="mt-3 text-xs text-subtle">{[item.owasp_category, ...item.cwe_ids].filter(Boolean).join(" · ")}</p>
                </Card>
              </button>
            </Rise>
          ))}
        </Stagger>
      )}

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? ""} description={selected?.issue_category_label}>
        {selected && (
          <div className="space-y-6 text-sm leading-relaxed">
            <div className="flex flex-wrap gap-2 text-xs text-muted"><PriorityBadge priority={selected.base_priority} />{selected.owasp_category && <span>{selected.owasp_category}</span>}{selected.cwe_ids.map((c) => <span key={c}>{c}</span>)}</div>
            <section><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">What it is</h3><p>{selected.explanation}</p></section>
            <section><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Business impact</h3><p>{selected.business_impact}</p></section>
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">How to fix</h3>
              <ol className="list-decimal space-y-1 pl-5 text-muted">{selected.remediation_steps.map((s) => <li key={s}>{s}</li>)}</ol>
            </section>
            {selected.references.length > 0 && (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">References</h3>
                <ul className="space-y-1">{selected.references.map((r) => <li key={r}>{/^https?:\/\//.test(r) ? <a href={r} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">{r}</a> : <span className="text-muted">{r}</span>}</li>)}</ul>
              </section>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
