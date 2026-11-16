"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, ArchiveRestore, ArrowLeft, CheckCircle2, GitBranch, Globe, Play, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";

import { FindingsExplorer } from "@/components/findings/FindingsExplorer";
import { MembersPanel } from "@/components/projects/MembersPanel";
import { BasicsFields, TargetsFields, defaultsFor, projectSchema, toPayload, type ProjectFormValues } from "@/components/projects/ProjectFields";
import { RunScanModal } from "@/components/projects/RunScanModal";
import { ScanTable } from "@/components/scans/ScanTable";
import { SchedulesPanel } from "@/components/schedules/SchedulesPanel";
import { Badge, RoleBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, PageHeader } from "@/components/ui/Card";
import { RiskRing } from "@/components/ui/Charts";
import { ConfirmDialog } from "@/components/ui/Modal";
import { CodeBlock, CountUp, ErrorState, Pagination, Rise, Skeleton, Stagger, TabLoader, Tabs } from "@/components/ui/Misc";
import { tabQuery, useMountFetch, useRefetchOnMount } from "@/lib/hooks";
import { apiError, formatDate, hasRole, timeAgo, titleCase } from "@/lib/utils";
import { useAppSelector } from "@/store";
import {
  useDeleteProjectMutation, useGetProjectQuery, useGetScansQuery, useGetTargetVerificationQuery, useUpdateProjectMutation,
  useValidateRepositoryMutation, useVerifyTargetMutation,
} from "@/store/api";
import type { Project, TargetVerification } from "@/types/api";

type Tab = "overview" | "scans" | "findings" | "members" | "schedules" | "settings";
const TABS: Tab[] = ["overview", "scans", "findings", "members", "schedules", "settings"];

function VerifiedPill({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return ok ? (
    <Badge tone="primary"><ShieldCheck className="size-3" aria-hidden />{yes}</Badge>
  ) : (
    <Badge tone="medium"><ShieldAlert className="size-3" aria-hidden />{no}</Badge>
  );
}

function RepositoryCard({ project, canManage }: { project: Project; canManage: boolean }) {
  const [validate, { isLoading }] = useValidateRepositoryMutation();
  const run = async () => {
    const result = await validate(project.id);
    if ("error" in result) return toast.error(apiError(result.error).message);
    if (result.data.ok) toast.success(`Repository reachable (${result.data.access ?? "ok"})`);
    else toast.error(result.data.message ?? "Repository could not be validated");
  };
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><GitBranch className="size-4 text-primary" aria-hidden />Repository</span>} action={<VerifiedPill ok={project.is_repository_verified} yes="Validated" no="Not validated" />} />
      {!project.allow_sast ? (
        <p className="text-sm text-muted">Static analysis is disabled. Enable it in Settings.</p>
      ) : (
        <>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted">URL</dt><dd className="truncate font-mono text-xs">{project.repository_url || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Branch</dt><dd>{project.repository_branch || "default"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Access</dt><dd>{titleCase(project.repository_access_level)}{project.has_repository_token ? " · token stored" : ""}</dd></div>
            {project.repository_head_commit && <div className="flex justify-between gap-4"><dt className="text-muted">Head</dt><dd className="font-mono text-xs">{project.repository_head_commit.slice(0, 10)}</dd></div>}
            {project.repository_verified_at && <div className="flex justify-between gap-4"><dt className="text-muted">Checked</dt><dd>{timeAgo(project.repository_verified_at)}</dd></div>}
          </dl>
          {canManage && <Button className="mt-4" variant="secondary" size="sm" loading={isLoading} onClick={run} icon={<CheckCircle2 className="size-4" />}>{project.is_repository_verified ? "Re-validate" : "Validate repository"}</Button>}
        </>
      )}
    </Card>
  );
}

