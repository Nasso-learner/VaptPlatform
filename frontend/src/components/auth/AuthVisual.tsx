"use client";

import { motion } from "framer-motion";
import { Bug, GitBranch, Globe, KeyRound, ShieldCheck } from "lucide-react";

import { LogoMark } from "@/components/layout/Logo";
import { riseIn, stagger } from "@/lib/motion";

const FEATURES = [
  { icon: GitBranch, title: "SAST, secrets and dependencies", text: "Semgrep, Gitleaks and Trivy run in isolation and report in one format." },
  { icon: Globe, title: "DAST against verified targets", text: "ZAP, Nuclei and built-in checks, only on domains you've proven you own." },
  { icon: ShieldCheck, title: "Deduplicated, scored, tracked", text: "Same issue from two engines appears once, with risk, priority and history." },
];

const BLIPS = [
  { top: "22%", left: "62%", delay: 0, tone: "bg-critical" },
  { top: "58%", left: "25%", delay: 0.9, tone: "bg-high" },
  { top: "70%", left: "68%", delay: 1.7, tone: "bg-medium" },
  { top: "34%", left: "30%", delay: 2.4, tone: "bg-primary" },
];

export function AuthVisual() {
  return (
    <div className="relative hidden flex-1 overflow-hidden border-r border-border lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div className="bg-grid absolute inset-0 opacity-70" aria-hidden />
      <div className="absolute -left-24 top-1/3 size-96 rounded-full bg-primary/15 blur-3xl" aria-hidden />

      <div className="relative flex items-center gap-3">
        <LogoMark className="size-10" />
        <span className="text-lg font-semibold tracking-tight">VAPT Platform</span>
      </div>

      <div className="relative mx-auto my-8 aspect-square w-full max-w-sm" aria-hidden>
        {[100, 72, 44].map((size) => (
          <div key={size} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/25" style={{ width: `${size}%`, height: `${size}%` }} />
        ))}
        <div className="absolute inset-0 animate-sweep rounded-full" style={{ background: "conic-gradient(from 0deg, transparent 0 300deg, color-mix(in oklab, var(--primary) 45%, transparent) 360deg)" }} />
        <div className="absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-primary/40 bg-surface shadow-glow">
          <ShieldCheck className="size-7 text-primary" />
        </div>
        {BLIPS.map((blip) => (
          <motion.span
            key={blip.top + blip.left}
            className={`absolute size-3 rounded-full ${blip.tone}`}
            style={{ top: blip.top, left: blip.left }}
            animate={{ scale: [1, 1.9, 1], opacity: [0.9, 0.35, 0.9] }}
            transition={{ duration: 2.4, repeat: Infinity, delay: blip.delay }}
          />
        ))}
        <motion.div className="absolute -right-2 top-6 flex items-center gap-2 rounded-xl border border-border bg-surface/90 px-3 py-2 text-xs shadow-card backdrop-blur" animate={{ y: [0, -8, 0] }} transition={{ duration: 4, repeat: Infinity }}>
          <Bug className="size-4 text-critical" /> SQL injection · P1
        </motion.div>
        <motion.div className="absolute -left-4 bottom-8 flex items-center gap-2 rounded-xl border border-border bg-surface/90 px-3 py-2 text-xs shadow-card backdrop-blur" animate={{ y: [0, 8, 0] }} transition={{ duration: 5, repeat: Infinity, delay: 0.5 }}>
          <KeyRound className="size-4 text-high" /> Hardcoded AWS key
        </motion.div>
      </div>

      <motion.ul variants={stagger(0.12, 0.2)} initial="hidden" animate="show" className="relative space-y-5">
        {FEATURES.map((feature) => (
          <motion.li key={feature.title} variants={riseIn} className="flex gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <feature.icon className="size-5" />
            </span>
            <div>
              <p className="font-medium">{feature.title}</p>
              <p className="text-sm text-muted">{feature.text}</p>
            </div>
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}
