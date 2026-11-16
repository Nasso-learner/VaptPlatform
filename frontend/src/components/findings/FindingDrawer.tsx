"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink, Info, Lightbulb, ShieldQuestion } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { PriorityBadge, SeverityBadge, TriageBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Field";
import { Drawer } from "@/components/ui/Modal";
import { CodeBlock, Skeleton } from "@/components/ui/Misc";
import { TRIAGE_LABEL } from "@/lib/constants";
import { apiError, formatDate, hasRole, titleCase } from "@/lib/utils";
import { useGetFindingQuery, useGetProjectQuery, useTriageFindingMutation } from "@/store/api";
import { useAppSelector } from "@/store";
import type { FindingDetail, TriageStatus } from "@/types/api";

const schema = z
  .object({ triage_status: z.enum(["open", "confirmed", "false_positive", "accepted_risk", "fixed"]), triage_note: z.string().max(2000).optional() })
  .refine((v) => !["false_positive", "accepted_risk"].includes(v.triage_status) || !!v.triage_note?.trim(), { path: ["triage_note"], message: "A justification is required for false positives and accepted risks." });
type Values = z.infer<typeof schema>;

function Section({ icon, title, children }: { icon?: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-subtle">
        {icon}
        {title}
      </h3>
      <div className="text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function TriageForm({ finding, canTriage }: { finding: FindingDetail; canTriage: boolean }) {
  const [triage, { isLoading }] = useTriageFindingMutation();
  const { register, handleSubmit, reset, watch, setError, formState: { errors, isDirty } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { triage_status: finding.triage_status, triage_note: finding.triage_note },
  });
  useEffect(() => reset({ triage_status: finding.triage_status, triage_note: finding.triage_note }), [finding, reset]);
  const needsNote = ["false_positive", "accepted_risk"].includes(watch("triage_status"));

  const onSubmit = async (values: Values) => {
    const result = await triage({ id: finding.id, ...values });
    if ("error" in result) {
      const { message, fields } = apiError(result.error);
      if (fields.triage_note) setError("triage_note", { message: fields.triage_note });
      else toast.error(message);
      return;
    }
    toast.success(`Marked as ${TRIAGE_LABEL[values.triage_status as TriageStatus].toLowerCase()}`);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-2xl border border-border bg-surface-2/50 p-4">
      <p className="text-sm font-semibold">Triage</p>
      {!canTriage && <p className="text-xs text-muted">You have read-only access to this project. Analysts and above can triage findings.</p>}
      <Select label="Status" disabled={!canTriage} {...register("triage_status")}>
        {Object.entries(TRIAGE_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Textarea label={needsNote ? "Justification" : "Note (optional)"} required={needsNote} disabled={!canTriage} rows={3} placeholder="Why is this a false positive / accepted risk?" error={errors.triage_note?.message} hint={needsNote ? "Shown in reports and carried over to future scans." : undefined} {...register("triage_note")} />
      {canTriage && (
        <Button type="submit" loading={isLoading} disabled={!isDirty}>
          Save triage
        </Button>
      )}
      {finding.triaged_by && <p className="text-xs text-subtle">Last triaged by {finding.triaged_by.email} on {formatDate(finding.triaged_at)}</p>}
    </form>
  );
}

export function FindingDrawer({ findingId, onClose }: { findingId: string | null; onClose: () => void }) {
  const user = useAppSelector((state) => state.auth.user);
  const { data: finding, isFetching } = useGetFindingQuery(findingId ?? "", { skip: !findingId });
  const { data: project } = useGetProjectQuery(finding?.project ?? "", { skip: !finding });
  const klass = finding?.vulnerability_class;
  const references = finding?.references?.length ? finding.references : (klass?.references ?? []);

  return (
    <Drawer
      open={!!findingId}
      onClose={onClose}
      title={finding?.issue_name ?? "Loading finding…"}
      description={finding && <span className="flex flex-wrap items-center gap-1.5"><SeverityBadge severity={finding.severity} /><PriorityBadge priority={finding.priority} /><TriageBadge status={finding.triage_status} />{finding.is_new && <span className="text-xs font-medium text-high">New</span>}</span>}
    >
      {!finding || (isFetching && finding.id !== findingId) ? (
        <div className="space-y-4">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-surface-2/60 p-3 font-mono text-xs">
            <p className="break-all">{finding.location || "—"}</p>
            {finding.parameter && <p className="mt-1 text-muted">parameter: {finding.parameter}</p>}
            {finding.source_link && (
              <a href={finding.source_link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-sans text-primary hover:underline">
                View at scanned commit <ExternalLink className="size-3" />
              </a>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            {[
              ["Category", finding.issue_category_label ?? "Uncategorized"],
              ["CWE", finding.cwe_id || "—"],
              ["OWASP", finding.owasp_category || "—"],
              ["Confidence", titleCase(finding.confidence)],
              ["Risk score", `${finding.risk_score} / 10`],
              ["Detected by", finding.detected_by.join(", ") || "—"],
              ["First seen", formatDate(finding.first_seen_at, false)],
              ["Fix by", finding.fix_due_date ? formatDate(finding.fix_due_date, false) : "—"],
              ["Rule", finding.rule_id || "—"],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-subtle">{label}</dt>
                <dd className="mt-0.5 truncate font-medium" title={value}>{value}</dd>
              </div>
            ))}
          </dl>

          {klass?.explanation && <Section icon={<Info className="size-3.5" />} title="What it is">{klass.explanation}</Section>}
          {finding.description && finding.description !== finding.issue_name && <Section title="Why it was flagged">{finding.description}</Section>}
          {klass?.business_impact && <Section icon={<ShieldQuestion className="size-3.5" />} title="Impact">{klass.business_impact}</Section>}
          {finding.evidence && <Section title="Evidence"><CodeBlock>{finding.evidence}</CodeBlock></Section>}
          {(finding.recommended_fix || klass?.remediation_steps?.length) && (
            <Section icon={<Lightbulb className="size-3.5" />} title="How to fix">
              {finding.recommended_fix && <p className="mb-2">{finding.recommended_fix}</p>}
              {!!klass?.remediation_steps?.length && (
                <ol className="list-decimal space-y-1 pl-5 text-muted">
                  {klass.remediation_steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
            </Section>
          )}
          {references.length > 0 && (
            <Section title="References">
              <ul className="space-y-1">
                {references.map((ref) => (
                  <li key={ref}>
                    {/^https?:\/\//.test(ref) ? (
                      <a href={ref} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">{ref}</a>
                    ) : (
                      <span className="break-all text-muted">{ref}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <TriageForm finding={finding} canTriage={hasRole(project?.my_role, "analyst", user?.is_staff)} />
          <p className="text-xs text-subtle">
            Part of <Link href={`/scans/${finding.scan}`} className="text-primary hover:underline">this scan</Link> of {finding.project_name}.
          </p>
        </div>
      )}
    </Drawer>
  );
}