function TargetCard({ project, canManage, instructions }: { project: Project; canManage: boolean; instructions?: TargetVerification }) {
  const [verify, { isLoading }] = useVerifyTargetMutation();
  const run = async () => {
    const result = await verify(project.id);
    if ("error" in result) return toast.error(apiError(result.error).message);
    if (result.data.verified) toast.success("Target ownership verified");
    else toast.error(result.data.message ?? "Verification file was not found at that URL.");
  };
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Globe className="size-4 text-low" aria-hidden />Dynamic target</span>} action={<VerifiedPill ok={project.is_target_verified} yes="Verified" no="Not verified" />} />
      {!project.allow_dast ? (
        <p className="text-sm text-muted">Dynamic testing is disabled. Enable it in Settings.</p>
      ) : (
        <>
          <p className="truncate font-mono text-xs">{project.target_url}</p>
          {!project.is_target_verified && canManage && instructions && (
            <div className="mt-4 space-y-2 text-sm">
              <p className="text-muted">Prove you control this site. Serve this exact text at:</p>
              <CodeBlock>{instructions.file_url}</CodeBlock>
              <p className="text-muted">with the file content:</p>
              <CodeBlock>{instructions.file_content}</CodeBlock>
            </div>
          )}
          {project.is_target_verified && <p className="mt-2 text-xs text-muted">Verified {timeAgo(project.target_verified_at)}. Changing the URL resets this.</p>}
          {canManage && !project.is_target_verified && <Button className="mt-4" variant="secondary" size="sm" loading={isLoading} onClick={run} icon={<CheckCircle2 className="size-4" />}>Verify now</Button>}
          {!canManage && !project.is_target_verified && <p className="mt-3 text-xs text-muted">A maintainer needs to verify this target.</p>}
        </>
      )}
    </Card>
  );
}

