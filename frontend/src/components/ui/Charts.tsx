"use client";

import { motion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { GRADE_TONE, SEVERITIES, SEVERITY_COLOR, SEVERITY_LABEL } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Grade, Severity } from "@/types/api";

import { CountUp } from "./Misc";

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--foreground)",
  fontSize: 12,
  boxShadow: "var(--shadow-lg)",
};

export function SeverityDonut({ counts, size = 190 }: { counts: Partial<Record<Severity, number>>; size?: number }) {
  const data = SEVERITIES.map((severity) => ({ severity, name: SEVERITY_LABEL[severity], value: counts[severity] ?? 0 })).filter((d) => d.value > 0);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`${total} open findings: ${data.map((d) => `${d.value} ${d.name}`).join(", ") || "none"}`}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={total ? data : [{ name: "None", value: 1 }]} dataKey="value" innerRadius="68%" outerRadius="100%" paddingAngle={total ? 3 : 0} stroke="none" cornerRadius={6} animationDuration={900} animationEasing="ease-out">
              {total ? data.map((d) => <Cell key={d.severity} fill={SEVERITY_COLOR[d.severity]} />) : <Cell fill="var(--surface-2)" />}
            </Pie>
            {total > 0 && <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "var(--foreground)" }} />}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <CountUp value={total} className="text-3xl font-semibold tabular-nums" />
          <span className="text-xs text-muted">open</span>
        </div>
      </div>
      <ul className="space-y-1.5 text-sm">
        {SEVERITIES.map((severity) => (
          <li key={severity} className="flex items-center gap-2.5">
            <span className="size-2.5 rounded-full" style={{ background: SEVERITY_COLOR[severity] }} aria-hidden />
            <span className="w-16 text-muted">{SEVERITY_LABEL[severity]}</span>
            <span className="font-semibold tabular-nums">{counts[severity] ?? 0}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TrendChart({ data }: { data: { day: string; sast: number; dast: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: new Date(d.day).toLocaleDateString("en", { month: "short", day: "numeric" }) }));
  return (
    <div className="h-56 w-full" role="img" aria-label="Scans per day over the last 30 days">
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
          <defs>
            {[["sast", "var(--primary)"], ["dast", "var(--accent)"]].map(([key, color]) => (
              <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "var(--subtle)", fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: "var(--subtle)", fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "var(--border)" }} />
          <Area type="monotone" dataKey="sast" name="SAST" stroke="var(--primary)" strokeWidth={2.5} fill="url(#fill-sast)" animationDuration={1000} />
          <Area type="monotone" dataKey="dast" name="DAST" stroke="var(--accent)" strokeWidth={2.5} fill="url(#fill-dast)" animationDuration={1200} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars that grow in with a springy overshoot. */
export function BarList({ items, color = "var(--primary)" }: { items: { label: string; value: number; sub?: string }[]; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="py-6 text-center text-sm text-muted">Nothing to show yet.</p>;
  return (
    <ul className="space-y-3">
      {items.map((item, index) => (
        <li key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{item.label}</span>
            <span className="shrink-0 font-semibold tabular-nums">{item.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <motion.div
              className="h-full rounded-full"
              style={{ background: color }}
              initial={{ width: 0 }}
              animate={{ width: `${(item.value / max) * 100}%` }}
              transition={{ type: "spring", stiffness: 140, damping: 14, delay: index * 0.07 }}
            />
          </div>
          {item.sub && <p className="mt-0.5 text-xs text-subtle">{item.sub}</p>}
        </li>
      ))}
    </ul>
  );
}

/** Score ring: stroke animates to score/10, grade letter in the middle. */
export function RiskRing({ score, grade, size = 72, className }: { score: string | number | null; grade?: Grade | ""; size?: number; className?: string }) {
  const value = score == null ? 0 : Number(score);
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = grade ? GRADE_TONE[grade] : "var(--subtle)";
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }} role="img" aria-label={grade ? `Risk grade ${grade}, score ${value.toFixed(1)} of 10` : "Not scanned yet"}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-2)" strokeWidth={6} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - Math.min(value, 10) / 10) }}
          transition={{ type: "spring", stiffness: 60, damping: 12, delay: 0.1 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-semibold" style={{ color, fontSize: size * 0.3 }}>
          {grade || "–"}
        </span>
        {grade && <span className="mt-0.5 text-subtle tabular-nums" style={{ fontSize: size * 0.14 }}>{value.toFixed(1)}</span>}
      </div>
    </div>
  );
}
