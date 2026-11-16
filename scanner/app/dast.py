"""DAST engines: built-in HTTP checks, Nuclei, OWASP ZAP. All normalized to Finding."""
import ipaddress
import json
import os
import re
import shutil
import socket
import ssl
import time
import uuid
from datetime import datetime, timezone
from html import unescape
from urllib.parse import urljoin, urlparse

import httpx

from .runner import WORK_DIR, WORK_VOLUME, EngineError, docker, tail
from .schemas import DastRequest, Finding

IMAGES = {"nuclei": "projectdiscovery/nuclei:v3.4.2", "zap": "ghcr.io/zaproxy/zaproxy:2.16.0"}
DOCKER_HOST_ALIAS = "host.docker.internal"


def guard_target(url: str) -> None:
    """Block cloud metadata / link-local targets (SSRF). Ownership is verified upstream by the API."""
    host = urlparse(url).hostname or ""
    if host in ("metadata.google.internal", "metadata"):
        raise EngineError("target not allowed")
    try:
        for info in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_link_local or ip.is_multicast or ip.is_unspecified:
                raise EngineError(f"target resolves to blocked address {ip}")
    except socket.gaierror as e:
        raise EngineError(f"cannot resolve {host}") from e


def reachable(url: str) -> str:
    """Containers can't reach the host's localhost: route through the docker host alias."""
    return re.sub(r"^(https?://)(localhost|127\.0\.0\.1)(?=[:/]|$)", rf"\1{DOCKER_HOST_ALIAS}", url, flags=re.I)


def _f(sev, title, url, rule, **kw) -> Finding:
    return Finding(engine="builtin", category="dast", rule_id=rule, title=title, severity=sev, confidence="high", url=url, method="GET", **kw)


# ------------------------------------------------------------------ built-in checks

EXPOSED = [
    ("/.git/HEAD", r"^ref: ", "high"), ("/.git/config", r"\[core\]", "high"),
    ("/.env", r"(?m)^[A-Z_][A-Z0-9_]*=", "critical"), ("/server-status", r"Apache Server Status", "medium"),
    ("/phpinfo.php", r"phpinfo\(\)", "medium"), ("/actuator/env", r'"propertySources"', "high"),
    ("/.DS_Store", r"Bud1", "low"), ("/backup.sql", r"(?i)(CREATE TABLE|INSERT INTO)", "critical"),
]
STACK_TRACE = re.compile(r"Traceback \(most recent call last\)|\bat [\w$.]+\(\w+\.java:\d+\)|SQLSTATE\[|ORA-\d{5}|"
                         r"You have an error in your SQL syntax|<b>(Fatal error|Warning)</b>:|System\.\w+Exception")


