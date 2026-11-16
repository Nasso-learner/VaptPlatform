"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Scan } from "@/lib/scans";
import { Pills, SEVS } from "../../Pills";

export default function ScanPage() {
  const { id } = useParams<{ id: string }>();
  const [scan, setScan] = useState<(Scan & { counts: Record<string, number> }) | null>(null);
  const [sev, setSev] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const load = () => fetch(`/api/scans/${id}`).then((r) => r.json()).then((s) => {
      setScan(s);
      if (s.status === "queued" || s.status === "running") t = setTimeout(load, 3000);
    });
    load();
    return () => clearTimeout(t);
  }, [id]);

  if (!scan) return <p>Loading…</p>;
  if ((scan as any).error && !scan.id) return <p className="error">Scan not found.</p>;

  const findings = scan.findings.filter((f) => (!sev || f.severity === sev) &&
    (!q || `${f.title} ${f.location} ${f.tool}`.toLowerCase().includes(q.toLowerCase())));
  const running = scan.status === "queued" || scan.status === "running";

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{scan.type.toUpperCase()} scan: <code>{scan.target}</code></h2>
        <p>Status: <b>{scan.status}</b>{running && " ⏳ (refreshing…)"} {scan.error && <span className="error">{scan.error}</span>}</p>
        <Pills counts={scan.counts} />
        <p className="pills" style={{ marginTop: 12 }}>
          <a className="btn" href={`/api/scans/${id}/report`} target="_blank">HTML report</a>
          <a className="btn" href={`/api/scans/${id}/report?format=json`}>JSON</a>
          <a className="btn" href={`/api/scans/${id}/report?format=sarif`}>SARIF</a>
        </p>
        <table>
          <thead><tr><th>Tool</th><th>Status</th><th>Findings</th><th>Time</th></tr></thead>
          <tbody>
            {scan.tools.map((t) => (
              <tr key={t.tool}><td>{t.tool}</td><td>{t.status}{t.error && <pre className="error">{t.error}</pre>}</td><td>{t.count}</td><td>{Math.round(t.ms / 1000)}s</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card scroll">
        <div className="pills" style={{ marginBottom: 8 }}>
          <select value={sev} onChange={(e) => setSev(e.target.value)} style={{ width: "auto" }}>
            <option value="">All severities</option>
            {SEVS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <input type="text" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "auto", flex: 1 }} />
        </div>
        <table>
          <thead><tr><th>Severity</th><th>Finding</th><th>Location</th><th>Tool</th></tr></thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.id}>
                <td><span className={`sev ${f.severity}`}>{f.severity}</span></td>
                <td>
                  <details>
                    <summary>{f.title}{f.cwe && <span className="hint"> · {f.cwe}</span>}</summary>
                    {f.description && <p>{f.description}</p>}
                    {f.evidence && <pre>{f.evidence}</pre>}
                    {f.fix && <p><b>Fix:</b> {f.fix}</p>}
                  </details>
                </td>
                <td><code>{f.location}</code></td>
                <td>{f.tool}</td>
              </tr>
            ))}
            {!findings.length && <tr><td colSpan={4} className="hint">{running ? "Scanning…" : "No findings."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
