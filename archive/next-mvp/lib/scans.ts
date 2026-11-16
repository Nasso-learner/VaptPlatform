import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { runSast } from "./sast";
import { runDast } from "./dast";

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

export type Finding = {
  id: string;
  tool: string;
  category: "code" | "secret" | "dependency" | "iac" | "dast";
  severity: Severity;
  title: string;
  description?: string;
  location: string; // file:line or URL
  evidence?: string;
  cwe?: string;
  fix?: string;
};

export type ToolRun = { tool: string; status: "ok" | "error"; ms: number; count: number; error?: string };

export type ScanInput =
  | { type: "sast"; repo: string; token?: string }
  | { type: "dast"; url: string; authHeader?: string; openapiUrl?: string; active?: boolean };

export type Scan = {
  id: string;
  type: "sast" | "dast";
  target: string;
  options: { active?: boolean; openapiUrl?: string; authenticated?: boolean };
  status: "queued" | "running" | "done" | "failed";
  createdAt: string;
  finishedAt?: string;
  error?: string;
  tools: ToolRun[];
  findings: Finding[];
};

export const DATA_DIR = path.resolve(process.cwd(), "data");
const SCANS_DIR = path.join(DATA_DIR, "scans");

// ponytail: one JSON file per scan, swap for Postgres when you need multi-user/search
export async function saveScan(scan: Scan) {
  await fs.mkdir(SCANS_DIR, { recursive: true });
  await fs.writeFile(path.join(SCANS_DIR, `${scan.id}.json`), JSON.stringify(scan, null, 2));
}

export async function getScan(id: string): Promise<Scan | null> {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null; // blocks path traversal via id
  try {
    return JSON.parse(await fs.readFile(path.join(SCANS_DIR, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

export async function listScans(): Promise<Scan[]> {
  const files = await fs.readdir(SCANS_DIR).catch(() => [] as string[]);
  const scans = await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => getScan(f.slice(0, -5))));
  return (scans.filter(Boolean) as Scan[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function validateInput(body: any): ScanInput | string {
  if (body?.authorized !== true) return "You must confirm you own or are authorized to test this target.";
  if (body.type === "sast") {
    const repo = String(body.repo ?? "").trim();
    if (!/^https:\/\/[^\s]+$/.test(repo) && !path.isAbsolute(repo)) return "repo must be an https:// git URL or an absolute local path";
    return { type: "sast", repo, token: body.token ? String(body.token) : undefined };
  }
  if (body.type === "dast") {
    const url = String(body.url ?? "").trim();
    if (!/^https?:\/\/[^\s]+$/.test(url)) return "url must start with http:// or https://";
    const openapiUrl = body.openapiUrl ? String(body.openapiUrl).trim() : undefined;
    if (openapiUrl && !/^https?:\/\/[^\s]+$/.test(openapiUrl)) return "openapiUrl must be an http(s) URL";
    return { type: "dast", url, openapiUrl, authHeader: body.authHeader ? String(body.authHeader) : undefined, active: !!body.active };
  }
  return "type must be 'sast' or 'dast'";
}

export async function createScan(input: ScanInput): Promise<Scan> {
  const scan: Scan = {
    id: crypto.randomUUID(),
    type: input.type,
    // secrets (token, authHeader) are never persisted
    target: input.type === "sast" ? input.repo : input.url,
    options: input.type === "dast" ? { active: input.active, openapiUrl: input.openapiUrl, authenticated: !!input.authHeader } : {},
    status: "queued",
    createdAt: new Date().toISOString(),
    tools: [],
    findings: [],
  };
  await saveScan(scan);
  // ponytail: fire-and-forget inside the Next server process; move to a Redis queue + worker for scale/restarts
  void execute(scan, input);
  return scan;
}

async function execute(scan: Scan, input: ScanInput) {
  scan.status = "running";
  await saveScan(scan);
  try {
    const onTool = async (run: ToolRun, findings: Finding[]) => {
      scan.tools.push(run);
      scan.findings = dedupe([...scan.findings, ...findings]);
      await saveScan(scan);
    };
    if (input.type === "sast") await runSast(scan.id, input, onTool);
    else await runDast(scan.id, input, onTool);
    scan.status = "done";
  } catch (e: any) {
    scan.status = "failed";
    scan.error = String(e?.message ?? e);
  }
  scan.finishedAt = new Date().toISOString();
  await saveScan(scan);
}

export function dedupe(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.title}|${f.location}`.toLowerCase();
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}

export const fid = () => crypto.randomUUID().slice(0, 8);
