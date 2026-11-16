import { spawn } from "child_process";
import type { Finding, ToolRun } from "./scans";

export type OnTool = (run: ToolRun, findings: Finding[]) => Promise<void>;

/** Run a command without a shell (no injection), resolve with output whatever the exit code. */
export function run(cmd: string, args: string[], timeoutMs = 30 * 60_000) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.on("error", reject);
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export const docker = (args: string[], timeoutMs?: number) =>
  run("docker", ["run", "--rm", "--add-host=host.docker.internal:host-gateway", ...args], timeoutMs);

/** Time a tool, record its findings, never let one tool's failure kill the scan. */
export async function step(tool: string, onTool: OnTool, fn: () => Promise<Finding[]>) {
  const start = Date.now();
  try {
    const findings = await fn();
    await onTool({ tool, status: "ok", ms: Date.now() - start, count: findings.length }, findings);
  } catch (e: any) {
    await onTool({ tool, status: "error", ms: Date.now() - start, count: 0, error: String(e?.message ?? e).slice(0, 2000) }, []);
  }
}

export const stripHtml = (s = "") => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
