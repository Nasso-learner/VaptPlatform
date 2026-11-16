import { promises as fs } from "fs";
import path from "path";
import tls from "tls";
import { DATA_DIR, fid, type Finding, type Severity } from "./scans";
import { docker, step, stripHtml, type OnTool } from "./exec";

export const IMAGES = {
  nuclei: "projectdiscovery/nuclei:v3.4.2",
  zap: "ghcr.io/zaproxy/zaproxy:2.16.0",
};

type DastInput = { url: string; authHeader?: string; openapiUrl?: string; active?: boolean };

export async function runDast(scanId: string, input: DastInput, report: OnTool) {
  const auth = parseHeader(input.authHeader);
  // show findings against the host the user typed, not the docker alias
  const host = new URL(input.url).hostname;
  const unalias = (s?: string) => s?.replaceAll("//host.docker.internal", `//${host}`);
  const onTool: OnTool = (run, fs) => report(run, fs.map((f) => ({ ...f, location: unalias(f.location)!, evidence: unalias(f.evidence) })));
  const work = path.join(DATA_DIR, "work", scanId);
  await fs.mkdir(work, { recursive: true });
  try {
    await Promise.all([
      step("builtin-checks", onTool, () => builtinChecks(input.url, auth)),
      step("nuclei", onTool, () => nuclei(input, auth)),
      step(input.openapiUrl ? "zap-api" : input.active ? "zap-full" : "zap-baseline", onTool, () => zap(input, auth, work)),
    ]);
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

function parseHeader(h?: string): [string, string] | undefined {
  const i = h?.indexOf(":") ?? -1;
  return h && i > 0 ? [h.slice(0, i).trim(), h.slice(i + 1).trim()] : undefined;
}

/** Containers can't reach the host's "localhost". */
const forDocker = (u: string) => u.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/i, "$1host.docker.internal");

const f = (severity: Severity, title: string, location: string, extra: Partial<Finding> = {}): Finding => ({
  id: fid(), tool: "builtin", category: "dast", severity, title, location, ...extra,
});

// ---------- built-in checks (no docker needed) ----------

const EXPOSED: [string, RegExp, Severity][] = [
  ["/.git/HEAD", /^ref: /, "high"],
  ["/.git/config", /\[core\]/, "high"],
  ["/.env", /^[A-Z_][A-Z0-9_]*=/m, "critical"],
  ["/server-status", /Apache Server Status/i, "medium"],
  ["/phpinfo.php", /phpinfo\(\)/, "medium"],
  ["/actuator/env", /"propertySources"/, "high"],
  ["/.DS_Store", /Bud1/, "low"],
];
const STACK_TRACE = /Traceback \(most recent call last\)|\bat [\w$.]+\([\w]+\.java:\d+\)|SQLSTATE\[|ORA-\d{5}|You have an error in your SQL syntax|Microsoft OLE DB|<b>(Fatal error|Warning)<\/b>:|System\.\w+Exception/;

export async function builtinChecks(url: string, auth?: [string, string]): Promise<Finding[]> {
  const out: Finding[] = [];
  const headers: Record<string, string> = auth ? { [auth[0]]: auth[1] } : {};
  const get = (u: string, extra: Record<string, string> = {}) =>
    fetch(u, { headers: { ...headers, ...extra }, redirect: "manual", signal: AbortSignal.timeout(15_000) });

  const res = await get(url);
  const h = res.headers;
  const https = url.startsWith("https://");

  // security headers
  const csp = h.get("content-security-policy");
  if (!csp) out.push(f("medium", "Missing Content-Security-Policy header", url, { cwe: "CWE-693", fix: "Add a restrictive Content-Security-Policy." }));
  if (!h.get("x-frame-options") && !/frame-ancestors/i.test(csp ?? ""))
    out.push(f("medium", "Clickjacking: no X-Frame-Options or CSP frame-ancestors", url, { cwe: "CWE-1021", fix: "Set X-Frame-Options: DENY or CSP frame-ancestors 'none'." }));
  if (h.get("x-content-type-options")?.toLowerCase() !== "nosniff")
    out.push(f("low", "Missing X-Content-Type-Options: nosniff", url, { cwe: "CWE-693" }));
  if (!h.get("referrer-policy")) out.push(f("low", "Missing Referrer-Policy header", url));
  if (https && !h.get("strict-transport-security"))
    out.push(f("medium", "Missing Strict-Transport-Security (HSTS)", url, { cwe: "CWE-319", fix: "Strict-Transport-Security: max-age=31536000; includeSubDomains" }));
  for (const name of ["server", "x-powered-by", "x-aspnet-version"]) {
    const v = h.get(name);
    if (v && /\d/.test(v)) out.push(f("low", `Version disclosure in ${name} header`, url, { evidence: `${name}: ${v}`, cwe: "CWE-200" }));
  }

  // cookies
  for (const c of h.getSetCookie()) {
    const name = c.split("=")[0];
    const missing = [https && !/;\s*secure/i.test(c) && "Secure", !/;\s*httponly/i.test(c) && "HttpOnly", !/;\s*samesite/i.test(c) && "SameSite"].filter(Boolean);
    if (missing.length) out.push(f("medium", `Cookie '${name}' missing ${missing.join(", ")}`, url, { evidence: c.split(";").slice(1).join(";"), cwe: "CWE-614" }));
  }

  // CORS
  const evil = "https://evil.example";
  const cors = await get(url, { Origin: evil }).catch(() => null);
  const acao = cors?.headers.get("access-control-allow-origin");
  if (acao === evil || acao === "null") {
    const creds = cors?.headers.get("access-control-allow-credentials") === "true";
    out.push(f(creds ? "high" : "medium", `CORS reflects arbitrary Origin${creds ? " with credentials" : ""}`, url, { evidence: `Origin: ${evil} -> ACAO: ${acao}`, cwe: "CWE-942" }));
  } else if (acao === "*") out.push(f("low", "CORS allows any origin (*)", url, { cwe: "CWE-942" }));

  // exposed files
  const base = new URL(url);
  await Promise.all(EXPOSED.map(async ([p, sig, sev]) => {
    const u = new URL(p, base).href;
    const r = await get(u).catch(() => null);
    if (r?.status === 200 && sig.test((await r.text()).slice(0, 5000)))
      out.push(f(sev, `Sensitive file exposed: ${p}`, u, { cwe: "CWE-538", fix: "Block this path at the web server and remove the file from the web root." }));
  }));

  // verbose errors
  const probe = new URL(`/vapt-${Date.now()}?id=1'"%3C`, base).href;
  const errBody = await get(probe).then((r) => r.text()).catch(() => "");
  const m = errBody.match(STACK_TRACE);
  if (m) out.push(f("medium", "Verbose error / stack trace disclosed", probe, { evidence: m[0], cwe: "CWE-209", fix: "Return generic error pages in production." }));

  if (https) {
    out.push(...(await tlsCheck(base)));
    const plain = await get(url.replace(/^https:/, "http:")).catch(() => null);
    if (plain && !(plain.status >= 300 && plain.status < 400 && plain.headers.get("location")?.startsWith("https://")))
      out.push(f("medium", "HTTP not redirected to HTTPS", url.replace(/^https:/, "http:"), { cwe: "CWE-319" }));
  }
  return out;
}

function tlsCheck(u: URL): Promise<Finding[]> {
  return new Promise((resolve) => {
    const s = tls.connect({ host: u.hostname, port: Number(u.port || 443), servername: u.hostname, rejectUnauthorized: false, timeout: 10_000 }, () => {
      const out: Finding[] = [];
      const cert = s.getPeerCertificate();
      const days = (new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000;
      if (!s.authorized) out.push(f("high", `Invalid TLS certificate: ${s.authorizationError}`, u.origin, { cwe: "CWE-295" }));
      else if (days < 30) out.push(f("medium", `TLS certificate expires in ${Math.floor(days)} days`, u.origin));
      const proto = s.getProtocol();
      if (proto && /TLSv1(\.[01])?$/.test(proto)) out.push(f("high", `Outdated TLS protocol negotiated: ${proto}`, u.origin, { cwe: "CWE-326" }));
      s.end();
      resolve(out);
    });
    s.on("error", () => resolve([]));
    s.on("timeout", () => { s.destroy(); resolve([]); });
  });
}

// ---------- nuclei ----------

async function nuclei(input: DastInput, auth?: [string, string]): Promise<Finding[]> {
  const args = ["-v", "vapt-nuclei:/root", IMAGES.nuclei, "-u", forDocker(input.url), "-jsonl", "-silent", "-nc",
    "-s", "low,medium,high,critical", "-rl", "50"];
  if (!input.active) args.push("-etags", "intrusive,fuzz,dos");
  if (auth) args.push("-H", `${auth[0]}: ${auth[1]}`);
  const r = await docker(args, 60 * 60_000);
  if (r.code !== 0 && !r.stdout) throw new Error(r.stderr.slice(-2000));
  return parseNuclei(r.stdout);
}

export function parseNuclei(jsonl: string): Finding[] {
  return jsonl.split("\n").filter((l) => l.startsWith("{")).map((l) => {
    const x = JSON.parse(l);
    return {
      id: fid(), tool: "nuclei", category: "dast" as const,
      severity: (x.info?.severity ?? "info") as Severity,
      title: x.info?.name ?? x["template-id"],
      description: x.info?.description,
      location: x["matched-at"] ?? x.host,
      evidence: x["extracted-results"]?.join(", "),
      cwe: x.info?.classification?.["cwe-id"]?.[0]?.toUpperCase(),
      fix: x.info?.remediation,
    };
  });
}

// ---------- OWASP ZAP ----------

async function zap(input: DastInput, auth: [string, string] | undefined, work: string): Promise<Finding[]> {
  const env = auth ? ["-e", `ZAP_AUTH_HEADER=${auth[0]}`, "-e", `ZAP_AUTH_HEADER_VALUE=${auth[1]}`] : [];
  const script = input.openapiUrl
    ? ["zap-api-scan.py", "-t", forDocker(input.openapiUrl), "-f", "openapi"]
    : [input.active ? "zap-full-scan.py" : "zap-baseline.py", "-t", forDocker(input.url), "-m", "3"];
  const r = await docker(["-v", `${work}:/zap/wrk:rw`, ...env, IMAGES.zap, ...script, "-J", "zap.json", "-I"], 90 * 60_000);
  const report = await fs.readFile(path.join(work, "zap.json"), "utf8").catch(() => null);
  if (report === null) throw new Error(r.stdout.slice(-1500) + r.stderr.slice(-1500));
  return parseZap(JSON.parse(report));
}

export function parseZap(r: any): Finding[] {
  const sev: Severity[] = ["info", "low", "medium", "high"];
  // 10116 = "ZAP is Out of Date", noise about the scanner itself
  return (r.site ?? []).flatMap((site: any) => (site.alerts ?? []).filter((a: any) => a.pluginid !== "10116").map((a: any) => {
    const inst = a.instances ?? [];
    return {
      id: fid(), tool: "zap", category: "dast" as const,
      severity: sev[Number(a.riskcode)] ?? "info",
      title: a.name,
      description: stripHtml(a.desc),
      location: inst[0]?.uri ?? site["@name"],
      evidence: inst.slice(0, 5).map((i: any) => `${i.method} ${i.uri}${i.param ? ` [${i.param}]` : ""}${i.evidence ? ` → ${i.evidence}` : ""}`).join("\n")
        + (inst.length > 5 ? `\n…and ${inst.length - 5} more` : ""),
      cwe: a.cweid && a.cweid !== "-1" && a.cweid !== "0" ? `CWE-${a.cweid}` : undefined,
      fix: stripHtml(a.solution),
    };
  }));
}
