"use client";

import { Code2, Globe, KeyRound, Zap } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useFormContext } from "react-hook-form";
import { z } from "zod";

import { Input, Switch, Textarea } from "@/components/ui/Field";
import type { Project, ProjectInput } from "@/types/api";

const httpUrl = (protocols: string[], message: string) =>
  z.string().trim().refine((v) => !v || protocols.some((p) => v.startsWith(p)), message).refine((v) => { try { return !v || !!new URL(v); } catch { return false; } }, "Enter a valid URL");

export const projectSchema = z
  .object({
    name: z.string().trim().min(2, "At least 2 characters").max(120),
    description: z.string().max(1000).optional(),
    allow_sast: z.boolean(),
    repository_url: httpUrl(["https://"], "Must start with https://"),
    repository_branch: z.string().trim().max(120).optional(),
    repository_token: z.string().optional(),
    allow_dast: z.boolean(),
    target_url: httpUrl(["http://", "https://"], "Must start with http:// or https://"),
    allow_active_dast: z.boolean(),
    authorization_confirmed: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.allow_sast && !v.allow_dast) ctx.addIssue({ code: "custom", path: ["allow_sast"], message: "Enable at least one scan type." });
    if (v.allow_sast && !v.repository_url) ctx.addIssue({ code: "custom", path: ["repository_url"], message: "Required for static analysis." });
    if (v.allow_dast && !v.target_url) ctx.addIssue({ code: "custom", path: ["target_url"], message: "Required for dynamic testing." });
  });
export type ProjectFormValues = z.infer<typeof projectSchema>;

export const defaultsFor = (project?: Project): ProjectFormValues => ({
  name: project?.name ?? "",
  description: project?.description ?? "",
  allow_sast: project?.allow_sast ?? true,
  repository_url: project?.repository_url ?? "",
  repository_branch: project?.repository_branch ?? "main",
  repository_token: "",
  allow_dast: project?.allow_dast ?? false,
  target_url: project?.target_url ?? "",
  allow_active_dast: project?.allow_active_dast ?? false,
  authorization_confirmed: false,
});

/** Only send what the API expects; an empty token means "keep the stored one". */
export function toPayload(values: ProjectFormValues, creating: boolean): ProjectInput {
  const { repository_token, authorization_confirmed, ...rest } = values;
  return {
    ...rest,
    // Disabled targets keep their data server-side but must not trip required-field validation.
    ...(repository_token ? { repository_token } : {}),
    ...(creating ? { authorization_confirmed: !!authorization_confirmed } : {}),
  };
}

export function BasicsFields() {
  const { register, formState: { errors } } = useFormContext<ProjectFormValues>();
  return (
    <div className="space-y-4">
      <Input label="Project name" required placeholder="Customer portal" error={errors.name?.message} {...register("name")} />
      <Textarea label="Description" rows={3} placeholder="What does this application do? (optional)" error={errors.description?.message} {...register("description")} />
    </div>
  );
}

function Panel({ icon, tone, title, children, enabled, onToggle, description, error }: { icon: React.ReactNode; tone: string; title: string; description: string; enabled: boolean; onToggle: (v: boolean) => void; error?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-2/40 p-4">
      <div className="flex items-start gap-3">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
        <div className="flex-1">
          <Switch checked={enabled} onChange={onToggle} label={title} description={description} />
          {error && <p role="alert" className="mt-1 text-xs text-critical">{error}</p>}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {enabled && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 26 }} className="overflow-hidden">
            <div className="space-y-4 pt-4 pl-0 sm:pl-13">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function TargetsFields({ project }: { project?: Project }) {
  const { register, watch, setValue, formState: { errors } } = useFormContext<ProjectFormValues>();
  const sast = watch("allow_sast");
  const dast = watch("allow_dast");
  const active = watch("allow_active_dast");

  return (
    <div className="space-y-4">
      <Panel
        icon={<Code2 className="size-5" />}
        tone="bg-primary-soft text-primary"
        title="Static analysis (SAST)"
        description="Scan source code, secrets, dependencies and infrastructure files in a Git repository."
        enabled={sast}
        onToggle={(v) => setValue("allow_sast", v, { shouldValidate: true, shouldDirty: true })}
        error={errors.allow_sast?.message}
      >
        <Input label="Repository URL" required placeholder="https://github.com/acme/portal" error={errors.repository_url?.message} {...register("repository_url")} />
        <Input label="Branch" placeholder="main" error={errors.repository_branch?.message} {...register("repository_branch")} />
        <Input
          label="Access token"
          type="password"
          autoComplete="off"
          icon={<KeyRound className="size-4" />}
          placeholder={project?.has_repository_token ? "Stored: leave blank to keep" : "Only for private repositories"}
          hint="Read-only token. Encrypted at rest and never shown again."
          error={errors.repository_token?.message}
          {...register("repository_token")}
        />
      </Panel>

      <Panel
        icon={<Globe className="size-5" />}
        tone="bg-low/12 text-low"
        title="Dynamic testing (DAST)"
        description="Probe a running application for runtime vulnerabilities."
        enabled={dast}
        onToggle={(v) => {
          setValue("allow_dast", v, { shouldValidate: true, shouldDirty: true });
          if (!v) setValue("allow_active_dast", false, { shouldDirty: true });
        }}
      >
        <Input label="Target URL" required placeholder="https://staging.acme.com" error={errors.target_url?.message} {...register("target_url")} />
        <div className="flex items-start gap-3 rounded-xl border border-border p-3">
          <Zap className="mt-0.5 size-4 shrink-0 text-medium" aria-hidden />
          <Switch
            checked={active}
            onChange={(v) => setValue("allow_active_dast", v, { shouldDirty: true })}
            label="Allow active scans"
            description="Sends attack payloads. Only enable for environments you can safely test; the target must be verified."
          />
        </div>
      </Panel>
    </div>
  );
}
