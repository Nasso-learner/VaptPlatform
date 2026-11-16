import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

export function timeAgo(iso?: string | null): string {
  if (!iso) return "never";
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function formatDate(iso?: string | null, withTime = true): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function formatDuration(seconds?: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m}m ${seconds % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function initials(name?: string, email?: string): string {
  const source = (name || email || "?").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function titleCase(value: string): string {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Turns any RTK Query / DRF error into one readable message plus per-field messages for forms. */
export function apiError(error: unknown): { message: string; fields: Record<string, string> } {
  const fallback = { message: "Something went wrong. Please try again.", fields: {} };
  if (!error || typeof error !== "object") return fallback;
  const data = (error as { data?: unknown }).data;
  if (data == null) return (error as { status?: string }).status === "FETCH_ERROR" ? { message: "Cannot reach the server.", fields: {} } : fallback;
  if (typeof data === "string") return { message: data.slice(0, 300), fields: {} };
  if (Array.isArray(data)) return { message: data.map(String).join(" "), fields: {} };
  const record = data as Record<string, unknown>;
  if (typeof record.detail === "string") return { message: record.detail, fields: {} };
  const fields: Record<string, string> = {};
  const lines: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    const text = Array.isArray(value) ? value.map(String).join(" ") : String(value);
    fields[key] = text;
    lines.push(key === "non_field_errors" ? text : `${titleCase(key)}: ${text}`);
  }
  return { message: lines.join(" ") || fallback.message, fields };
}

export const ROLE_RANK: Record<string, number> = { viewer: 1, analyst: 2, maintainer: 3, owner: 4 };
export function hasRole(role: string | null | undefined, minimum: keyof typeof ROLE_RANK, isStaff = false): boolean {
  return isStaff || (!!role && ROLE_RANK[role] >= ROLE_RANK[minimum]);
}
