"use client";

import { PageHeader } from "@/components/ui/Card";
import { SchedulesPanel } from "@/components/schedules/SchedulesPanel";

export default function SchedulesPage() {
  return (
    <>
      <PageHeader title="Schedules" description="Recurring scans that run automatically. Results appear in Scans like any other run." />
      <SchedulesPanel />
    </>
  );
}
