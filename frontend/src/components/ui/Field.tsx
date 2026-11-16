"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, ChevronDown } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";

import { bounce } from "@/lib/motion";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground placeholder:text-subtle transition-[border-color,box-shadow] duration-150 " +
  "hover:border-subtle focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60";

type FieldShellProps = { label?: string; hint?: string; error?: string; required?: boolean; htmlFor: string; children: ReactNode; className?: string };

export function FieldShell({ label, hint, error, required, htmlFor, children, className }: FieldShellProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-xs font-medium text-muted">
          {label} {required && <span className="text-critical" aria-hidden>*</span>}
        </label>
      )}
      {children}
      <AnimatePresence initial={false} mode="wait">
        {error ? (
          <motion.p
            key="error"
            id={`${htmlFor}-msg`}
            role="alert"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={bounce}
            className="flex items-center gap-1.5 text-xs text-critical"
          >
            <AlertCircle className="size-3.5 shrink-0" aria-hidden /> {error}
          </motion.p>
        ) : hint ? (
          <p key="hint" id={`${htmlFor}-msg`} className="text-xs text-subtle">
            {hint}
          </p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

type InputProps = Omit<ComponentProps<"input">, "size"> & { label?: string; hint?: string; error?: string; icon?: ReactNode; trailing?: ReactNode };

export function Input({ label, hint, error, icon, trailing, className, id, required, ...props }: InputProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} htmlFor={fieldId}>
      <div className="relative">
        {icon && <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-subtle">{icon}</span>}
        <input
          id={fieldId}
          required={required}
          aria-invalid={!!error}
          aria-describedby={error || hint ? `${fieldId}-msg` : undefined}
          className={cn(control, "h-10", icon && "pl-10", trailing && "pr-11", error && "border-critical focus:border-critical focus:ring-critical/15", className)}
          {...props}
        />
        {trailing && <span className="absolute inset-y-0 right-1.5 flex items-center">{trailing}</span>}
      </div>
    </FieldShell>
  );
}

export function Textarea({ label, hint, error, className, id, required, ...props }: ComponentProps<"textarea"> & { label?: string; hint?: string; error?: string }) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} htmlFor={fieldId}>
      <textarea
        id={fieldId}
        aria-invalid={!!error}
        aria-describedby={error || hint ? `${fieldId}-msg` : undefined}
        className={cn(control, "min-h-24 resize-y py-2.5", error && "border-critical", className)}
        {...props}
      />
    </FieldShell>
  );
}

export function Select({ label, hint, error, className, id, children, required, ...props }: ComponentProps<"select"> & { label?: string; hint?: string; error?: string }) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} htmlFor={fieldId}>
      <div className="relative">
        <select id={fieldId} aria-invalid={!!error} className={cn(control, "h-10 cursor-pointer appearance-none pr-9", error && "border-critical", className)} {...props}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
      </div>
    </FieldShell>
  );
}

type SwitchProps = { checked: boolean; onChange: (checked: boolean) => void; label: string; description?: string; disabled?: boolean; id?: string };

/** Toggle with a springy thumb. Rendered as a real button with role="switch" for keyboard and screen-reader support. */
export function Switch({ checked, onChange, label, description, disabled, id }: SwitchProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className={cn("flex items-start justify-between gap-4", disabled && "opacity-60")}>
      <div className="min-w-0">
        <label htmlFor={fieldId} className="block cursor-pointer text-sm font-medium">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      <button
        id={fieldId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200", checked ? "bg-primary" : "bg-border")}
      >
        <motion.span
          className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow"
          animate={{ x: checked ? 20 : 0 }}
          transition={{ type: "spring", stiffness: 600, damping: 16 }}
        />
      </button>
    </div>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors", checked ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface")}
      >
        <AnimatePresence>
          {checked && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={bounce}>
              <Check className="size-3.5" strokeWidth={3} aria-hidden />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <span className="text-muted">{label}</span>
    </label>
  );
}
