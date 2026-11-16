import type { Grade, Priority, ProjectRole, ScanStatus, Severity, TriageStatus } from "@/types/api";

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
export const PRIORITIES: Priority[] = ["P1", "P2", "P3", "P4"];

export const SEVERITY_LABEL: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info" };
export const PRIORITY_LABEL: Record<Priority, string> = { P1: "Fix immediately", P2: "Fix this sprint", P3: "Plan fix", P4: "Backlog" };

/** CSS variable per severity: charts and badges share the same theme-aware colors. */
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "var(--critical)",
  high: "var(--high)",
  medium: "var(--medium)",
  low: "var(--low)",
  info: "var(--info)",
};

export const TRIAGE_LABEL: Record<TriageStatus, string> = {
  open: "Open",
  confirmed: "Confirmed",
  false_positive: "False positive",
  accepted_risk: "Accepted risk",
  fixed: "Fixed",
};

export const SCAN_STAGES: { status: ScanStatus; label: string }[] = [
  { status: "queued", label: "Queued" },
  { status: "validating", label: "Validate" },
  { status: "preparing", label: "Prepare" },
  { status: "scanning", label: "Scan" },
  { status: "normalizing", label: "Normalize" },
  { status: "scoring", label: "Score" },
  { status: "reporting", label: "Report" },
  { status: "completed", label: "Done" },
];

export const ACTIVE_STATUSES: ScanStatus[] = ["queued", "validating", "preparing", "scanning", "normalizing", "scoring", "reporting"];
export const isActiveScan = (status: ScanStatus) => ACTIVE_STATUSES.includes(status);

export const ROLES: { value: ProjectRole; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Everything, including members and deletion" },
  { value: "maintainer", label: "Maintainer", description: "Edit settings, verify targets, run active scans" },
  { value: "analyst", label: "Analyst", description: "Run scans, triage findings, regenerate reports" },
  { value: "viewer", label: "Viewer", description: "Read-only access" },
];

export const GRADE_TONE: Record<Grade, string> = { A: "var(--primary)", B: "var(--primary)", C: "var(--medium)", D: "var(--high)", F: "var(--critical)" };

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const REPORT_FORMAT_INFO: Record<string, { label: string; hint: string }> = {
  pdf: { label: "PDF", hint: "Executive-ready document" },
  html: { label: "HTML", hint: "Self-contained, shareable" },
  json: { label: "JSON", hint: "Full machine-readable data" },
  sarif: { label: "SARIF", hint: "GitHub code scanning upload" },
  csv: { label: "CSV", hint: "Spreadsheet-friendly" },
};
