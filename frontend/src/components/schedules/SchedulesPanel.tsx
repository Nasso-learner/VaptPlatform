"use client";

import { CalendarClock, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ScanTypeBadge } from "@/components/scans/ScanTable";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select, Switch } from "@/components/ui/Field";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState, TabLoader } from "@/components/ui/Misc";
import { WEEKDAYS } from "@/lib/constants";
import { tabQuery, useMountFetch } from "@/lib/hooks";
import { apiError, formatDate, hasRole, timeAgo, titleCase } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useCreateScheduleMutation, useDeleteScheduleMutation, useGetProjectsQuery, useGetSchedulesQuery, useUpdateScheduleMutation } from "@/store/api";
import type { Project, Schedule, ScanProfile, ScanType } from "@/types/api";

const pad = (n: number) => String(n).padStart(2, "0");
const describe = (s: Schedule) => `${s.frequency === "daily" ? "Daily" : `Weekly on ${WEEKDAYS[s.weekday ?? 0]}`} at ${pad(s.hour_utc)}:00 UTC`;

function ScheduleModal({ open, onClose, projects, defaultProject }: { open: boolean; onClose: () => void; projects: Project[]; defaultProject?: string }) {
  const [create, { isLoading }] = useCreateScheduleMutation();
  const [project, setProject] = useState(defaultProject ?? projects[0]?.id ?? "");
  const [scanType, setScanType] = useState<ScanType>("sast");
  const [profile, setProfile] = useState<ScanProfile>("standard");
  const [frequency, setFrequency] = useState<"daily" | "weekly">("weekly");
  const [hour, setHour] = useState(2);
  const [weekday, setWeekday] = useState(0);
  const [error, setError] = useState("");
  const selected = projects.find((p) => p.id === (project || projects[0]?.id));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const result = await create({ project: selected?.id ?? "", scan_type: scanType, profile, frequency, hour_utc: hour, weekday: frequency === "weekly" ? weekday : null });
    if ("error" in result) return setError(apiError(result.error).message);
    toast.success("Schedule created");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="New schedule" description="Scans run automatically on the Celery beat scheduler." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="schedule-form" loading={isLoading} disabled={!selected}>Create schedule</Button></>}>
      <form id="schedule-form" onSubmit={submit} className="space-y-4">
        <Select label="Project" value={selected?.id ?? ""} onChange={(e) => setProject(e.target.value)} disabled={!!defaultProject}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <div className="grid grid-cols-2 gap-4">
          <Select label="Scan type" value={scanType} onChange={(e) => setScanType(e.target.value as ScanType)}>
            <option value="sast" disabled={!selected?.allow_sast}>Static (SAST)</option>
            <option value="dast" disabled={!selected?.allow_dast}>Dynamic (DAST)</option>
          </Select>
          <Select label="Profile" value={profile} onChange={(e) => setProfile(e.target.value as ScanProfile)}>
            <option value="quick">Quick</option>
            <option value="standard">Standard</option>
          </Select>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Select label="Frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as "daily" | "weekly")}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </Select>
          <Select label="Day" disabled={frequency === "daily"} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </Select>
          <Select label="Hour (UTC)" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{pad(h)}:00</option>)}
          </Select>
        </div>
        <p className="text-xs text-muted">Scheduled scans are passive. The target must stay verified, and your role is re-checked on every run.</p>
        {error && <p role="alert" className="rounded-xl border border-critical/40 bg-critical/10 p-3 text-sm text-critical">{error}</p>}
      </form>
    </Modal>
  );
}

export function SchedulesPanel({ projectId }: { projectId?: string }) {
  const user = useAppSelector((state) => state.auth.user);
  const { data, isFetching, isUninitialized, error, refetch } = useGetSchedulesQuery({ project: projectId, page_size: 100 }, tabQuery);
  const { data: projectData, isFetching: projectsFetching, isUninitialized: projectsUninitialized } = useGetProjectsQuery({ page_size: 200, is_archived: false }, tabQuery);
  const pending = useMountFetch(isFetching, isUninitialized);
  const projectsPending = useMountFetch(projectsFetching, projectsUninitialized);
  const [update] = useUpdateScheduleMutation();
  const [remove, { isLoading: removing }] = useDeleteScheduleMutation();
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<Schedule | null>(null);

  const projects = useMemo(() => (projectData?.results ?? []).filter((p) => (!projectId || p.id === projectId) && hasRole(p.my_role, "analyst", user?.is_staff)), [projectData, projectId, user?.is_staff]);
  const writable = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);

  const toggle = async (schedule: Schedule, is_enabled: boolean) => {
    const result = await update({ id: schedule.id, body: { is_enabled } });
    if ("error" in result) toast.error(apiError(result.error).message);
  };
  const onDelete = async () => {
    if (!toDelete) return;
    const result = await remove(toDelete.id);
    setToDelete(null);
    if ("error" in result) toast.error(apiError(result.error).message);
    else toast.success("Schedule deleted");
  };

  if (pending || projectsPending) return <TabLoader label="Loading schedules" />;
  if (error) return <ErrorState message="Could not load schedules." onRetry={refetch} />;

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)} disabled={projects.length === 0}>New schedule</Button>
      </div>
      <Card padded={false}>
        {!data?.results.length ? (
          <EmptyState icon={<CalendarClock className="size-7" />} title="No schedules yet" description="Run scans automatically every day or week to catch regressions early." action={projects.length ? <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New schedule</Button> : undefined} />
        ) : (
          <ul className="divide-y divide-border">
            {data.results.map((schedule) => (
              <li key={schedule.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {!projectId && <Link href={`/projects/${schedule.project}`} className="font-medium hover:text-primary">{schedule.project_name}</Link>}
                    <ScanTypeBadge type={schedule.scan_type} />
                    <Badge>{titleCase(schedule.profile)}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">{describe(schedule)}</p>
                  <p className="mt-0.5 text-xs text-subtle">
                    {schedule.is_enabled ? `Next run ${formatDate(schedule.next_run_at)}` : "Paused"}
                    {schedule.last_run_at && ` · last run ${timeAgo(schedule.last_run_at)}`}
                  </p>
                </div>
                {schedule.last_scan && (
                  <Link href={`/scans/${schedule.last_scan}`} className="flex items-center gap-2 text-xs text-muted hover:text-foreground">
                    Last scan {schedule.last_scan_status && <StatusBadge status={schedule.last_scan_status} />}
                  </Link>
                )}
                {schedule.last_result && !schedule.last_scan && <span className="max-w-60 truncate text-xs text-medium" title={schedule.last_result}>{schedule.last_result}</span>}
                {writable.has(schedule.project) && (
                  <div className="flex items-center gap-2">
                    <Switch checked={schedule.is_enabled} onChange={(v) => toggle(schedule, v)} label={schedule.is_enabled ? "Enabled" : "Paused"} />
                    <IconButton label="Delete schedule" variant="ghost" onClick={() => setToDelete(schedule)}><Trash2 className="size-4" /></IconButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating && <ScheduleModal open onClose={() => setCreating(false)} projects={projects} defaultProject={projectId} />}
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={onDelete} loading={removing} title="Delete this schedule?" description="Existing scans and findings are kept." confirmLabel="Delete" />
    </>
  );
}
