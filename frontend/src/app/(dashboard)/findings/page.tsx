"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { FindingsExplorer, type FindingFilters } from "@/components/findings/FindingsExplorer";
import { PageHeader } from "@/components/ui/Card";
import { PRIORITIES, SEVERITIES } from "@/lib/constants";
import type { Priority, Severity } from "@/types/api";

function Content() {
  const params = useSearchParams();
  const triage = params.getAll("triage_status");
  const initial: FindingFilters = {
    severity: params.getAll("severity").filter((v): v is Severity => (SEVERITIES as readonly string[]).includes(v)),
    priority: params.getAll("priority").filter((v): v is Priority => (PRIORITIES as readonly string[]).includes(v)),
    view: triage.length === 0 ? "all" : triage.includes("open") ? "active" : "closed",
    search: params.get("search") ?? "",
  };
  // Landing here with no filters should show what needs attention.
  if (!params.toString()) initial.view = "active";
  return <FindingsExplorer showProject initial={initial} />;
}

export default function FindingsPage() {
  return (
    <>
      <PageHeader title="Findings" description="Every issue from the latest completed scans, de-duplicated across engines and ranked by risk." />
      <Suspense>
        <Content />
      </Suspense>
    </>
  );
}
