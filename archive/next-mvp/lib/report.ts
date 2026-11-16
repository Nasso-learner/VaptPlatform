import { SEVERITIES, type Scan } from "./scans";

export const counts = (scan: Scan) =>
  Object.fromEntries(SEVERITIES.map((s) => [s, scan.findings.filter((f) => f.severity === s).length])) as Record<string, number>;

const esc = (s: unknown = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function toHtml(scan: Scan): string {
  const c = counts(scan);
  const rows = scan.findings.map((f) => `
    <section class="f ${f.severity}">
      <h3><span class="sev">${esc(f.severity)}</span> ${esc(f.title)}</h3>
      <p class="meta">${esc(f.tool)} · ${esc(f.category)}${f.cwe ? ` · ${esc(f.cwe)}` : ""} · <code>${esc(f.location)}</code></p>
      ${f.description ? `<p>${esc(f.description)}</p>` : ""}
      ${f.evidence ? `<pre>${esc(f.evidence)}</pre>` : ""}
      ${f.fix ? `<p><b>Fix:</b> ${esc(f.fix)}</p>` : ""}
    </section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VAPT Report</title><style>
body{font:14px/1.5 system-ui,sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#111;background:#fff}
.sum{display:flex;gap:8px;flex-wrap:wrap}.sum div{padding:8px 14px;border-radius:6px;color:#fff;font-weight:600}
.critical{--c:#7f1d1d}.high{--c:#dc2626}.medium{--c:#d97706}.low{--c:#2563eb}.info{--c:#6b7280}
.sum div,.sev{background:var(--c)}.sev{color:#fff;padding:1px 8px;border-radius:4px;font-size:12px;text-transform:uppercase}
.f{border-left:4px solid var(--c);padding:4px 12px;margin:14px 0;break-inside:avoid}.meta{color:#555;margin:0}
pre{background:#f4f4f5;padding:8px;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px;text-align:left}
</style></head><body>
<h1>Security Assessment Report</h1>
<p><b>Target:</b> ${esc(scan.target)}<br><b>Type:</b> ${scan.type.toUpperCase()}${scan.options.active ? " (active)" : ""}<br>
<b>Started:</b> ${esc(scan.createdAt)}<br><b>Finished:</b> ${esc(scan.finishedAt ?? "-")}<br><b>Status:</b> ${esc(scan.status)}</p>
<h2>Summary</h2><div class="sum">${SEVERITIES.map((s) => `<div class="${s}">${s}: ${c[s]}</div>`).join("")}</div>
<h2>Tools</h2><table><tr><th>Tool</th><th>Status</th><th>Findings</th><th>Time</th></tr>
${scan.tools.map((t) => `<tr><td>${esc(t.tool)}</td><td>${esc(t.status)}${t.error ? `: ${esc(t.error.slice(0, 200))}` : ""}</td><td>${t.count}</td><td>${Math.round(t.ms / 1000)}s</td></tr>`).join("")}</table>
<h2>Findings (${scan.findings.length})</h2>${rows || "<p>No findings.</p>"}
</body></html>`;
}

/** SARIF 2.1.0 — upload to GitHub code scanning to see findings in the Security tab. */
export function toSarif(scan: Scan) {
  const level = (s: string) => (s === "critical" || s === "high" ? "error" : s === "medium" ? "warning" : "note");
  const tools = [...new Set(scan.findings.map((f) => f.tool))];
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: tools.map((tool) => ({
      tool: { driver: { name: tool } },
      results: scan.findings.filter((f) => f.tool === tool).map((f) => {
        const m = f.location.match(/^(.*):(\d+)$/);
        const isUrl = /^https?:/.test(f.location);
        return {
          ruleId: f.cwe ?? f.title,
          level: level(f.severity),
          message: { text: `${f.title}${f.description ? ` — ${f.description}` : ""}` },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: m && !isUrl ? m[1] : f.location },
              ...(m && !isUrl ? { region: { startLine: Number(m[2]) } } : {}),
            },
          }],
        };
      }),
    })),
  };
}
