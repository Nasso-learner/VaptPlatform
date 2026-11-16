"use client";

import { motion } from "framer-motion";

import { bounce } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <motion.svg
      viewBox="0 0 32 32"
      className={cn("size-9", className)}
      whileHover={{ rotate: [0, -8, 8, 0], scale: 1.1 }}
      transition={bounce}
      aria-hidden
    >
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--primary)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
      <path d="M16 2.5 4.5 7v8.2c0 7 4.8 12.2 11.5 14.3 6.7-2.1 11.5-7.3 11.5-14.3V7L16 2.5Z" fill="url(#logo-g)" opacity="0.18" stroke="url(#logo-g)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10.5 16.2 14.4 20l7.2-8" fill="none" stroke="url(#logo-g)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </motion.svg>
  );
}

export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      {!collapsed && (
        <div className="leading-none">
          <div className="text-[15px] font-semibold tracking-tight">VAPT</div>
          <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-subtle">Platform</div>
        </div>
      )}
    </div>
  );
}
