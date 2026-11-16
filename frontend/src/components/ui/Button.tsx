"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { bounce } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg shadow-sm hover:shadow-glow hover:brightness-110",
  secondary: "bg-surface-2 text-foreground hover:bg-border/70",
  outline: "border border-border bg-surface text-foreground hover:border-primary/60 hover:bg-primary-soft",
  ghost: "text-muted hover:bg-surface-2 hover:text-foreground",
  danger: "bg-critical text-white hover:brightness-110",
};
const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-10 gap-2 px-4 text-sm",
  lg: "h-12 gap-2 px-6 text-base",
  icon: "size-10 justify-center",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-xl font-medium transition-colors duration-150",
    "disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

type ButtonProps = Omit<HTMLMotionProps<"button">, "children"> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode; children?: ReactNode };

export function Button({ variant = "primary", size = "md", loading, icon, children, className, disabled, type = "button", ...props }: ButtonProps) {
  return (
    <motion.button
      type={type}
      whileHover={disabled || loading ? undefined : { scale: 1.04 }}
      whileTap={disabled || loading ? undefined : { scale: 0.93 }}
      transition={bounce}
      disabled={disabled || loading}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </motion.button>
  );
}

const MotionLink = motion.create(Link);

type ButtonLinkProps = Omit<ComponentProps<typeof MotionLink>, "children"> & { variant?: Variant; size?: Size; icon?: ReactNode; children?: ReactNode };

export function ButtonLink({ variant = "primary", size = "md", icon, children, className, ...props }: ButtonLinkProps) {
  return (
    <MotionLink whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.93 }} transition={bounce} className={buttonClasses(variant, size, className)} {...props}>
      {icon}
      {children}
    </MotionLink>
  );
}

/** Icon-only button: requires a label so it is announced properly. */
export function IconButton({ label, className, children, ...props }: Omit<ButtonProps, "size" | "icon"> & { label: string }) {
  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label} className={cn("size-9 rounded-lg", className)} {...props}>
      {children}
    </Button>
  );
}
