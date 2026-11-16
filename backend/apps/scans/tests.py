"""
End-to-end API tests with the scanner microservice faked out.
Run: DJANGO_DEBUG=1 python manage.py test
"""
from decimal import Decimal
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project, ProjectMembership
from apps.reports.models import Report

from .models import Finding, Scan
from .scoring import calculate_finding_risk, calculate_priority, calculate_scan_risk

COMMIT = "a" * 40

SEMGREP_RESULT = {"engine": "semgrep", "version": "semgrep:1", "duration_ms": 10, "findings": [
    {"engine": "semgrep", "category": "code", "rule_id": "python.lang.security.audit.formatted-sql-query", "title": "Formatted sql query",
     "description": "SQL built with string concat", "severity": "high", "confidence": "medium", "cwe": "CWE-89",
     "file_path": "app.py", "line": 10, "evidence": "<script>alert(1)</script> db.execute('...' + id)", "remediation": "", "references": []},
    {"engine": "semgrep", "category": "secret", "rule_id": "generic.secrets.detected-aws-access-key", "title": "Aws key",
     "description": "AWS key", "severity": "high", "confidence": "low", "cwe": "CWE-798",
     "file_path": "app.py", "line": 4, "evidence": "<script>alert(1)</script>", "remediation": "", "references": []},
]}
GITLEAKS_RESULT = {"engine": "gitleaks", "version": "gitleaks:8", "duration_ms": 5, "findings": [
    {"engine": "gitleaks", "category": "secret", "rule_id": "aws-access-token", "title": "Hardcoded secret: aws-access-token",
     "description": "AWS", "severity": "high", "confidence": "medium", "cwe": "CWE-798", "file_path": "app.py", "line": 4,
     "evidence": "AKIA****", "remediation": "Rotate it", "references": []},
]}
TRIVY_FAILURE = "trivy: database download failed"


class FakeScannerClient:
    """Stands in for the FastAPI scanner service."""
    calls: list = []

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def close(self):
        pass

    def validate_repository(self, url, branch, token):
        FakeScannerClient.calls.append(("validate", url, branch, token))
        return {"ok": True, "commit_sha": COMMIT, "branch": branch or "main", "default_branch": "main", "access": "write", "message": "ok"}

    def create_workspace(self, url, branch, commit_sha, token):
        FakeScannerClient.calls.append(("workspace", commit_sha))
        return "f" * 32

    def delete_workspace(self, workspace_id):
        FakeScannerClient.calls.append(("delete", workspace_id))

    def run_sast_engine(self, workspace_id, engine):
        from apps.common.scanner_client import ScannerServiceError
        if engine == "trivy":
            raise ScannerServiceError(TRIVY_FAILURE)
        return {"semgrep": SEMGREP_RESULT, "gitleaks": GITLEAKS_RESULT}[engine]

    def run_dast_engine(self, engine, target_url, auth_header, openapi_url, active):
        FakeScannerClient.calls.append(("dast", engine, auth_header, active))
        return {"engine": engine, "version": "x", "duration_ms": 1, "findings": [
            {"engine": engine, "category": "dast", "rule_id": "cors-reflection", "title": "CORS reflects arbitrary Origin",
             "description": "", "severity": "high", "confidence": "high", "cwe": "CWE-942", "url": f"{target_url}?a=1",
             "method": "GET", "param": None, "evidence": "", "remediation": "", "references": []}]}