function Overview({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { data: project, isFetching, isUninitialized, isError, refetch } = useGetProjectQuery(projectId);
  useRefetchOnMount(refetch);
  const needVerify = !!project?.allow_dast && canManage;
  const verification = useGetTargetVerificationQuery(projectId, { skip: !needVerify, ...tabQuery });
  const projectPending = useMountFetch(isFetching, isUninitialized);
  const verifyPending = useMountFetch(verification.isFetching, verification.isUninitialized, needVerify);
  const pending = projectPending || verifyPending;
  if (pending || !project) return <TabLoader label="Loading overview" />;
  if (isError) return <ErrorState message="Could not load this project." onRetry={refetch} />;
  return (
    <Stagger className="space-y-6">
      <Rise>
        <Card className="flex flex-wrap items-center gap-8">
          <RiskRing score={project.latest_risk_score} grade={project.latest_risk_grade} size={96} />
          <dl className="grid flex-1 grid-cols-2 gap-6 sm:grid-cols-4">
            <div><dt className="text-xs text-subtle">Open findings</dt><dd className="mt-1 text-2xl font-semibold"><CountUp value={project.open_findings_count} /></dd></div>
            <div><dt className="text-xs text-subtle">Risk score</dt><dd className="mt-1 text-2xl font-semibold">{project.latest_risk_score ?? "—"}</dd></div>
            <div><dt className="text-xs text-subtle">Last scan</dt><dd className="mt-1 text-sm font-medium">{project.last_scanned_at ? timeAgo(project.last_scanned_at) : "Never"}</dd></div>
            <div><dt className="text-xs text-subtle">Created</dt><dd className="mt-1 text-sm font-medium">{formatDate(project.created_at, false)}</dd></div>
          </dl>
        </Card>
      </Rise>
      <div className="grid gap-6 lg:grid-cols-2">
        <Rise><RepositoryCard project={project} canManage={canManage} /></Rise>
        <Rise><TargetCard project={project} canManage={canManage} instructions={verification.data} /></Rise>
      </div>
    </Stagger>
  );
}

function ProjectScans({ projectId }: { projectId: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching, isUninitialized, error, refetch } = useGetScansQuery({ project: projectId, page, page_size: 10, ordering: "-created_at" }, { ...tabQuery, pollingInterval: 5000 });
  const pending = useMountFetch(isFetching, isUninitialized);
  if (pending) return <TabLoader label="Loading scans" />;
  if (error) return <ErrorState message="Could not load scans." onRetry={refetch} />;
  return (
    <Card padded={false}>
      <ScanTable scans={data?.results} loading={isLoading} showProject={false} />
      <Pagination page={page} count={data?.count ?? 0} pageSize={10} onChange={setPage} />
    </Card>
  );
}

function Settings({ projectId, canManage, isOwner }: { projectId: string; canManage: boolean; isOwner: boolean }) {
  const { data: project, isFetching, isUninitialized, isError, refetch } = useGetProjectQuery(projectId);
  useRefetchOnMount(refetch);
  const pending = useMountFetch(isFetching, isUninitialized);
  if (pending || !project) return <TabLoader label="Loading settings" />;
  if (isError) return <ErrorState message="Could not load project settings." onRetry={refetch} />;
  return <SettingsForm project={project} canManage={canManage} isOwner={isOwner} />;
}

function SettingsForm({ project, canManage, isOwner }: { project: Project; canManage: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [update, { isLoading }] = useUpdateProjectMutation();
  const [remove, { isLoading: deleting }] = useDeleteProjectMutation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const methods = useForm<ProjectFormValues>({ resolver: zodResolver(projectSchema), defaultValues: defaultsFor(project) });
  const { handleSubmit, reset, setError, formState: { isDirty } } = methods;
  useEffect(() => reset(defaultsFor(project)), [project, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const result = await update({ id: project.id, body: toPayload(values, false) });
    if ("error" in result) {
      const { message, fields } = apiError(result.error);
      const names = Object.keys(fields).filter((k) => k in values);
      names.forEach((n) => setError(n as keyof ProjectFormValues, { message: fields[n] }));
      return toast.error(names.length ? "Please fix the highlighted fields." : message);
    }
    toast.success("Project updated");
  });

  const toggleArchive = async () => {
    const result = await update({ id: project.id, body: { is_archived: !project.is_archived } });
    if ("error" in result) toast.error(apiError(result.error).message);
    else toast.success(project.is_archived ? "Project restored" : "Project archived");
  };

  const onDelete = async () => {
    const result = await remove(project.id);
    if ("error" in result) {
      setConfirmDelete(false);
      return toast.error(apiError(result.error).message);
    }
    toast.success("Project deleted");
    router.replace("/projects");
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {!canManage && <p className="rounded-xl border border-border bg-surface-2/50 p-3 text-sm text-muted">Only maintainers and owners can change project settings.</p>}
      <FormProvider {...methods}>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <fieldset disabled={!canManage} className="space-y-6">
            <Card><CardHeader title="General" /><BasicsFields /></Card>
            <TargetsFields project={project} />
          </fieldset>
          {canManage && <div className="flex justify-end"><Button type="submit" loading={isLoading} disabled={!isDirty}>Save changes</Button></div>}
        </form>
      </FormProvider>

      {canManage && (
        <Card className="border-critical/30">
          <CardHeader title="Danger zone" />
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-sm font-medium">{project.is_archived ? "Restore project" : "Archive project"}</p><p className="text-xs text-muted">{project.is_archived ? "Make this project active again." : "Hides it from lists and blocks new scans. Nothing is deleted."}</p></div>
              <Button variant="secondary" icon={project.is_archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} onClick={toggleArchive}>{project.is_archived ? "Restore" : "Archive"}</Button>
            </div>
            {isOwner && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <div><p className="text-sm font-medium">Delete project</p><p className="text-xs text-muted">Permanently removes all scans, findings and reports.</p></div>
                <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>Delete</Button>
              </div>
            )}
          </div>
        </Card>
      )}
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={onDelete} loading={deleting} title="Delete this project?" description="This cannot be undone." confirmLabel="Delete project" requirePhrase={project.name} />
    </div>
  );
}

function ProjectView({ id }: { id: string }) {
  const user = useAppSelector((state) => state.auth.user);
  const params = useSearchParams();
  const router = useRouter();
  const { data: project, error, refetch } = useGetProjectQuery(id);
  const [running, setRunning] = useState(false);

  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : "overview";
  const setTab = (next: Tab) => router.replace(`/projects/${id}?tab=${next}`, { scroll: false });

  if (error) return <ErrorState message="This project could not be loaded. It may have been deleted, or you no longer have access." onRetry={refetch} />;
  if (!project) return <Skeleton className="h-96 rounded-2xl" />;

  const staff = user?.is_staff;
  const canScan = hasRole(project.my_role, "analyst", staff) && !project.is_archived;
  const canManage = hasRole(project.my_role, "maintainer", staff);
  const isOwner = hasRole(project.my_role, "owner", staff);

  return (
    <>
      <PageHeader
        back={<Link href="/projects" className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"><ArrowLeft className="size-3" aria-hidden />Projects</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{project.name}<RoleBadge role={project.my_role} />{project.is_archived && <Badge>Archived</Badge>}</span>}
        description={project.description || undefined}
        actions={canScan ? <Button icon={<Play className="size-4" />} onClick={() => setRunning(true)}>Run scan</Button> : undefined}
      />
      <div className="space-y-6">
        <Tabs value={tab} onChange={setTab} items={TABS.map((t) => ({ value: t, label: titleCase(t), count: t === "findings" ? project.open_findings_count : undefined }))} />
        <div>
          {tab === "overview" && <Overview projectId={id} canManage={canManage} />}
          {tab === "scans" && <ProjectScans projectId={id} />}
          {tab === "findings" && <FindingsExplorer fixed={{ project: id }} />}
          {tab === "members" && <MembersPanel projectId={id} canManage={isOwner} />}
          {tab === "schedules" && <SchedulesPanel projectId={id} />}
          {tab === "settings" && <Settings projectId={id} canManage={canManage} isOwner={isOwner} />}
        </div>
      </div>
      <RunScanModal project={project} open={running} onClose={() => setRunning(false)} />
    </>
  );
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <ProjectView id={id} />
    </Suspense>
  );
}