def builtin(req: DastRequest) -> list[Finding]:
    url = reachable(str(req.target_url))
    out: list[Finding] = []
    headers = {}
    if req.auth_header and ":" in req.auth_header:
        k, v = req.auth_header.split(":", 1)
        headers[k.strip()] = v.strip()
    with httpx.Client(headers=headers, follow_redirects=False, timeout=15, verify=False) as c:
        r = c.get(url)
        h = r.headers
        https = url.startswith("https://")
        csp = h.get("content-security-policy", "")

        if not csp:
            out.append(_f("medium", "Missing Content-Security-Policy header", url, "missing-csp", cwe="CWE-693",
                          remediation="Add a restrictive Content-Security-Policy (start with default-src 'self')."))
        if not h.get("x-frame-options") and "frame-ancestors" not in csp.lower():
            out.append(_f("medium", "Clickjacking protection missing", url, "missing-frame-options", cwe="CWE-1021",
                          remediation="Send X-Frame-Options: DENY or CSP frame-ancestors 'none'."))
        if h.get("x-content-type-options", "").lower() != "nosniff":
            out.append(_f("low", "Missing X-Content-Type-Options: nosniff", url, "missing-nosniff", cwe="CWE-693"))
        if not h.get("referrer-policy"):
            out.append(_f("low", "Missing Referrer-Policy header", url, "missing-referrer-policy", cwe="CWE-200"))
        if https and not h.get("strict-transport-security"):
            out.append(_f("medium", "Missing Strict-Transport-Security (HSTS)", url, "missing-hsts", cwe="CWE-319",
                          remediation="Strict-Transport-Security: max-age=31536000; includeSubDomains"))
        for name in ("server", "x-powered-by", "x-aspnet-version"):
            if re.search(r"\d", h.get(name, "")):
                out.append(_f("low", f"Version disclosure in {name} header", url, f"version-{name}", cwe="CWE-200",
                              evidence=f"{name}: {h[name]}"))

        for cookie in h.get_list("set-cookie"):
            missing = [n for n, ok in (("Secure", not https or re.search(r";\s*secure", cookie, re.I)),
                                       ("HttpOnly", re.search(r";\s*httponly", cookie, re.I)),
                                       ("SameSite", re.search(r";\s*samesite", cookie, re.I))) if not ok]
            if missing:
                name = cookie.split("=", 1)[0]
                out.append(_f("medium", f"Cookie '{name}' missing {', '.join(missing)}", url, "insecure-cookie",
                              cwe="CWE-1004" if "HttpOnly" in missing else "CWE-614", param=name, evidence=cookie.split(";", 1)[-1]))

        evil = "https://evil.example"
        cr = c.get(url, headers={"Origin": evil})
        acao = cr.headers.get("access-control-allow-origin")
        if acao in (evil, "null"):
            creds = cr.headers.get("access-control-allow-credentials") == "true"
            out.append(_f("high" if creds else "medium", f"CORS reflects arbitrary Origin{' with credentials' if creds else ''}",
                          url, "cors-reflection", cwe="CWE-942", evidence=f"Origin: {evil} -> Access-Control-Allow-Origin: {acao}",
                          remediation="Allow-list trusted origins explicitly; never reflect the Origin header with credentials."))
        elif acao == "*":
            out.append(_f("low", "CORS allows any origin (*)", url, "cors-wildcard", cwe="CWE-942"))

        for path, sig, sev in EXPOSED:
            u = urljoin(url, path)
            try:
                er = c.get(u)
            except httpx.HTTPError:
                continue
            if er.status_code == 200 and re.search(sig, er.text[:5000]):
                out.append(_f(sev, f"Sensitive file exposed: {path}", u, "exposed-file", cwe="CWE-538",
                              evidence=er.text[:200], remediation="Block this path at the web server and remove it from the web root."))

        probe = urljoin(url, f"/vapt-{int(time.time())}?id=1'\"%3C")
        try:
            m = STACK_TRACE.search(c.get(probe).text)
        except httpx.HTTPError:
            m = None
        if m:
            out.append(_f("medium", "Verbose error / stack trace disclosed", probe, "error-disclosure", cwe="CWE-209",
                          evidence=m.group(0), remediation="Return generic error pages in production; log details server-side only."))

        if https:
            out += tls_check(url)
            try:
                pr = c.get(url.replace("https://", "http://", 1))
                if not (300 <= pr.status_code < 400 and pr.headers.get("location", "").startswith("https://")):
                    out.append(_f("medium", "HTTP not redirected to HTTPS", url.replace("https://", "http://", 1), "no-https-redirect", cwe="CWE-319"))
            except httpx.HTTPError:
                pass
    return out


