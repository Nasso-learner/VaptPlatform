"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import type { ReactNode } from "react";

import { pop } from "@/lib/motion";
import { cn } from "@/lib/utils";

type CardProps = Omit<HTMLMotionProps<"div">, "children"> & { interactive?: boolean; children?: ReactNode; padded?: boolean };

export function Card({ interactive, padded = true, className, children, ...props }: CardProps) {
  return (
    <motion.div
      whileHover={interactive ? { y: -4, scale: 1.01 } : undefined}
      whileTap={interactive ? { scale: 0.985 } : undefined}
      transition={pop}
      className={cn("rounded-2xl border border-border bg-surface shadow-card", padded && "p-5", interactive && "cursor-pointer hover:border-primary/50", className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
