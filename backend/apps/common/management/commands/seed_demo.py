"""
Populate the platform with realistic demo data so the dashboard has something to show without a running scanner.

    python manage.py seed_demo                  # creates admin/analyst/viewer@vapt.local + 3 projects with scan history
    python manage.py seed_demo --reset          # removes everything this command created, then recreates it

Findings go through the real ingestion pipeline (dedupe, classification, scoring, triage carry-over).
"""
import secrets
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.audit.models import AuditLog
from apps.audit.services import record
from apps.projects.models import Project, ProjectMembership, ProjectRole
from apps.projects.services import create_project
from apps.reports.models import ReportFormat
from apps.reports.tasks import generate_report
from apps.scans.ingestion import ingest_findings, refresh_project_summary
from apps.scans.models import EngineRun, Scan, ScanSchedule, ScanStatus
from apps.scans.schedules import compute_next_run

DEMO_DOMAIN = "@vapt.local"
HISTORY_DAYS = (27, 20, 12, 4)  # age in days of each historical scan, oldest first


def code(rule, title, severity, cwe, path, line, evidence, fix="", engine="semgrep", category="code", confidence="medium", description=""):
    return dict(engine=engine, category=category, rule_id=rule, title=title, description=description or title, severity=severity,
                confidence=confidence, cwe=cwe, file_path=path, line=line, evidence=evidence, remediation=fix, references=[])


def web(rule, title, severity, cwe, url, method="GET", param=None, evidence="", fix="", engine="zap", confidence="medium"):
    return dict(engine=engine, category="dast", rule_id=rule, title=title, description=title, severity=severity, confidence=confidence, cwe=cwe,
                url=url, method=method, param=param, evidence=evidence, remediation=fix, references=[])


# (first_scan_index, last_scan_index, raw finding): present in scans first..last (0 = oldest, 3 = latest)
SAST_POOL = [
    (0, 3, code("python.django.security.injection.sql.sql-injection-using-raw", "SQL injection via string-formatted query", "high", "CWE-89",
                "app/orders/views.py", 88, "cursor.execute(f\"SELECT * FROM orders WHERE id = {order_id}\")", "Use parameterized queries.")),
    (0, 1, code("python.lang.security.audit.dangerous-subprocess-use", "Command injection in subprocess call", "high", "CWE-78",
                "app/utils/export.py", 41, "subprocess.run(f'convert {name} out.pdf', shell=True)", "Pass an argument list, drop shell=True.")),
    (0, 3, code("generic.secrets.security.detected-aws-access-key-id", "Hardcoded AWS access key", "critical", "CWE-798",
                "config/settings_prod.py", 14, "AWS_ACCESS_KEY_ID = 'AKIA****************'", "Rotate the key and load it from the environment.",
                engine="gitleaks", category="secret", confidence="high")),
    (1, 3, code("javascript.express.security.audit.xss.direct-response-write", "Reflected XSS: user input written to response", "medium", "CWE-79",
                "web/server/routes/search.js", 27, "res.send('<h1>' + req.query.q + '</h1>')", "Escape output or use a templating engine.")),
    (0, 3, code("python.cryptography.security.insecure-hash-algorithms-md5", "Weak hash algorithm (MD5)", "medium", "CWE-328",
                "app/auth/tokens.py", 19, "hashlib.md5(raw).hexdigest()", "Use SHA-256 or a password hasher such as argon2.")),
    (2, 3, code("python.flask.security.audit.debug-enabled", "Flask debug mode enabled", "low", "CWE-489",
                "app/main.py", 6, "app.run(debug=True)", "Disable debug outside local development.")),
    (0, 3, code("CVE-2023-37920", "certifi: removal of e-Tugra root certificate", "high", "CWE-345",
                "requirements.txt", 12, "certifi 2022.12.7 -> fixed in 2023.7.22", "Upgrade certifi to 2023.7.22 or later.",
                engine="trivy", category="dependency", confidence="high")),
    (0, 2, code("CVE-2022-31129", "moment: inefficient regular expression complexity (ReDoS)", "high", "CWE-1333",
                "package-lock.json", 1, "moment 2.29.1 -> fixed in 2.29.4", "Upgrade moment to 2.29.4.",
                engine="trivy", category="dependency", confidence="high")),
    (1, 3, code("CVE-2024-3651", "idna: quadratic complexity in encode()", "medium", "CWE-400",
                "requirements.txt", 18, "idna 3.4 -> fixed in 3.7", "Upgrade idna to 3.7.",
                engine="trivy", category="dependency", confidence="high")),
    (0, 3, code("DS002", "Dockerfile: container runs as root", "medium", "CWE-250",
                "Dockerfile", 1, "no USER instruction", "Add a non-root USER.", engine="trivy", category="iac", confidence="high")),
    (2, 3, code("AVD-AWS-0107", "Security group allows ingress from 0.0.0.0/0 on port 22", "high", "CWE-284",
                "infra/network.tf", 33, "cidr_blocks = [\"0.0.0.0/0\"]", "Restrict SSH to a bastion or VPN range.",
                engine="trivy", category="iac", confidence="high")),
    (0, 3, code("python.lang.security.audit.insecure-deserialization.pickle", "Insecure deserialization with pickle", "high", "CWE-502",
                "app/cache/store.py", 52, "pickle.loads(blob)", "Use JSON or a signed, schema-checked format.")),
    (3, 3, code("python.lang.security.audit.path-traversal.open-never-closed", "Path traversal in file download", "medium", "CWE-22",
                "app/files/views.py", 63, "open(os.path.join(BASE, request.GET['f']))", "Resolve and validate the path stays under BASE.")),
]