def tls_check(url: str) -> list[Finding]:
    u = urlparse(url)
    host, port = u.hostname, u.port or 443
    out = []
    try:
        with socket.create_connection((host, port), timeout=10) as raw, ssl.create_default_context().wrap_socket(raw, server_hostname=host) as s:
            exp = datetime.strptime(s.getpeercert()["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
            days = (exp - datetime.now(timezone.utc)).days
            if days < 30:
                out.append(_f("medium", f"TLS certificate expires in {days} days", url, "cert-expiry", cwe="CWE-298"))
            if s.version() in ("TLSv1", "TLSv1.1"):
                out.append(_f("high", f"Outdated TLS protocol negotiated: {s.version()}", url, "weak-tls", cwe="CWE-326"))
    except ssl.SSLCertVerificationError as e:
        out.append(_f("high", f"Invalid TLS certificate: {e.verify_message}", url, "invalid-cert", cwe="CWE-295"))
    except OSError:
        pass
    return out


# ------------------------------------------------------------------ nuclei

def nuclei(req: DastRequest) -> list[Finding]:
    args = ["-v", "vapt-nuclei:/root", IMAGES["nuclei"], "-u", reachable(str(req.target_url)), "-jsonl", "-silent", "-nc",
            "-s", "low,medium,high,critical", "-rl", "50"]
    if not req.active:
        args += ["-etags", "intrusive,fuzz,dos"]
    if req.auth_header:
        args += ["-H", req.auth_header]
    r = docker(args, timeout=3600)
    if r.returncode != 0 and not r.stdout:
        raise EngineError(tail(r.stderr))
    return parse_nuclei(r.stdout)


def parse_nuclei(jsonl: str) -> list[Finding]:
    out = []
    for line in jsonl.splitlines():
        if not line.startswith("{"):
            continue
        x = json.loads(line)
        info = x.get("info", {})
        cwe = (info.get("classification") or {}).get("cwe-id") or [None]
        out.append(Finding(
            engine="nuclei", category="dast", rule_id=x.get("template-id", ""), title=info.get("name", x.get("template-id", "")),
            description=info.get("description", ""), severity=info.get("severity", "info") if info.get("severity") in ("critical", "high", "medium", "low") else "info",
            confidence="high", cwe=cwe[0].upper() if cwe[0] else None, url=x.get("matched-at") or x.get("host"),
            evidence=", ".join(x.get("extracted-results") or [])[:1000], remediation=info.get("remediation", ""),
            references=(info.get("reference") or [])[:5] if isinstance(info.get("reference"), list) else [],
        ))
    return out


# ------------------------------------------------------------------ OWASP ZAP

def zap(req: DastRequest) -> list[Finding]:
    ws = uuid.uuid4().hex
    root = os.path.join(WORK_DIR, ws)
    os.makedirs(root)
    os.chmod(root, 0o777)  # ZAP runs as uid 1000
    env = []
    if req.auth_header and ":" in req.auth_header:
        k, v = req.auth_header.split(":", 1)
        env = ["-e", f"ZAP_AUTH_HEADER={k.strip()}", "-e", f"ZAP_AUTH_HEADER_VALUE={v.strip()}"]
    if req.openapi_url:
        script = ["zap-api-scan.py", "-t", reachable(str(req.openapi_url)), "-f", "openapi"]
    else:
        script = ["zap-full-scan.py" if req.active else "zap-baseline.py", "-t", reachable(str(req.target_url)), "-m", "3"]
    try:
        r = docker(["-v", f"{WORK_VOLUME}:/zap/wrk:rw", *env, IMAGES["zap"], *script, "-J", f"{ws}/zap.json", "-I"], timeout=5400)
        path = os.path.join(root, "zap.json")
        if not os.path.exists(path):
            raise EngineError(tail(r.stdout, 800) + tail(r.stderr, 800))
        with open(path, encoding="utf-8") as fh:
            return parse_zap(json.load(fh))
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _strip(s: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def parse_zap(data: dict) -> list[Finding]:
    sev = ["info", "low", "medium", "high"]
    conf = {"1": "low", "2": "medium", "3": "high", "4": "high"}
    out = []
    for site in data.get("site", []):
        for a in site.get("alerts", []):
            if a.get("pluginid") == "10116":  # "ZAP is Out of Date": noise about the scanner itself
                continue
            inst = a.get("instances", [])
            first = inst[0] if inst else {}
            ev = "\n".join(f"{i.get('method', '')} {i.get('uri', '')}{' [' + i['param'] + ']' if i.get('param') else ''}"
                           f"{' -> ' + i['evidence'] if i.get('evidence') else ''}" for i in inst[:5])
            if len(inst) > 5:
                ev += f"\n...and {len(inst) - 5} more"
            out.append(Finding(
                engine="zap", category="dast", rule_id=f"zap-{a.get('pluginid')}", title=a.get("name", ""),
                description=_strip(a.get("desc")), severity=sev[int(a.get("riskcode", 0))],
                confidence=conf.get(str(a.get("confidence")), "medium"),
                cwe=f"CWE-{a['cweid']}" if str(a.get("cweid", "")) not in ("", "-1", "0") else None,
                url=first.get("uri") or site.get("@name"), method=first.get("method"), param=first.get("param") or None,
                evidence=ev, remediation=_strip(a.get("solution")),
                references=[u for u in re.findall(r"https?://[^\s<]+", a.get("reference", ""))][:5],
            ))
    return out


ENGINES = {"builtin": builtin, "nuclei": nuclei, "zap": zap}


def unalias(findings: list[Finding], original_url: str) -> list[Finding]:
    """Report findings against the host the user typed, not the docker alias."""
    host = urlparse(original_url).hostname or ""
    for f in findings:
        for attr in ("url", "evidence"):
            v = getattr(f, attr)
            if v:
                setattr(f, attr, v.replace(f"//{DOCKER_HOST_ALIAS}", f"//{host}"))
    return findings
