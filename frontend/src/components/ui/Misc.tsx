"use client";

import { animate, AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { bounce, pop, riseIn, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { Button, IconButton } from "./Button";

/* ------------------------------------------------------------------ Skeleton / Empty */

export const Skeleton = ({ className }: { className?: string }) => <div aria-hidden className={cn("skeleton rounded-lg", className)} />;

export function TabLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-surface py-20">
      <span className="size-8 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={pop} className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex size-16 animate-float items-center justify-center rounded-2xl bg-primary-soft text-primary">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-critical/30 bg-critical/8 px-6 py-10 text-center">
      <p className="text-sm font-medium text-critical">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Motion helpers */

export function Stagger({ children, className, step = 0.055 }: { children: ReactNode; className?: string; step?: number }) {
  return (
    <motion.div variants={stagger(step)} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  );
}

export function Rise({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={riseIn} className={className}>
      {children}
    </motion.div>
  );
}

export function CountUp({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduce) {
      node.textContent = value.toFixed(decimals);
      return;
    }
    const controls = animate(0, value, { duration: 1.1, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => (node.textContent = v.toFixed(decimals)) });
    return () => controls.stop();
  }, [value, decimals, reduce]);
  return (
    <span ref={ref} className={className}>
      {value.toFixed(decimals)}
    </span>
  );
}

/* ------------------------------------------------------------------ Tabs */

export function Tabs<T extends string>({ items, value, onChange, className }: { items: { value: T; label: string; count?: number; icon?: ReactNode }[]; value: T; onChange: (value: T) => void; className?: string }) {
  const group = useId();
  return (
    <LayoutGroup id={group}>
      <div role="tablist" className={cn("flex gap-1 overflow-x-auto border-b border-border", className)}>
        {items.map((item) => {
          const active = item.value === value;
          return (
            <button
              key={item.value}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(item.value)}
              className={cn("relative flex shrink-0 cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors", active ? "text-foreground" : "text-muted hover:text-foreground")}
            >
              {item.icon}
              {item.label}
              {item.count !== undefined && <span className="rounded-full bg-surface-2 px-1.5 text-[11px] text-muted">{item.count}</span>}
              {active && <motion.span layoutId="tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" transition={{ type: "spring", stiffness: 520, damping: 28 }} />}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

/** Segmented control (used for view toggles and filters with few options). */
export function Segmented<T extends string>({ items, value, onChange, label }: { items: { value: T; label: string }[]; value: T; onChange: (value: T) => void; label: string }) {
  const group = useId();
  return (
    <LayoutGroup id={group}>
      <div role="group" aria-label={label} className="inline-flex rounded-xl border border-border bg-surface-2 p-1">
        {items.map((item) => (
          <button key={item.value} aria-pressed={item.value === value} onClick={() => onChange(item.value)} className={cn("relative cursor-pointer rounded-lg px-3 py-1 text-xs font-medium transition-colors", item.value === value ? "text-foreground" : "text-muted hover:text-foreground")}>
            {item.value === value && <motion.span layoutId="segment" className="absolute inset-0 rounded-lg bg-surface shadow-card" transition={{ type: "spring", stiffness: 500, damping: 30 }} />}
            <span className="relative">{item.label}</span>
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}

/** Multi-select pills, e.g. severity filters. */
export function ChipGroup<T extends string>({ options, selected, onChange, label }: { options: { value: T; label: string }[]; selected: T[]; onChange: (value: T[]) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <motion.button
            key={option.value}
            whileTap={{ scale: 0.88 }}
            transition={bounce}
            aria-pressed={active}
            onClick={() => onChange(active ? selected.filter((v) => v !== option.value) : [...selected, option.value])}
            className={cn("cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors", active ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-muted hover:border-subtle hover:text-foreground")}
          >
            {option.label}
          </motion.button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Pagination */

export function Pagination({ page, count, pageSize, onChange }: { page: number; count: number; pageSize: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (count <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(count, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted">
      <span>
        {from}–{to} of {count}
      </span>
      <div className="flex items-center gap-1">
        <IconButton label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <span className="min-w-16 text-center font-medium text-foreground">
          {page} / {pages}
        </span>
        <IconButton label="Next page" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          <ChevronRight className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Copy / Code */

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={copied ? "Copied" : label}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={copied ? "ok" : "copy"} initial={{ scale: 0.4, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0.4 }} transition={bounce}>
          {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
        </motion.span>
      </AnimatePresence>
    </IconButton>
  );
}

export function CodeBlock({ children, className, copy = true }: { children: string; className?: string; copy?: boolean }) {
  return (
    <div className={cn("group relative rounded-xl border border-border bg-surface-2", className)}>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-xs leading-relaxed text-foreground">{children}</pre>
      {copy && (
        <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <CopyButton value={children} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Dropdown menu */

export type MenuItem = { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; hidden?: boolean };

export function Menu({ trigger, items, align = "right", label }: { trigger: ReactNode; items: MenuItem[]; align?: "left" | "right"; label: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => !root.current?.contains(event.target as Node) && setOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="cursor-pointer rounded-xl">
        {trigger}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, scale: 0.88, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.1 } }}
            transition={{ type: "spring", stiffness: 520, damping: 24 }}
            style={{ transformOrigin: align === "right" ? "top right" : "top left" }}
            className={cn("absolute z-40 mt-2 min-w-52 rounded-2xl border border-border bg-surface p-1.5 shadow-pop", align === "right" ? "right-0" : "left-0")}
          >
            {items.filter((item) => !item.hidden).map((item) => (
              <button
                key={item.label}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn("flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2", item.danger ? "text-critical" : "text-foreground")}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