DAST_POOL = [
    (0, 3, web("missing-hsts", "Missing Strict-Transport-Security header", "low", "CWE-319", "https://shop.example.com/", fix="Send HSTS with a long max-age.", engine="builtin", confidence="high")),
    (0, 3, web("missing-csp", "Content-Security-Policy header not set", "medium", "CWE-693", "https://shop.example.com/", fix="Define a restrictive CSP.", engine="builtin", confidence="high")),
    (0, 2, web("cookie-no-httponly", "Session cookie without HttpOnly flag", "medium", "CWE-1004", "https://shop.example.com/login", fix="Set HttpOnly on session cookies.", engine="builtin", confidence="high")),
    (1, 3, web("cors-reflection", "CORS reflects arbitrary Origin with credentials", "high", "CWE-942", "https://shop.example.com/api/v1/account", fix="Allow-list trusted origins.", engine="nuclei", confidence="high")),
    (0, 3, web("sqli-error-based", "SQL injection (error based)", "critical", "CWE-89", "https://shop.example.com/api/v1/products", param="category",
               evidence="You have an error in your SQL syntax near '\\''", fix="Use parameterized queries.", engine="zap", confidence="high")),
    (0, 3, web("reflected-xss", "Reflected cross-site scripting", "high", "CWE-79", "https://shop.example.com/search", param="q",
               evidence="<script>alert(1)</script> reflected unescaped", fix="Encode output contextually.", engine="zap")),
    (1, 3, web("exposed-git", "Exposed .git directory", "high", "CWE-538", "https://shop.example.com/.git/config", fix="Block dotfiles at the web server.", engine="nuclei", confidence="high")),
    (0, 1, web("stack-trace", "Verbose error page discloses stack trace", "low", "CWE-209", "https://shop.example.com/api/v1/orders/abc", fix="Return generic errors in production.", engine="builtin", confidence="high")),
    (2, 3, web("tls-weak-protocol", "TLS 1.0 still enabled", "medium", "CWE-326", "https://shop.example.com/", fix="Disable TLS 1.0/1.1.", engine="builtin", confidence="high")),
    (0, 3, web("server-banner", "Server version banner disclosed", "info", "CWE-200", "https://shop.example.com/", fix="Hide server version headers.", engine="builtin", confidence="high")),
]

PROJECTS = [
    dict(name="Acme Storefront API", description="Customer-facing e-commerce API and web storefront.", repository_url="https://github.com/acme/storefront",
         repository_branch="main", target_url="https://shop.example.com", allow_sast=True, allow_dast=True, types=("sast", "dast")),
    dict(name="Payments Gateway", description="Card processing microservice (PCI scope).", repository_url="https://github.com/acme/payments-gateway",
         repository_branch="main", target_url="", allow_sast=True, allow_dast=False, types=("sast",)),
    dict(name="Customer Portal", description="Self-service portal for enterprise customers.", repository_url="",
         repository_branch="", target_url="https://portal.example.com", allow_sast=False, allow_dast=True, types=("dast",)),
]


