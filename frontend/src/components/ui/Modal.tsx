"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import { Button, IconButton } from "./Button";
import { Input } from "./Field";

type OverlayProps = { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl" };

const WIDTHS = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" };

function usePortalTarget() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setTarget(document.body), []);
  return target;
}

/** Locks page scroll, closes on Escape, moves focus into the overlay and restores it on close. */
function useOverlayBehavior(open: boolean, onCloseProp: () => void, panel: React.RefObject<HTMLDivElement | null>) {
  // Keep the latest handler in a ref so inline callbacks don't re-run the effect (and steal focus) on every render.
  const closeRef = useRef(onCloseProp);
  useEffect(() => {
    closeRef.current = onCloseProp;
  });
  useEffect(() => {
    if (!open) return;
    const onClose = () => closeRef.current();
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && panel.current) {
        const focusable = panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) (event.preventDefault(), last.focus());
        else if (!event.shiftKey && document.activeElement === last) (event.preventDefault(), first.focus());
      }
    };
    document.addEventListener("keydown", onKey);
    const timer = setTimeout(() => panel.current?.querySelector<HTMLElement>("[data-autofocus],input,select,textarea")?.focus(), 60);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, panel]);
}

export function Modal({ open, onClose, title, description, children, footer, size = "md" }: OverlayProps) {
  const target = usePortalTarget();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlayBehavior(open, onClose, panel);
  if (!target) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, scale: 0.86, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 420, damping: 24 }}
            className={cn("relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-border bg-surface shadow-pop sm:rounded-3xl", WIDTHS[size])}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="text-lg font-semibold tracking-tight">
                  {title}
                </h2>
                {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
              </div>
              <IconButton label="Close dialog" onClick={onClose}>
                <X className="size-5" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-2/50 px-6 py-3.5 sm:rounded-b-3xl">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    target,
  );
}

export function Drawer({ open, onClose, title, description, children, footer, size = "lg" }: OverlayProps) {
  const target = usePortalTarget();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlayBehavior(open, onClose, panel);
  if (!target) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <motion.div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden />
          <motion.aside
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%", transition: { duration: 0.2 } }}
            transition={{ type: "spring", stiffness: 360, damping: 32 }}
            className={cn("relative flex h-full w-full flex-col border-l border-border bg-surface shadow-pop", size === "lg" ? "max-w-2xl" : "max-w-md")}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="text-lg font-semibold leading-snug tracking-tight">
                  {title}
                </h2>
                {description && <div className="mt-1 text-sm text-muted">{description}</div>}
              </div>
              <IconButton label="Close panel" onClick={onClose}>
                <X className="size-5" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="border-t border-border bg-surface-2/50 px-6 py-3.5">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    target,
  );
}

type ConfirmProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  loading?: boolean;
  /** Destructive actions can require typing a phrase (e.g. the project name) before the button enables. */
  requirePhrase?: string;
};

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "Confirm", loading, requirePhrase }: ConfirmProps) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={loading} disabled={!!requirePhrase && typed !== requirePhrase} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-muted">
        <div>{description}</div>
        {requirePhrase && <Input label={`Type "${requirePhrase}" to confirm`} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" />}
      </div>
    </Modal>
  );
}
