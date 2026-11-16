import { promises as fs, existsSync } from "fs";
import path from "path";
import { DATA_DIR, fid, type Finding, type Severity } from "./scans";
import { docker, run, step, type OnTool } from "./exec";

export const IMAGES = {
  semgrep: "semgrep/semgrep:1.100.0",
  gitleaks: "zricethezav/gitleaks:v8.24.0",
  trivy: "aquasec/trivy:0.58.1",
};

export async function runSast(scanId: string, input: { repo: string; token?: string }, onTool: OnTool) {
  const work = path.join(DATA_DIR, "work", scanId);
  const out = path.join(work, "out");
  await fs.mkdir(out, { recursive: true });
  let src = input.repo;
  try {
    if (/^https:\/\//.test(input.repo)) {
      src = path.join(work, "src");
      const url = input.token ? input.repo.replace("https://", `https://oauth2:${encodeURIComponent(input.token)}@`) : input.repo;
      const r = await run("git", ["clone", "--quiet", "--", url, src], 10 * 60_000);
      if (r.code !== 0) throw new Error("git clone failed: " + redact(r.stderr, input.token));
    } else if (!(await fs.stat(src).catch(() => null))?.isDirectory()) {
      throw new Error(`local path not found: ${src}`);
    }
    const mount = ["-v", `${src}:/src:ro`];
    const isGit = existsSync(path.join(src, ".git"));

    await Promise.all([
      step("semgrep", onTool, async () => {
        const r = await docker([...mount, IMAGES.semgrep, "semgrep", "scan", "--config", "p/default", "--json", "--metrics=off", "--quiet", "/src"]);
        return parseSemgrep(json(r.stdout, "semgrep", r.stderr));
      }),
      step("gitleaks", onTool, async () => {
        const r = await docker([...mount, "-v", `${out}:/out`, IMAGES.gitleaks,
          isGit ? "git" : "dir", "/src", "--report-format", "json", "--report-path", "/out/gitleaks.json", "--redact", "--no-banner", "--exit-code", "0"]);
        const report = await fs.readFile(path.join(out, "gitleaks.json"), "utf8").catch(() => null);
        if (report === null) throw new Error(r.stderr.slice(-2000));
        return parseGitleaks(JSON.parse(report));
      }),
      step("trivy", onTool, async () => {
        const r = await docker([...mount, "-v", "vapt-trivy-cache:/root/.cache/trivy", IMAGES.trivy,
          "fs", "--scanners", "vuln,misconfig", "--format", "json", "--quiet", "/src"]);
        return parseTrivy(json(r.stdout, "trivy", r.stderr));
      }),
    ]);
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

const redact = (s: string, token?: string) => (token ? s.split(token).join("***") : s);
const json = (s: string, tool: string, stderr: string) => {
  try { return JSON.parse(s); } catch { throw new Error(`${tool} produced no JSON: ${stderr.slice(-2000)}`); }
};
const rel = (p: string) => p.replace(/^\/src\//, "");

export function parseSemgrep(r: any): Finding[] {
  const sev: Record<string, Severity> = { ERROR: "high", WARNING: "medium", INFO: "low" };
  return (r.results ?? []).map((x: any) => ({
    id: fid(), tool: "semgrep", category: "code",
    severity: sev[x.extra?.severity] ?? "low",
    title: x.check_id.split(".").pop(),
    description: x.extra?.message,
    location: `${rel(x.path)}:${x.start?.line}`,
    evidence: x.extra?.lines === "requires login" ? undefined : x.extra?.lines,
    cwe: [].concat(x.extra?.metadata?.cwe ?? [])[0],
    fix: x.extra?.fix,
  }));
}

export function parseGitleaks(r: any[]): Finding[] {
  return (r ?? []).map((x) => ({
    id: fid(), tool: "gitleaks", category: "secret", severity: "high",
    title: `Hardcoded secret: ${x.Description || x.RuleID}`,
    location: `${rel(x.File)}:${x.StartLine}`,
    evidence: x.Commit ? `commit ${x.Commit.slice(0, 8)} by ${x.Author}: ${x.Match}` : x.Match,
    cwe: "CWE-798",
    fix: "Revoke/rotate the secret, remove it from history, load it from env or a secrets manager.",
  }));
}

export function parseTrivy(r: any): Finding[] {
  const sev = (s: string): Severity => (({ CRITICAL: "critical", HIGH: "high", MEDIUM: "medium", LOW: "low" }) as any)[s] ?? "info";
  return (r.Results ?? []).flatMap((res: any) => [
    ...(res.Vulnerabilities ?? []).map((v: any) => ({
      id: fid(), tool: "trivy", category: "dependency", severity: sev(v.Severity),
      title: `${v.VulnerabilityID} in ${v.PkgName}@${v.InstalledVersion}`,
      description: v.Title,
      location: res.Target,
      cwe: v.CweIDs?.[0],
      fix: v.FixedVersion ? `Upgrade ${v.PkgName} to ${v.FixedVersion}` : "No fixed version yet",
    })),
    ...(res.Misconfigurations ?? []).filter((m: any) => m.Status === "FAIL").map((m: any) => ({
      id: fid(), tool: "trivy", category: "iac", severity: sev(m.Severity),
      title: `${m.ID}: ${m.Title}`,
      description: m.Description,
      location: m.CauseMetadata?.StartLine ? `${res.Target}:${m.CauseMetadata.StartLine}` : res.Target,
      fix: m.Resolution,
    })),
  ]);
}