class Command(BaseCommand):
    help = "Create demo users, projects and scan history (for local UI development)."

    def add_arguments(self, parser):
        parser.add_argument("--password", help="Password for the demo accounts (default: random, printed once)")
        parser.add_argument("--reset", action="store_true", help="Delete previously seeded demo data first")

    def handle(self, *args, **options):
        if options["reset"]:
            self._reset()
        elif User.objects.filter(email__endswith=DEMO_DOMAIN).exists():
            raise CommandError("Demo data already exists. Use --reset to recreate it.")
        password = options["password"] or secrets.token_urlsafe(12) + "aA1!"
        with transaction.atomic():
            admin = User.objects.create_superuser("admin" + DEMO_DOMAIN, password, full_name="Ada Admin")
            analyst = User.objects.create_user("analyst" + DEMO_DOMAIN, password, full_name="Alex Analyst")
            viewer = User.objects.create_user("viewer" + DEMO_DOMAIN, password, full_name="Vic Viewer")
            for spec in PROJECTS:
                self._seed_project(spec, admin, analyst, viewer)
        self.stdout.write(self.style.SUCCESS("Demo data created."))
        self.stdout.write(f"  admin{DEMO_DOMAIN} / analyst{DEMO_DOMAIN} / viewer{DEMO_DOMAIN}")
        self.stdout.write(f"  password: {password}" if not options["password"] else "  password: (the one you passed)")

    def _reset(self):
        demo_users = User.objects.filter(email__endswith=DEMO_DOMAIN)
        Project.objects.filter(created_by__in=demo_users).delete()
        AuditLog.objects.filter(actor_email__endswith=DEMO_DOMAIN).delete()
        demo_users.delete()

    def _seed_project(self, spec, admin, analyst, viewer):
        now = timezone.now()
        fields = {k: v for k, v in spec.items() if k != "types"}
        project = create_project(created_by=admin, **fields)
        ProjectMembership.objects.create(project=project, user=analyst, role=ProjectRole.ANALYST, invited_by=admin)
        ProjectMembership.objects.create(project=project, user=viewer, role=ProjectRole.VIEWER, invited_by=admin)
        verified = {}
        if spec["repository_url"]:
            verified.update(repository_verified_at=now, repository_access_level="read", repository_head_commit=secrets.token_hex(20))
        if spec["target_url"]:
            verified.update(target_verified_at=now)
        Project.objects.filter(pk=project.pk).update(**verified)
        project.refresh_from_db()
        record(actor=admin, action="project.create", target=project, target_label=project.name)

        for scan_type in spec["types"]:
            pool = SAST_POOL if scan_type == "sast" else DAST_POOL
            engines = ("semgrep", "gitleaks", "trivy") if scan_type == "sast" else ("builtin", "nuclei", "zap")
            for index, age_days in enumerate(HISTORY_DAYS):
                created = now - timedelta(days=age_days, hours=3)
                raw = [item for first, last, item in pool if first <= index <= last]
                self._seed_scan(project, scan_type, engines, created, raw, analyst if index % 2 else admin)
            self._seed_failed_scan(project, scan_type, engines, now - timedelta(days=1, hours=5), admin)
            self._triage_some(project, scan_type, analyst)
            ScanSchedule.objects.create(project=project, scan_type=scan_type, frequency="weekly", weekday=0, hour_utc=2, created_by=admin,
                                        next_run_at=compute_next_run("weekly", 2, 0, now))
        refresh_project_summary(project)

    def _seed_scan(self, project, scan_type, engines, created, raw, user):
        target = project.repository_url if scan_type == "sast" else project.target_url
        scan = Scan.objects.create(
            project=project, scan_type=scan_type, status=ScanStatus.REPORTING, progress_percent=90, triggered_by=user, target=target,
            branch=project.repository_branch if scan_type == "sast" else "", commit_sha=secrets.token_hex(20) if scan_type == "sast" else "",
            engines=list(engines), configuration={"profile": "standard"} if scan_type == "sast" else {"profile": "standard", "active": False, "authenticated": False},
        )
        duration = 90 + len(raw) * 7
        Scan.objects.filter(pk=scan.pk).update(created_at=created, started_at=created, completed_at=created + timedelta(seconds=duration))
        scan.refresh_from_db()
        for engine in engines:
            found = [f for f in raw if f["engine"] == engine]
            EngineRun.objects.create(scan=scan, engine=engine, engine_version=f"{engine}:demo", status="succeeded",
                                     raw_findings_count=len(found), duration_ms=duration * 1000 // len(engines))
        ingest_findings(scan, raw)
        Scan.objects.filter(pk=scan.pk).update(status=ScanStatus.COMPLETED, progress_percent=100)
        scan.refresh_from_db()
        for report_format in (ReportFormat.JSON, ReportFormat.HTML, ReportFormat.SARIF, ReportFormat.CSV):
            generate_report(scan, report_format)
        return scan

    def _seed_failed_scan(self, project, scan_type, engines, created, user):
        scan = Scan.objects.create(
            project=project, scan_type=scan_type, status=ScanStatus.FAILED, triggered_by=user,
            target=project.repository_url if scan_type == "sast" else project.target_url, engines=list(engines), configuration={"profile": "standard"},
            error_message="all engines failed: scanner service unreachable (demo data)",
        )
        Scan.objects.filter(pk=scan.pk).update(created_at=created, started_at=created, completed_at=created + timedelta(seconds=12))

    def _triage_some(self, project, scan_type, user):
        latest = Scan.objects.filter(project=project, scan_type=scan_type, status=ScanStatus.COMPLETED).order_by("-created_at").first()
        if not latest:
            return
        for finding, status, note in zip(latest.findings.filter(severity__in=("low", "info", "medium")).order_by("risk_score")[:2],
                                         ("false_positive", "accepted_risk"), ("Test fixture, not reachable in production.", "Mitigated at the WAF; fix scheduled for Q3.")):
            finding.triage_status, finding.triage_note, finding.triaged_by, finding.triaged_at = status, note, user, timezone.now()
            finding.save(update_fields=["triage_status", "triage_note", "triaged_by", "triaged_at"])
        from apps.scans.ingestion import refresh_scan_summary
        refresh_scan_summary(latest)
