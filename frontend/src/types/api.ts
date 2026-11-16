export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Priority = "P1" | "P2" | "P3" | "P4";
export type ScanType = "sast" | "dast";
export type ScanStatus = "queued" | "validating" | "preparing" | "scanning" | "normalizing" | "scoring" | "reporting" | "completed" | "failed" | "cancelled";
export type TriageStatus = "open" | "confirmed" | "false_positive" | "accepted_risk" | "fixed";
export type ProjectRole = "owner" | "maintainer" | "analyst" | "viewer";
export type ScanProfile = "quick" | "standard";
export type ReportFormat = "pdf" | "html" | "json" | "sarif" | "csv";
export type Grade = "A" | "B" | "C" | "D" | "F";
export type SourceType = "code" | "secret" | "dependency" | "iac" | "dast";
export type Confidence = "high" | "medium" | "low";

export type Paginated<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export type User = {
  id: string;
  email: string;
  full_name: string;
  is_staff: boolean;
  is_active: boolean;
  date_joined: string;
  last_login: string | null;
};
export type AdminUser = User & { project_count: number };

export type Project = {
  id: string;
  name: string;
  slug: string;
  description: string;
  created_by: User;
  created_at: string;
  updated_at: string;
  is_archived: boolean;
  my_role: ProjectRole | null;
  repository_url: string;
  repository_branch: string;
  has_repository_token: boolean;
  repository_access_level: string;
  is_repository_verified: boolean;
  repository_verified_at: string | null;
  repository_head_commit: string;
  target_url: string;
  is_target_verified: boolean;
  target_verified_at: string | null;
  allow_sast: boolean;
  allow_dast: boolean;
  allow_active_dast: boolean;
  authorization_confirmed_at: string | null;
  latest_risk_score: string | null;
  latest_risk_grade: Grade | "";
  open_findings_count: number;
  last_scanned_at: string | null;
};

export type ProjectInput = Partial<
  Pick<Project, "name" | "description" | "repository_url" | "repository_branch" | "target_url" | "allow_sast" | "allow_dast" | "allow_active_dast" | "is_archived">
> & { repository_token?: string; authorization_confirmed?: boolean };

export type Membership = { id: string; user: User; role: ProjectRole; created_at: string };

export type EngineRun = {
  engine: string;
  engine_version: string;
  status: "pending" | "running" | "succeeded" | "failed";
  raw_findings_count: number;
  duration_ms: number;
  error_message: string;
};

export type Report = {
  id: string;
  scan: string;
  report_format: ReportFormat;
  status: "pending" | "generating" | "ready" | "failed";
  filename: string;
  file_size_bytes: number;
  sha256_checksum: string;
  generated_at: string | null;
  error_message: string;
  download_url: string | null;
};

export type Scan = {
  id: string;
  project: string;
  project_name: string;
  scan_type: ScanType;
  status: ScanStatus;
  progress_percent: number;
  target: string;
  branch: string;
  commit_sha: string;
  risk_score: string | null;
  risk_grade: Grade | "";
  severity_counts: Partial<Record<Severity, number>>;
  priority_counts: Partial<Record<Priority, number>>;
  findings_count: number;
  new_findings_count: number;
  triggered_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
};
export type ScanDetail = Scan & {
  engines: string[];
  configuration: { profile?: ScanProfile; active?: boolean; openapi_url?: string; authenticated?: boolean };
  engine_runs: EngineRun[];
  error_message: string;
  reports: Report[];
};

export type IssueCategoryRow = {
  issue_category: string;
  issue_category_label: string;
  total: number;
  open: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
};

export type Finding = {
  id: string;
  scan: string;
  project: string;
  project_name: string;
  issue_name: string;
  issue_category: string | null;
  issue_category_label: string | null;
  source_type: SourceType;
  severity: Severity;
  confidence: Confidence;
  priority: Priority;
  risk_score: string;
  cwe_id: string;
  owasp_category: string;
  location: string;
  file_path: string;
  line_number: number | null;
  url: string;
  detected_by: string[];
  triage_status: TriageStatus;
  is_new: boolean;
  fix_due_date: string | null;
  first_seen_at: string;
};

export type VulnerabilityClass = {
  id: string;
  slug: string;
  name: string;
  issue_category: string;
  issue_category_label: string;
  owasp_category: string;
  cwe_ids: string[];
  explanation: string;
  business_impact: string;
  remediation_steps: string[];
  base_priority: Priority;
  references: string[];
};

export type FindingDetail = Finding & {
  rule_id: string;
  http_method: string;
  parameter: string;
  description: string;
  evidence: string;
  recommended_fix: string;
  references: string[];
  vulnerability_class: VulnerabilityClass | null;
  triage_note: string;
  triaged_by: User | null;
  triaged_at: string | null;
  source_link: string | null;
};

export type ScanSummary = {
  scan: Scan;
  issue_categories: IssueCategoryRow[];
  priority_counts: Scan["priority_counts"];
  severity_counts: Scan["severity_counts"];
  top_findings: Finding[];
};

export type ScanDiff = {
  scan: string;
  previous_scan: string | null;
  previous_scan_created_at?: string;
  new_count: number;
  fixed_count: number;
  unchanged_count: number;
  new: Finding[];
  fixed: Finding[];
};

export type Schedule = {
  id: string;
  project: string;
  project_name: string;
  scan_type: ScanType;
  profile: ScanProfile;
  frequency: "daily" | "weekly";
  hour_utc: number;
  weekday: number | null;
  is_enabled: boolean;
  created_by_email: string | null;
  next_run_at: string;
  last_run_at: string | null;
  last_scan: string | null;
  last_scan_status: ScanStatus | null;
  last_result: string;
  created_at: string;
};
export type ScheduleInput = Pick<Schedule, "project" | "scan_type" | "profile" | "frequency" | "hour_utc" | "weekday"> & { is_enabled?: boolean };

export type AuditLog = {
  id: string;
  created_at: string;
  actor: string | null;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string;
  target_label: string;
  project: string | null;
  project_name: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
};

export type Dashboard = {
  cards: { projects: number; scans_total: number; scans_running: number; scans_last_30_days: number; open_findings: number; p1_findings: number; overdue_findings: number };
  severity_totals: Partial<Record<Severity, number>>;
  priority_totals: Partial<Record<Priority, number>>;
  issue_category_totals: { vulnerability_class__issue_category: string | null; count: number }[];
  scan_trend: { day: string; sast: number; dast: number }[];
  riskiest_projects: { id: string; name: string; latest_risk_score: string; latest_risk_grade: Grade | ""; open_findings_count: number; last_scanned_at: string | null }[];
  recent_scans: Scan[];
};

export type TargetVerification = { method: string; file_url: string; file_content: string; verified: boolean; verified_at: string | null; message?: string };
export type RepositoryValidation = { ok: boolean; message?: string; access?: string; commit_sha?: string; branch?: string; project?: Project };
export type ScanInput = { scan_type: ScanType; profile: ScanProfile; active?: boolean; openapi_url?: string; auth_header?: string };
