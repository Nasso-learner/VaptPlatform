"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Pills } from "./Pills";

type Summary = { id: string; type: string; target: string; status: string; createdAt: string; counts: Record<string, number> };

export default function Home() {
  const [type, setType] = useState<"sast" | "dast">("sast");
  const [form, setForm] = useState<Record<string, any>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scans, setScans] = useState<Summary[]>([]);

  const load = () => fetch("/api/scans").then((r) => r.json()).then(setScans).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await fetch("/api/scans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, type }) });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error);
    setForm({});
    load();
  }

  return (
    <>
      <form className="card" onSubmit={submit}>
        <div className="tabs">
          <button type="button" className={type === "sast" ? "" : "ghost"} onClick={() => setType("sast")}>SAST · Source code</button>
          <button type="button" className={type === "dast" ? "" : "ghost"} onClick={() => setType("dast")}>DAST · Running app</button>
        </div>

        {type === "sast" ? (
          <>
            <label>Repository URL or local path
              <input type="text" required value={form.repo ?? ""} onChange={set("repo")} placeholder="https://github.com/org/repo  or  C:\code\my-app" />
            </label>
            <label>Access token (private repos only, not stored)
              <input type="password" value={form.token ?? ""} onChange={set("token")} autoComplete="off" />
            </label>
            <p className="hint">Runs Semgrep (code vulns), Gitleaks (secrets incl. git history), Trivy (vulnerable dependencies + IaC misconfig).</p>
          </>
        ) : (
          <>
            <label>Target URL
              <input type="text" required value={form.url ?? ""} onChange={set("url")} placeholder="https://staging.example.com" />
            </label>
            <label>OpenAPI / Swagger URL (optional, enables API scan)
              <input type="text" value={form.openapiUrl ?? ""} onChange={set("openapiUrl")} placeholder="https://staging.example.com/openapi.json" />
            </label>
            <label>Auth header (optional, not stored)
              <input type="password" value={form.authHeader ?? ""} onChange={set("authHeader")} placeholder="Authorization: Bearer eyJ…   or   Cookie: session=…" autoComplete="off" />
            </label>
            <label className="row"><input type="checkbox" checked={!!form.active} onChange={set("active")} />
              Active scan: send attack payloads (SQLi, XSS, …). Never against production without approval.
            </label>
            <p className="hint">Runs built-in checks (headers, cookies, CORS, TLS, exposed files, error leaks), Nuclei, and OWASP ZAP.</p>
          </>
        )}

        <label className="row"><input type="checkbox" checked={!!form.authorized} onChange={set("authorized")} required />
          I own this target or have written permission to test it.
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>{busy ? "Starting…" : "Start scan"}</button>
      </form>

      <div className="card scroll">
        <h2 style={{ marginTop: 0 }}>Scans</h2>
        <table>
          <thead><tr><th>Type</th><th>Target</th><th>Status</th><th>Findings</th><th>Started</th></tr></thead>
          <tbody>
            {scans.map((s) => (
              <tr key={s.id}>
                <td>{s.type.toUpperCase()}</td>
                <td><Link href={`/scans/${s.id}`}><code>{s.target}</code></Link></td>
                <td>{s.status}</td>
                <td><Pills counts={s.counts} /></td>
                <td>{new Date(s.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {!scans.length && <tr><td colSpan={5} className="hint">No scans yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
