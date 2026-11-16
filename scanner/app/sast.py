"""SAST engines: each runs in its own sandboxed container against a read-only checkout and is normalized to Finding."""
import json
import os

from .runner import WORK_VOLUME, EngineError, docker, tail
from .schemas import Finding

IMAGES = {
    "semgrep": "semgrep/semgrep:1.100.0",
    "gitleaks": "zricethezav/gitleaks:v8.24.0",
    "trivy": "aquasec/trivy:0.58.1",
}
RO = ["-v", f"{WORK_VOLUME}:/work:ro"]


def _json(stdout: str, engine: str, stderr: str):
    try:
        return json.loads(stdout)
    except json.JSONDecodeError as e:
        raise EngineError(f"{engine} produced no JSON: {tail(stderr)}") from e


def _rel(path: str, src: str) -> str:
    return path.removeprefix(src).lstrip("/")


def semgrep(src: str) -> list[Finding]:
    r = docker([*RO, IMAGES["semgrep"], "semgrep", "scan", "--config", "p/default", "--json", "--metrics=off",
                "--quiet", "--timeout", "30", src], timeout=3600)
    return parse_semgrep(_json(r.stdout, "semgrep", r.stderr), src)


def parse_semgrep(data: dict, src: str) -> list[Finding]:
    sev = {"ERROR": "high", "WARNING": "medium", "INFO": "low"}
    out = []
    for x in data.get("results", []):
        extra, meta = x.get("extra", {}), x.get("extra", {}).get("metadata", {})
        cwe = (meta.get("cwe") or [None])
        owasp = (meta.get("owasp") or [None])
        lines = extra.get("lines", "")
        conf = str(meta.get("confidence", "")).lower()
        out.append(Finding(
            engine="semgrep", category="secret" if "secrets" in x["check_id"] else "code",
            rule_id=x["check_id"], title=x["check_id"].split(".")[-1].replace("-", " ").capitalize(),
            description=extra.get("message", ""), severity=sev.get(extra.get("severity"), "low"),
            confidence=conf if conf in ("high", "medium", "low") else "medium",
            cwe=(cwe[0] if isinstance(cwe, list) else cwe or "").split(":")[0] or None,
            owasp=owasp[0] if isinstance(owasp, list) else owasp,
            file_path=_rel(x["path"], src), line=x.get("start", {}).get("line"),
            evidence="" if lines == "requires login" else lines, remediation=extra.get("fix", "") or "",
            references=meta.get("references", [])[:5],
        ))
    return out


def gitleaks(src: str) -> list[Finding]:
    is_git = os.path.isdir(os.path.join(src, ".git"))
    r = docker([*RO, IMAGES["gitleaks"], "git" if is_git else "dir", src, "--report-format", "json",
                "--report-path", "/dev/stdout", "--redact", "--no-banner", "--log-level", "error", "--exit-code", "0"], timeout=1800)
    if r.returncode != 0:
        raise EngineError(tail(r.stderr))
    return parse_gitleaks(_json(r.stdout or "[]", "gitleaks", r.stderr), src)


def parse_gitleaks(data: list, src: str) -> list[Finding]:
    return [Finding(
        engine="gitleaks", category="secret", rule_id=x.get("RuleID", "secret"),
        title=f"Hardcoded secret: {x.get('RuleID', 'secret')}", description=x.get("Description", ""),
        severity="high", confidence="medium", cwe="CWE-798",
        file_path=_rel(x.get("File", ""), src), line=x.get("StartLine"),
        evidence=(f"commit {x['Commit'][:10]} ({x.get('Date', '')[:10]}): " if x.get("Commit") else "") + x.get("Match", ""),
        remediation="Revoke and rotate this credential, purge it from git history, and load it from environment or a secrets manager.",
    ) for x in data or []]


def trivy(src: str) -> list[Finding]:
    r = docker([*RO, "-v", "vapt-trivy-cache:/root/.cache/trivy", IMAGES["trivy"], "fs", "--scanners", "vuln,misconfig",
                "--format", "json", "--quiet", src], timeout=3600)
    return parse_trivy(_json(r.stdout, "trivy", r.stderr), src)


def parse_trivy(data: dict, src: str) -> list[Finding]:
    sev = lambda s: {"CRITICAL": "critical", "HIGH": "high", "MEDIUM": "medium", "LOW": "low"}.get(s, "info")
    out = []
    for res in data.get("Results", []) or []:
        target = _rel(res.get("Target", ""), src)
        for v in res.get("Vulnerabilities", []) or []:
            out.append(Finding(
                engine="trivy", category="dependency", rule_id=v["VulnerabilityID"],
                title=f"{v['VulnerabilityID']} in {v['PkgName']}@{v.get('InstalledVersion', '?')}",
                description=v.get("Title") or v.get("Description", "")[:500], severity=sev(v.get("Severity")),
                confidence="high", cwe=(v.get("CweIDs") or [None])[0], file_path=target,
                evidence=f"{v['PkgName']} {v.get('InstalledVersion', '')}",
                remediation=f"Upgrade {v['PkgName']} to {v['FixedVersion']} or later." if v.get("FixedVersion") else "No fixed version published yet; consider an alternative package or compensating controls.",
                references=([v["PrimaryURL"]] if v.get("PrimaryURL") else []),
            ))
        for m in res.get("Misconfigurations", []) or []:
            if m.get("Status") != "FAIL":
                continue
            out.append(Finding(
                engine="trivy", category="iac", rule_id=m.get("ID", ""), title=m.get("Title", m.get("ID", "")),
                description=m.get("Description", ""), severity=sev(m.get("Severity")), confidence="high",
                file_path=target, line=(m.get("CauseMetadata") or {}).get("StartLine") or None,
                evidence=m.get("Message", ""), remediation=m.get("Resolution", ""),
                references=([m["PrimaryURL"]] if m.get("PrimaryURL") else []),
            ))
    return out


ENGINES = {"semgrep": semgrep, "gitleaks": gitleaks, "trivy": trivy}
