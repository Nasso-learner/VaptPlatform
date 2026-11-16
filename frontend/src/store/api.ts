import { createApi, fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from "@reduxjs/toolkit/query/react";

import type {
  AdminUser, AuditLog, Dashboard, Finding, FindingDetail, Membership, Paginated, Project, ProjectInput, ProjectRole, RepositoryValidation,
  Report, ReportFormat, Scan, ScanDetail, ScanDiff, ScanInput, ScanSummary, Schedule, ScheduleInput, TargetVerification, TriageStatus, User,
  VulnerabilityClass,
} from "@/types/api";

import { signedOut } from "./authSlice";

export type QueryParams = Record<string, string | number | boolean | undefined | null | (string | number)[]>;

/** Query string with repeated keys for arrays (Django's multi-value filters) and empty values dropped. */
export function qs(params?: QueryParams): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, String(v)));
    else search.append(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

const rawBaseQuery = fetchBaseQuery({ baseUrl: "/api/proxy", credentials: "same-origin" });

// A 401 here means the proxy could not refresh the session either: drop client state so the UI returns to /login.
const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api, extra) => {
  const result = await rawBaseQuery(args, api, extra);
  const url = typeof args === "string" ? args : args.url;
  if (result.error?.status === 401 && !url.startsWith("auth/password")) api.dispatch(signedOut());
  return result;
};

const TAGS = ["Me", "Dashboard", "Project", "Scan", "Finding", "Report", "Member", "Schedule", "User", "Audit", "Knowledge"] as const;
const list = (type: (typeof TAGS)[number]) => ({ type, id: "LIST" }) as const;

