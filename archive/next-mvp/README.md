# VAPT Scanner

SAST + DAST security scanning platform. Next.js UI + REST API, orchestrating proven open-source engines in Docker.

| Mode | Engines | Finds |
|---|---|---|
| **SAST** (repo URL or local path) | Semgrep, Gitleaks, Trivy | Code vulns (SQLi, cmd injection, deserialization…), secrets incl. git history, vulnerable dependencies, Dockerfile/IaC misconfig |
| **DAST** (running app URL) | Built-in checks, Nuclei, OWASP ZAP | Security headers, cookies, CORS, TLS, exposed files (`.env`, `.git`), error leaks, known CVEs/misconfigs; with **active** mode: XSS, SQLi and other injection |

## Run

Requires Node 20+, git, and Docker running.

```bash
npm install
npm run build && npm start        # http://localhost:3000
```

The first scan pulls the scanner images and downloads Nuclei templates and the Trivy DB, so it's slow; later scans are faster.

Test target: `node scripts/vuln-server.mjs` starts a deliberately vulnerable app on http://localhost:4000 (localhost only, never deploy it).

## REST API

```
POST   /api/scans                 start a scan → 201 {id, status, ...}
GET    /api/scans                 list scans with severity counts
GET    /api/scans/:id             scan + findings (poll until status = done)
DELETE /api/scans/:id
GET    /api/scans/:id/report?format=html|json|sarif
```

```bash
# SAST
curl -X POST localhost:3000/api/scans -H 'content-type: application/json' \
  -d '{"type":"sast","repo":"https://github.com/org/repo","token":"<optional PAT>","authorized":true}'

# DAST (authHeader, openapiUrl, active are optional)
curl -X POST localhost:3000/api/scans -H 'content-type: application/json' \
  -d '{"type":"dast","url":"https://staging.example.com","authHeader":"Authorization: Bearer ...","openapiUrl":"https://staging.example.com/openapi.json","active":false,"authorized":true}'
```

`authorized: true` is required: only scan targets you own or have written permission to test. Tokens and auth headers are never written to disk.

SARIF output can be uploaded to GitHub code scanning (`github/codeql-action/upload-sarif`).

## Layout

```
lib/scans.ts    types, JSON-file storage, scan runner, dedupe
lib/sast.ts     clone + Semgrep/Gitleaks/Trivy + parsers
lib/dast.ts     built-in checks + Nuclei + ZAP + parsers
lib/report.ts   HTML / SARIF reports
app/api/...     REST routes
app/            dashboard UI
```

## Known limits / next steps

- Storage is one JSON file per scan in `data/`, and scans run inside the Next process (lost on restart). Next step: Postgres + a Redis queue worker.
- No user accounts or domain-ownership verification yet; it's a single-user local tool. Add both before exposing it on a network.
- Not yet built: false-positive marking, scheduling, CI integration, form-login auth flows, IDOR testing, Burp-style proxy/repeater.
- On Linux hosts, ZAP's container user may need write access to `data/work` (`chmod 777` or `-u root`).
