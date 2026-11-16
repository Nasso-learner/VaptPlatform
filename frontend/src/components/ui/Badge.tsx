import { cn, titleCase } from "@/lib/utils";
import { PRIORITY_LABEL, SEVERITY_LABEL, TRIAGE_LABEL, isActiveScan } from "@/lib/constants";
import type { Grade, Priority, ProjectRole, ScanStatus, Severity, TriageStatus } from "@/types/api";

type Tone = "neutral" | "primary" | "critical" | "high" | "medium" | "low" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-border",
  primary: "bg-primary-soft text-primary border-primary/30",
  critical: "bg-critical/12 text-critical border-critical/30",
  high: "bg-high/12 text-high border-high/30",
  medium: "bg-medium/14 text-medium border-medium/30",
  low: "bg-low/12 text-low border-low/30",
  info: "bg-info/12 text-info border-info/30",
};

export function Badge({ tone = "neutral", className, children, dot }: { tone?: Tone; className?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-5", TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export const SeverityBadge = ({ severity }: { severity: Severity }) => (
  <Badge tone={severity} dot>
    {SEVERITY_LABEL[severity]}
  </Badge>
);

export const PriorityBadge = ({ priority }: { priority: Priority }) => (
  <span title={PRIORITY_LABEL[priority]}>
    <Badge tone={priority === "P1" ? "critical" : priority === "P2" ? "high" : priority === "P3" ? "medium" : "info"}>{priority}</Badge>
  </span>
);

export function StatusBadge({ status }: { status: ScanStatus }) {
  const active = isActiveScan(status);
  const tone: Tone = status === "completed" ? "primary" : status === "failed" ? "critical" : status === "cancelled" ? "neutral" : "low";
  return (
    <Badge tone={tone}>
      {active && (
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping-slow rounded-full bg-current opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-current" />
        </span>
      )}
      {titleCase(status)}
    </Badge>
  );
}

export const TriageBadge = ({ status }: { status: TriageStatus }) => (
  <Badge tone={status === "open" ? "high" : status === "confirmed" ? "critical" : status === "fixed" ? "primary" : "neutral"}>{TRIAGE_LABEL[status]}</Badge>
);

export const RoleBadge = ({ role }: { role: ProjectRole | null }) =>
  role ? <Badge tone={role === "owner" ? "primary" : role === "viewer" ? "neutral" : "low"}>{titleCase(role)}</Badge> : null;

export function GradeBadge({ grade }: { grade?: Grade | "" }) {
  if (!grade) return <span className="text-subtle">—</span>;
  const tone: Tone = grade === "A" || grade === "B" ? "primary" : grade === "C" ? "medium" : grade === "D" ? "high" : "critical";
  return <Badge tone={tone} className="min-w-7 justify-center text-xs">{grade}</Badge>;
}