export const api = createApi({
  reducerPath: "api",
  baseQuery,
  tagTypes: TAGS,
  endpoints: (build) => ({
    // ---- auth
    getAuthConfig: build.query<{ registration_open: boolean }, void>({ query: () => "auth/config" }),
    getMe: build.query<User, void>({ query: () => "auth/me", providesTags: ["Me"] }),
    updateMe: build.mutation<User, { full_name: string }>({ query: (body) => ({ url: "auth/me", method: "PATCH", body }), invalidatesTags: ["Me"] }),
    changePassword: build.mutation<{ detail: string }, { current_password: string; new_password: string }>({
      query: (body) => ({ url: "auth/password", method: "POST", body }),
    }),
    register: build.mutation<unknown, { email: string; full_name: string; password: string }>({ query: (body) => ({ url: "auth/register", method: "POST", body }) }),

    // ---- dashboard
    getDashboard: build.query<Dashboard, void>({ query: () => "dashboard", providesTags: ["Dashboard"] }),

    // ---- projects
    getProjects: build.query<Paginated<Project>, QueryParams | void>({
      query: (params) => `projects${qs(params ?? undefined)}`,
      providesTags: (result) => [list("Project"), ...(result?.results ?? []).map((p) => ({ type: "Project" as const, id: p.id }))],
    }),
    getProject: build.query<Project, string>({ query: (id) => `projects/${id}`, providesTags: (_r, _e, id) => [{ type: "Project", id }] }),
    createProject: build.mutation<Project, ProjectInput>({
      query: (body) => ({ url: "projects", method: "POST", body }),
      invalidatesTags: [list("Project"), "Dashboard"],
    }),
    updateProject: build.mutation<Project, { id: string; body: ProjectInput }>({
      query: ({ id, body }) => ({ url: `projects/${id}`, method: "PATCH", body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: "Project", id }, list("Project"), "Dashboard"],
    }),
    deleteProject: build.mutation<void, string>({
      query: (id) => ({ url: `projects/${id}`, method: "DELETE" }),
      invalidatesTags: [list("Project"), list("Scan"), list("Finding"), "Dashboard"],
    }),
    validateRepository: build.mutation<RepositoryValidation, string>({
      query: (id) => ({ url: `projects/${id}/validate-repository`, method: "POST" }),
      invalidatesTags: (_r, _e, id) => [{ type: "Project", id }, list("Project")],
    }),
    getTargetVerification: build.query<TargetVerification, string>({ query: (id) => `projects/${id}/target-verification` }),
    verifyTarget: build.mutation<TargetVerification, string>({
      query: (id) => ({ url: `projects/${id}/target-verification`, method: "POST" }),
      invalidatesTags: (_r, _e, id) => [{ type: "Project", id }, list("Project")],
    }),
    createScan: build.mutation<ScanDetail, { projectId: string; body: ScanInput }>({
      query: ({ projectId, body }) => ({ url: `projects/${projectId}/scans`, method: "POST", body }),
      invalidatesTags: (_r, _e, { projectId }) => [list("Scan"), { type: "Project", id: projectId }, list("Project"), list("Finding"), "Dashboard", "Audit"],
    }),

    // ---- members
    getMembers: build.query<Membership[], string>({ query: (id) => `projects/${id}/members`, providesTags: (_r, _e, id) => [{ type: "Member", id }] }),
    addMember: build.mutation<Membership, { projectId: string; email: string; role: ProjectRole }>({
      query: ({ projectId, ...body }) => ({ url: `projects/${projectId}/members`, method: "POST", body }),
      invalidatesTags: (_r, _e, { projectId }) => [{ type: "Member", id: projectId }, "Audit"],
    }),
    updateMember: build.mutation<Membership, { projectId: string; memberId: string; role: ProjectRole }>({
      query: ({ projectId, memberId, role }) => ({ url: `projects/${projectId}/members/${memberId}`, method: "PATCH", body: { role } }),
      invalidatesTags: (_r, _e, { projectId }) => [{ type: "Member", id: projectId }, "Audit"],
    }),
    removeMember: build.mutation<void, { projectId: string; memberId: string }>({
      query: ({ projectId, memberId }) => ({ url: `projects/${projectId}/members/${memberId}`, method: "DELETE" }),
      invalidatesTags: (_r, _e, { projectId }) => [{ type: "Member", id: projectId }, list("Project"), "Audit"],
    }),

    // ---- scans
    getScans: build.query<Paginated<Scan>, QueryParams | void>({
      query: (params) => `scans${qs(params ?? undefined)}`,
      providesTags: (result) => [list("Scan"), ...(result?.results ?? []).map((s) => ({ type: "Scan" as const, id: s.id }))],
    }),
    getScan: build.query<ScanDetail, string>({ query: (id) => `scans/${id}`, providesTags: (_r, _e, id) => [{ type: "Scan", id }] }),
    getScanSummary: build.query<ScanSummary, string>({ query: (id) => `scans/${id}/summary`, providesTags: (_r, _e, id) => [{ type: "Scan", id }] }),
    getScanDiff: build.query<ScanDiff, string>({ query: (id) => `scans/${id}/diff`, providesTags: (_r, _e, id) => [{ type: "Scan", id }] }),
    cancelScan: build.mutation<ScanDetail, string>({
      query: (id) => ({ url: `scans/${id}/cancel`, method: "POST" }),
      invalidatesTags: (_r, _e, id) => [{ type: "Scan", id }, list("Scan"), "Dashboard"],
    }),

    // ---- findings
    getFindings: build.query<Paginated<Finding>, QueryParams | void>({
      query: (params) => `findings${qs(params ?? undefined)}`,
      providesTags: (result) => [list("Finding"), ...(result?.results ?? []).map((f) => ({ type: "Finding" as const, id: f.id }))],
    }),
    getFinding: build.query<FindingDetail, string>({ query: (id) => `findings/${id}`, providesTags: (_r, _e, id) => [{ type: "Finding", id }] }),
    triageFinding: build.mutation<FindingDetail, { id: string; triage_status: TriageStatus; triage_note?: string }>({
      query: ({ id, ...body }) => ({ url: `findings/${id}/triage`, method: "POST", body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: "Finding", id }, list("Finding"), list("Scan"), list("Project"), "Dashboard"],
    }),

    // ---- reports
    getReports: build.query<Paginated<Report>, QueryParams | void>({ query: (params) => `reports${qs(params ?? undefined)}`, providesTags: [list("Report")] }),
    regenerateReports: build.mutation<Report[], { scan: string; report_formats?: ReportFormat[] }>({
      query: (body) => ({ url: "reports/regenerate", method: "POST", body }),
      invalidatesTags: (_r, _e, { scan }) => [{ type: "Scan", id: scan }, list("Report")],
    }),

    // ---- schedules
    getSchedules: build.query<Paginated<Schedule>, QueryParams | void>({
      query: (params) => `schedules${qs(params ?? undefined)}`,
      providesTags: [list("Schedule")],
    }),
    createSchedule: build.mutation<Schedule, ScheduleInput>({ query: (body) => ({ url: "schedules", method: "POST", body }), invalidatesTags: [list("Schedule")] }),
    updateSchedule: build.mutation<Schedule, { id: string; body: Partial<ScheduleInput> }>({
      query: ({ id, body }) => ({ url: `schedules/${id}`, method: "PATCH", body }),
      invalidatesTags: [list("Schedule")],
    }),
    deleteSchedule: build.mutation<void, string>({ query: (id) => ({ url: `schedules/${id}`, method: "DELETE" }), invalidatesTags: [list("Schedule")] }),

    // ---- users (platform admins)
    getUsers: build.query<Paginated<AdminUser>, QueryParams | void>({ query: (params) => `users${qs(params ?? undefined)}`, providesTags: [list("User")] }),
    createUser: build.mutation<AdminUser, { email: string; full_name: string; password: string; is_staff: boolean }>({
      query: (body) => ({ url: "users", method: "POST", body }),
      invalidatesTags: [list("User")],
    }),
    updateUser: build.mutation<AdminUser, { id: string; body: Partial<{ full_name: string; is_staff: boolean; is_active: boolean; password: string }> }>({
      query: ({ id, body }) => ({ url: `users/${id}`, method: "PATCH", body }),
      invalidatesTags: [list("User"), "Me"],
    }),

    // ---- audit & knowledge
    getAuditLogs: build.query<Paginated<AuditLog>, QueryParams | void>({ query: (params) => `audit-logs${qs(params ?? undefined)}`, providesTags: ["Audit"] }),
    getKnowledge: build.query<Paginated<VulnerabilityClass>, QueryParams | void>({
      query: (params) => `knowledge${qs({ page_size: 100, ...(params ?? {}) })}`,
      providesTags: [list("Knowledge")],
    }),
  }),
});

export const {
  useGetAuthConfigQuery, useGetMeQuery, useUpdateMeMutation, useChangePasswordMutation, useRegisterMutation,
  useGetDashboardQuery,
  useGetProjectsQuery, useGetProjectQuery, useCreateProjectMutation, useUpdateProjectMutation, useDeleteProjectMutation,
  useValidateRepositoryMutation, useGetTargetVerificationQuery, useVerifyTargetMutation, useCreateScanMutation,
  useGetMembersQuery, useAddMemberMutation, useUpdateMemberMutation, useRemoveMemberMutation,
  useGetScansQuery, useGetScanQuery, useGetScanSummaryQuery, useGetScanDiffQuery, useCancelScanMutation,
  useGetFindingsQuery, useGetFindingQuery, useTriageFindingMutation,
  useGetReportsQuery, useRegenerateReportsMutation,
  useGetSchedulesQuery, useCreateScheduleMutation, useUpdateScheduleMutation, useDeleteScheduleMutation,
  useGetUsersQuery, useCreateUserMutation, useUpdateUserMutation,
  useGetAuditLogsQuery, useGetKnowledgeQuery,
} = api;