# CELERY_TASK_ALWAYS_EAGER must be a Django setting: with namespace="CELERY" Celery reads the prefixed key first,
# so assigning celery_app.conf.task_always_eager would be ignored and tests would try to reach Redis.
@override_settings(ALLOW_LOCAL_DAST_TARGETS=True, CELERY_TASK_ALWAYS_EAGER=True)
@mock.patch("apps.scans.tasks.ScannerClient", FakeScannerClient)
@mock.patch("apps.projects.services.ScannerClient", FakeScannerClient)
class PlatformApiTests(TestCase):
    password = "Str0ng-pass-phrase!"

    def setUp(self):
        FakeScannerClient.calls = []
        self.owner = User.objects.create_user("owner@example.com", self.password)
        self.viewer = User.objects.create_user("viewer@example.com", self.password)
        self.analyst = User.objects.create_user("analyst@example.com", self.password)
        self.outsider = User.objects.create_user("outsider@example.com", self.password)

    def client_for(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user)
        return client

    def create_project(self, **overrides) -> dict:
        payload = {"name": "Shop API", "repository_url": "https://github.com/acme/shop", "repository_branch": "main",
                   "repository_token": "ghp_secret", "target_url": "http://localhost:4000", "allow_sast": True,
                   "allow_dast": True, "authorization_confirmed": True, **overrides}
        response = self.client_for(self.owner).post("/api/v1/projects/", payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def add_member(self, project_id, user, role):
        response = self.client_for(self.owner).post(f"/api/v1/projects/{project_id}/members/", {"email": user.email, "role": role}, format="json")
        self.assertEqual(response.status_code, 201, response.data)

    def run_sast(self, project_id, user=None):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client_for(user or self.owner).post(f"/api/v1/projects/{project_id}/scans/", {"scan_type": "sast"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return Scan.objects.get(pk=response.data["id"])

    # ------------------------------------------------------------------ auth & projects

    def test_register_and_obtain_jwt(self):
        anonymous = APIClient()
        self.assertEqual(anonymous.post("/api/v1/auth/register/", {"email": "new@example.com", "password": "short"}).status_code, 400)
        self.assertEqual(anonymous.post("/api/v1/auth/register/", {"email": "new@example.com", "password": self.password}).status_code, 201)
        token = anonymous.post("/api/v1/auth/token/", {"email": "new@example.com", "password": self.password}).data["access"]
        anonymous.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(anonymous.get("/api/v1/auth/me/").data["email"], "new@example.com")
        self.assertEqual(APIClient().get("/api/v1/projects/").status_code, 401)

    def test_project_creation_requires_authorization_and_hides_token(self):
        response = self.client_for(self.owner).post("/api/v1/projects/", {"name": "x", "repository_url": "https://github.com/a/b"}, format="json")
        self.assertIn("authorization_confirmed", response.data)
        project = self.create_project()
        self.assertEqual(project["my_role"], "owner")
        self.assertTrue(project["has_repository_token"])
        self.assertNotIn("repository_token", project)
        stored = Project.objects.get(pk=project["id"])
        self.assertNotIn("ghp_secret", stored.repository_token_encrypted)
        self.assertEqual(stored.repository_token, "ghp_secret")

    def test_role_based_access(self):
        project = self.create_project()
        pid = project["id"]
        self.add_member(pid, self.viewer, "viewer")
        self.add_member(pid, self.analyst, "analyst")
        # outsiders can't even see the project
        self.assertEqual(self.client_for(self.outsider).get(f"/api/v1/projects/{pid}/").status_code, 404)
        self.assertEqual(self.client_for(self.outsider).get("/api/v1/projects/").data["count"], 0)
        # viewers read but cannot modify, scan, or manage members
        viewer = self.client_for(self.viewer)
        self.assertEqual(viewer.get(f"/api/v1/projects/{pid}/").data["my_role"], "viewer")
        self.assertEqual(viewer.patch(f"/api/v1/projects/{pid}/", {"name": "hacked"}, format="json").status_code, 403)
        self.assertEqual(viewer.post(f"/api/v1/projects/{pid}/scans/", {"scan_type": "sast"}, format="json").status_code, 403)
        self.assertEqual(viewer.post(f"/api/v1/projects/{pid}/members/", {"email": self.outsider.email, "role": "owner"}, format="json").status_code, 403)
        # analysts cannot delete; last owner cannot be removed or demoted
        self.assertEqual(self.client_for(self.analyst).delete(f"/api/v1/projects/{pid}/").status_code, 403)
        owner_membership = ProjectMembership.objects.get(project_id=pid, user=self.owner)
        response = self.client_for(self.owner).patch(f"/api/v1/projects/{pid}/members/{owner_membership.id}/", {"role": "viewer"}, format="json")
        self.assertEqual(response.status_code, 400)

    # ------------------------------------------------------------------ SAST pipeline

    def test_sast_requires_validated_repository(self):
        pid = self.create_project()["id"]
        response = self.client_for(self.owner).post(f"/api/v1/projects/{pid}/scans/", {"scan_type": "sast"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Validate the repository", str(response.data))

    def test_full_sast_pipeline(self):
        pid = self.create_project()["id"]
        self.add_member(pid, self.analyst, "analyst")
        response = self.client_for(self.owner).post(f"/api/v1/projects/{pid}/validate-repository/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["project"]["repository_access_level"], "write")
        self.assertIn(("validate", "https://github.com/acme/shop", "main", "ghp_secret"), FakeScannerClient.calls)

        scan = self.run_sast(pid, user=self.analyst)
        scan.refresh_from_db()
        self.assertEqual(scan.status, "completed", scan.error_message)
        self.assertEqual(scan.commit_sha, COMMIT)
        self.assertIn(("delete", "f" * 32), FakeScannerClient.calls)  # workspace always cleaned up

        runs = {r.engine: r for r in scan.engine_runs.all()}
        self.assertEqual(runs["semgrep"].status, "succeeded")
        self.assertEqual(runs["trivy"].status, "failed")
        self.assertIn(TRIVY_FAILURE, runs["trivy"].error_message)

        # semgrep + gitleaks reported the same secret on app.py:4 -> merged into one finding, corroborated
        self.assertEqual(scan.findings_count, 2)
        secret = Finding.objects.get(scan=scan, source_type="secret")
        self.assertEqual(sorted(secret.detected_by), ["gitleaks", "semgrep"])
        self.assertEqual(secret.confidence, "high")
        self.assertEqual(secret.vulnerability_class.slug, "hardcoded-secret")
        self.assertEqual(secret.vulnerability_class.issue_category, "secrets_exposure")
        self.assertEqual(secret.priority, "P1")
        self.assertIsNotNone(secret.fix_due_date)
        sqli = Finding.objects.get(scan=scan, source_type="code")
        self.assertEqual(sqli.vulnerability_class.slug, "sql-injection")
        self.assertEqual(sqli.vulnerability_class.issue_category, "injection")

        detail = self.client_for(self.owner).get(f"/api/v1/findings/{secret.id}/").data
        self.assertTrue(detail["vulnerability_class"]["remediation_steps"])
        self.assertEqual(detail["source_link"], f"https://github.com/acme/shop/blob/{COMMIT}/app.py#L4")

        summary = self.client_for(self.owner).get(f"/api/v1/scans/{scan.id}/summary/").data
        categories = {row["issue_category"] for row in summary["issue_categories"]}
        self.assertEqual(categories, {"secrets_exposure", "injection"})

        # project summary denormalized
        project = Project.objects.get(pk=pid)
        self.assertEqual(project.open_findings_count, 2)
        self.assertIsNotNone(project.latest_risk_score)

        # reports: JSON + HTML always; PDF depends on system libs (present in the Docker image)
        reports = {r.report_format: r for r in Report.objects.filter(scan=scan)}
        self.assertEqual(set(reports), {"pdf", "html", "json", "sarif", "csv"})
        self.assertEqual(reports["sarif"].status, "ready")
        self.assertEqual(reports["csv"].status, "ready")
        self.assertEqual(reports["json"].status, "ready")
        self.assertEqual(reports["html"].status, "ready")
        html = reports["html"].file.read().decode()
        self.assertNotIn("<script>alert(1)</script>", html)  # evidence is escaped
        self.assertIn("&lt;script&gt;", html)

    def test_triage_is_carried_to_next_scan(self):
        pid = self.create_project()["id"]
        self.client_for(self.owner).post(f"/api/v1/projects/{pid}/validate-repository/")
        first = self.run_sast(pid)
        secret = Finding.objects.get(scan=first, source_type="secret")
        client = self.client_for(self.owner)
        self.assertEqual(client.post(f"/api/v1/findings/{secret.id}/triage/", {"triage_status": "false_positive"}, format="json").status_code, 400)
        response = client.post(f"/api/v1/findings/{secret.id}/triage/", {"triage_status": "false_positive", "triage_note": "test fixture key"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        first.refresh_from_db()
        self.assertEqual(sum(first.severity_counts.values()), 1)  # only the SQLi is still open

        second = self.run_sast(pid)
        carried = Finding.objects.get(scan=second, fingerprint=secret.fingerprint)
        self.assertEqual(carried.triage_status, "false_positive")
        self.assertEqual(carried.triage_note, "test fixture key")
        self.assertFalse(carried.is_new)
        self.assertEqual(carried.first_seen_at, secret.first_seen_at)
        self.assertEqual(second.new_findings_count, 0)

    def test_concurrent_scan_of_same_type_rejected(self):
        pid = self.create_project()["id"]
        self.client_for(self.owner).post(f"/api/v1/projects/{pid}/validate-repository/")
        project = Project.objects.get(pk=pid)
        Scan.objects.create(project=project, scan_type="sast", target=project.repository_url, status="scanning")
        response = self.client_for(self.owner).post(f"/api/v1/projects/{pid}/scans/", {"scan_type": "sast"}, format="json")
        self.assertEqual(response.status_code, 409)

    # ------------------------------------------------------------------ DAST

    def test_dast_requires_verification_and_role_for_active_mode(self):
        pid = self.create_project(allow_active_dast=False)["id"]
        self.add_member(pid, self.analyst, "analyst")
        owner, analyst = self.client_for(self.owner), self.client_for(self.analyst)
        self.assertEqual(owner.post(f"/api/v1/projects/{pid}/scans/", {"scan_type": "dast"}, format="json").status_code, 400)
        instructions = owner.get(f"/api/v1/projects/{pid}/target-verification/").data
        self.assertTrue(instructions["file_url"].endswith("/.well-known/vapt-verification.txt"))
        self.assertEqual(owner.post(f"/api/v1/projects/{pid}/target-verification/").status_code, 200)  # localhost allowed in dev
        self.assertEqual(analyst.post(f"/api/v1/projects/{pid}/scans/", {"scan_type": "dast", "active": True}, format="json").status_code, 403)

        with self.captureOnCommitCallbacks(execute=True):
            response = analyst.post(f"/api/v1/projects/{pid}/scans/",
                                    {"scan_type": "dast", "auth_header": "Authorization: Bearer abc"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        scan = Scan.objects.get(pk=response.data["id"])
        self.assertEqual(scan.status, "completed", scan.error_message)
        self.assertTrue(scan.configuration["authenticated"])
        self.assertNotIn("Bearer abc", str(scan.configuration))  # secret never persisted
        self.assertIn(("dast", "zap", "Authorization: Bearer abc", False), FakeScannerClient.calls)
        # the same CORS issue from 3 engines (query string differs) is one finding
        self.assertEqual(scan.findings_count, 1)
        self.assertEqual(Finding.objects.get(scan=scan).vulnerability_class.slug, "cors-misconfiguration")

    # ------------------------------------------------------------------ reports & dashboard

    def test_report_download_permissions_and_headers(self):
        pid = self.create_project()["id"]
        self.add_member(pid, self.viewer, "viewer")
        self.client_for(self.owner).post(f"/api/v1/projects/{pid}/validate-repository/")
        scan = self.run_sast(pid)
        html_report = Report.objects.get(scan=scan, report_format="html")

        response = self.client_for(self.viewer).get(f"/api/v1/reports/{html_report.id}/download/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertIn("sandbox", response["Content-Security-Policy"])
        inline = self.client_for(self.viewer).get(f"/api/v1/reports/{html_report.id}/download/?inline=1")
        self.assertIn("inline", inline["Content-Disposition"])
        self.assertEqual(self.client_for(self.outsider).get(f"/api/v1/reports/{html_report.id}/download/").status_code, 404)

        scan_detail = self.client_for(self.viewer).get(f"/api/v1/scans/{scan.id}/").data
        json_entry = next(r for r in scan_detail["reports"] if r["report_format"] == "json")
        self.assertTrue(json_entry["download_url"].endswith(f"/api/v1/reports/{json_entry['id']}/download/"))
        self.assertEqual(self.client_for(self.viewer).post("/api/v1/reports/regenerate/", {"scan": str(scan.id)}, format="json").status_code, 403)
        self.assertEqual(self.client_for(self.owner).post("/api/v1/reports/regenerate/", {"scan": str(scan.id)}, format="json").status_code, 202)

    def test_dashboard(self):
        pid = self.create_project()["id"]
        self.client_for(self.owner).post(f"/api/v1/projects/{pid}/validate-repository/")
        self.run_sast(pid)
        data = self.client_for(self.owner).get("/api/v1/dashboard/").data
        self.assertEqual(data["cards"]["projects"], 1)
        self.assertEqual(data["cards"]["open_findings"], 2)
        # only the corroborated secret is P1; the medium-confidence SQLi is P3 by design (see scoring.calculate_priority)
        self.assertEqual(data["cards"]["p1_findings"], 1)
        self.assertEqual(data["riskiest_projects"][0]["name"], "Shop API")
        self.assertEqual(self.client_for(self.outsider).get("/api/v1/dashboard/").data["cards"]["projects"], 0)

    def test_knowledge_base_seeded(self):
        response = self.client_for(self.owner).get("/api/v1/knowledge/sql-injection/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["issue_category"], "injection")


class ScoringTests(TestCase):
    def test_risk_and_priority(self):
        critical = calculate_finding_risk(severity="critical", confidence="high", source_type="secret", engine_count=2)
        self.assertEqual(critical, Decimal("10.0"))
        low = calculate_finding_risk(severity="low", confidence="low", source_type="iac")
        self.assertLess(low, Decimal("2"))
        self.assertEqual(calculate_priority(risk_score=low, severity="low", confidence="low", class_base_priority="P1"), "P4")
        # confident finding escalated to its class's base priority
        medium = calculate_finding_risk(severity="medium", confidence="high", source_type="dast")
        self.assertEqual(calculate_priority(risk_score=medium, severity="medium", confidence="high", class_base_priority="P1"), "P1")
        self.assertEqual(calculate_priority(risk_score=Decimal("9"), severity="info", confidence="high", class_base_priority="P1"), "P4")
        self.assertEqual(calculate_scan_risk([], 0), (Decimal("0.00"), "A"))
        self.assertEqual(calculate_scan_risk([Decimal("9.5")], 3)[1], "F")

