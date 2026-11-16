"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";

import { BasicsFields, TargetsFields, defaultsFor, projectSchema, toPayload, type ProjectFormValues } from "@/components/projects/ProjectFields";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Field";
import { bounce } from "@/lib/motion";
import { apiError, cn } from "@/lib/utils";
import { useCreateProjectMutation } from "@/store/api";

const STEPS = ["Basics", "Targets", "Authorize"] as const;
const STEP_FIELDS: (keyof ProjectFormValues)[][] = [["name", "description"], ["allow_sast", "repository_url", "repository_branch", "allow_dast", "target_url"], []];

export default function NewProjectPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [createProject, { isLoading }] = useCreateProjectMutation();
  const methods = useForm<ProjectFormValues>({ resolver: zodResolver(projectSchema), defaultValues: defaultsFor(), mode: "onTouched" });
  const { handleSubmit, trigger, watch, setValue, setError } = methods;
  const confirmed = watch("authorization_confirmed");
  const values = watch();

  const go = async (next: number) => {
    if (next > step && !(await trigger(STEP_FIELDS[step]))) return;
    setDirection(next > step ? 1 : -1);
    setStep(next);
  };

  const onSubmit = handleSubmit(async (data) => {
    const result = await createProject(toPayload(data, true));
    if ("error" in result) {
      const { message, fields } = apiError(result.error);
      const names = Object.keys(fields).filter((k) => k in data);
      names.forEach((name) => setError(name as keyof ProjectFormValues, { message: fields[name] }));
      // Jump back to the earliest step that holds a rejected field.
      const target = STEP_FIELDS.findIndex((group) => group.some((f) => names.includes(f)));
      if (target >= 0) setStep(target);
      toast.error(names.length ? "Please fix the highlighted fields." : message);
      return;
    }
    toast.success(`Project “${result.data.name}” created`);
    router.push(`/projects/${result.data.id}`);
  });

  return (
    <>
      <PageHeader
        back={<Link href="/projects" className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"><ArrowLeft className="size-3" aria-hidden />Projects</Link>}
        title="New project"
        description="Three quick steps. You can change everything except the authorization later."
      />

      <div className="mx-auto max-w-2xl">
        <ol className="mb-6 flex items-center gap-3" aria-label="Progress">
          {STEPS.map((label, index) => (
            <li key={label} className="flex flex-1 items-center gap-3 last:flex-none">
              <motion.span
                animate={{ scale: index === step ? 1.12 : 1 }}
                transition={bounce}
                aria-current={index === step ? "step" : undefined}
                className={cn("flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold", index < step ? "border-primary bg-primary text-primary-foreground" : index === step ? "border-primary text-primary" : "border-border text-subtle")}
              >
                {index < step ? <Check className="size-4" aria-hidden /> : index + 1}
              </motion.span>
              <span className={cn("hidden text-sm sm:block", index === step ? "font-semibold" : "text-muted")}>{label}</span>
              {index < STEPS.length - 1 && <span className="h-px flex-1 bg-border" aria-hidden />}
            </li>
          ))}
        </ol>

        <FormProvider {...methods}>
          <form
            noValidate
            onSubmit={(event) => {
              // Enter inside a field must advance the wizard, never create the project early.
              if (step < STEPS.length - 1) {
                event.preventDefault();
                void go(step + 1);
              } else void onSubmit(event);
            }}
          >
            <Card className="overflow-hidden">
              <AnimatePresence mode="wait" initial={false} custom={direction}>
                <motion.div
                  key={step}
                  custom={direction}
                  initial={{ opacity: 0, x: direction * 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: direction * -40 }}
                  transition={{ type: "spring", stiffness: 300, damping: 28 }}
                >
                  {step === 0 && <BasicsFields />}
                  {step === 1 && <TargetsFields />}
                  {step === 2 && (
                    <div className="space-y-5">
                      <div className="flex items-start gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><ShieldCheck className="size-5" aria-hidden /></span>
                        <div>
                          <h2 className="font-semibold">Authorization</h2>
                          <p className="mt-1 text-sm text-muted">Security testing can disrupt services and is illegal without permission. Confirm before continuing.</p>
                        </div>
                      </div>
                      <dl className="space-y-2 rounded-xl border border-border bg-surface-2/50 p-4 text-sm">
                        <div className="flex justify-between gap-4"><dt className="text-muted">Project</dt><dd className="truncate font-medium">{values.name}</dd></div>
                        {values.allow_sast && <div className="flex justify-between gap-4"><dt className="text-muted">Repository</dt><dd className="truncate font-medium">{values.repository_url} ({values.repository_branch || "default branch"})</dd></div>}
                        {values.allow_dast && <div className="flex justify-between gap-4"><dt className="text-muted">Target</dt><dd className="truncate font-medium">{values.target_url}{values.allow_active_dast ? " (active scans allowed)" : ""}</dd></div>}
                      </dl>
                      <Checkbox checked={!!confirmed} onChange={(v) => setValue("authorization_confirmed", v, { shouldDirty: true })} label="I own these systems, or have written permission to test them." />
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </Card>

            <div className="mt-5 flex items-center justify-between">
              <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => go(step - 1)} disabled={step === 0}>
                Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button onClick={() => go(step + 1)} icon={<ArrowRight className="size-4" />} className="flex-row-reverse">
                  Continue
                </Button>
              ) : (
                <Button type="submit" loading={isLoading} disabled={!confirmed}>
                  Create project
                </Button>
              )}
            </div>
          </form>
        </FormProvider>
      </div>
    </>
  );
}
