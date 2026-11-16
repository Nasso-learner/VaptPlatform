"""Tests for user admin, audit log, profiles, scan diff, schedules and SARIF/CSV reports (scanner service faked out)."""
import json
from datetime import UTC, datetime, timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditLog
from apps.projects.models import Project
from apps.reports.generators import _csv_safe
from apps.reports.models import Report

from . import tests as base
from .models import Finding, Scan, ScanSchedule
from .schedules import compute_next_run, run_due_schedules

PASSWORD = "Str0ng-pass-phrase!"


def client_for(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


class AccountsAndAuditTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("admin@example.com", PASSWORD, is_staff=True)
        self.user = User.objects.create_user("user@example.com", PASSWORD)

    def test_anonymous_requests_get_401_not_500(self):
        anonymous = APIClient()
        for path in ("/api/v1/projects/", "/api/v1/scans/", "/api/v1/findings/", "/api/v1/reports/", "/api/v1/schedules/", "/api/v1/users/"):
            self.assertEqual(anonymous.get(path).status_code, 401, path)

    def test_user_admin_is_staff_only(self):
        self.assertEqual(client_for(self.user).get("/api/v1/users/").status_code, 403)
        self.assertEqual(client_for(self.user).post("/api/v1/users/", {"email": "x@example.com", "password": PASSWORD}).status_code, 403)
        listing = client_for(self.admin).get("/api/v1/users/").data
        self.assertEqual(listing["count"], 2)
        self.assertNotIn("password", listing["results"][0])

    def test_admin_creates_edits_and_deactivates_users(self):
        admin = client_for(self.admin)
        created = admin.post("/api/v1/users/", {"email": "New@Example.com", "full_name": "New", "password": PASSWORD}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["email"], "new@example.com")
        self.assertEqual(admin.post("/api/v1/users/", {"email": "weak@example.com", "password": "123"}, format="json").status_code, 400)
        self.assertEqual(admin.post("/api/v1/users/", {"email": "new@example.com", "password": PASSWORD}, format="json").status_code, 400)
        uid = created.data["id"]
        self.assertEqual(admin.patch(f"/api/v1/users/{uid}/", {"is_active": False}, format="json").status_code, 200)
        login = APIClient().post("/api/v1/auth/token/", {"email": "new@example.com", "password": PASSWORD}, format="json")
        self.assertEqual(login.status_code, 401)
        self.assertEqual(admin.delete(f"/api/v1/users/{uid}/").status_code, 405)  # deactivate, never delete

    def test_admin_cannot_lock_themselves_out(self):
        admin = client_for(self.admin)
        self.assertEqual(admin.patch(f"/api/v1/users/{self.admin.id}/", {"is_staff": False}, format="json").status_code, 400)
        self.assertEqual(admin.patch(f"/api/v1/users/{self.admin.id}/", {"is_active": False}, format="json").status_code, 400)
        self.assertEqual(admin.patch(f"/api/v1/users/{self.admin.id}/", {"full_name": "Renamed"}, format="json").status_code, 200)

    def test_change_password(self):
        client = client_for(self.user)
        self.assertEqual(client.post("/api/v1/auth/password/", {"current_password": "wrong", "new_password": "An0ther-long-pass!"}, format="json").status_code, 400)
        self.assertEqual(client.post("/api/v1/auth/password/", {"current_password": PASSWORD, "new_password": "short"}, format="json").status_code, 400)
        self.assertEqual(client.post("/api/v1/auth/password/", {"current_password": PASSWORD, "new_password": "An0ther-long-pass!"}, format="json").status_code, 200)
        self.assertEqual(APIClient().post("/api/v1/auth/token/", {"email": "user@example.com", "password": "An0ther-long-pass!"}, format="json").status_code, 200)

    def test_logout_blacklists_refresh_token(self):
        tokens = APIClient().post("/api/v1/auth/token/", {"email": "user@example.com", "password": PASSWORD}, format="json").data
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual(client.post("/api/v1/auth/logout/", {"refresh": tokens["refresh"]}, format="json").status_code, 204)
        self.assertEqual(APIClient().post("/api/v1/auth/token/refresh/", {"refresh": tokens["refresh"]}, format="json").status_code, 401)

    def test_registration_can_be_closed(self):
        self.assertTrue(APIClient().get("/api/v1/auth/config/").data["registration_open"])
        with override_settings(ALLOW_PUBLIC_REGISTRATION=False):
            self.assertFalse(APIClient().get("/api/v1/auth/config/").data["registration_open"])
            response = APIClient().post("/api/v1/auth/register/", {"email": "n@example.com", "password": PASSWORD}, format="json")
            self.assertEqual(response.status_code, 403)

    def test_audit_log_records_actions_and_scopes_visibility(self):
        APIClient().post("/api/v1/auth/token/", {"email": "user@example.com", "password": PASSWORD}, format="json")
        owner = client_for(self.user)
        project = owner.post("/api/v1/projects/", {"name": "P", "repository_url": "https://github.com/a/b", "repository_token": "ghp_topsecret",
                                                   "allow_sast": True, "authorization_confirmed": True}, format="json")
        self.assertEqual(project.status_code, 201, project.data)
        self.assertEqual(project.data["my_role"], "owner")
        owner.patch(f"/api/v1/projects/{project.data['id']}/", {"repository_token": "ghp_rotated", "description": "d"}, format="json")

        actions = set(AuditLog.objects.values_list("action", flat=True))
        self.assertTrue({"auth.login", "project.create", "project.update"} <= actions)
        self.assertNotIn("ghp_", json.dumps(list(AuditLog.objects.values_list("metadata", flat=True))))  # no secrets in the log

        self.assertGreaterEqual(client_for(self.admin).get("/api/v1/audit-logs/").data["count"], 3)
        mine = owner.get("/api/v1/audit-logs/").data
        self.assertTrue(all(str(row["project"]) == project.data["id"] for row in mine["results"]))
        stranger = User.objects.create_user("stranger@example.com", PASSWORD)
        self.assertEqual(client_for(stranger).get("/api/v1/audit-logs/").data["count"], 0)


@override_settings(ALLOW_LOCAL_DAST_TARGETS=True, CELERY_TASK_ALWAYS_EAGER=True)
@mock.patch("apps.scans.tasks.ScannerClient", base.FakeScannerClient)
@mock.patch("apps.projects.services.ScannerClient", base.FakeScannerClient)
class ScanFeatureTests(TestCase):
    def setUp(self):
        base.FakeScannerClient.calls = []
        self.owner = User.objects.create_user("owner@example.com", PASSWORD)
        self.analyst = User.objects.create_user("analyst@example.com", PASSWORD)
        self.viewer = User.objects.create_user("viewer@example.com", PASSWORD)
        owner = client_for(self.owner)
        self.pid = owner.post("/api/v1/projects/", {
            "name": "Shop", "repository_url": "https://github.com/acme/shop", "repository_branch": "main", "repository_token": "ghp_x",
            "target_url": "http://localhost:4000", "allow_sast": True, "allow_dast": True, "authorization_confirmed": True}, format="json").data["id"]
        for user, role in ((self.analyst, "analyst"), (self.viewer, "viewer")):
            owner.post(f"/api/v1/projects/{self.pid}/members/", {"email": user.email, "role": role}, format="json")
        Project.objects.filter(pk=self.pid).update(repository_verified_at=timezone.now(), repository_access_level="write")

    def run_scan(self, **payload) -> Scan:
        with self.captureOnCommitCallbacks(execute=True):
            response = client_for(self.owner).post(f"/api/v1/projects/{self.pid}/scans/", {"scan_type": "sast", **payload}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        scan = Scan.objects.get(pk=response.data["id"])
        scan.refresh_from_db()
        return scan

    def test_quick_profile_runs_fewer_engines(self):
        quick = self.run_scan(profile="quick")
        self.assertEqual(quick.engines, ["semgrep", "gitleaks"])
        self.assertEqual(quick.configuration["profile"], "quick")
        self.assertEqual(self.run_scan().engines, ["semgrep", "gitleaks", "trivy"])
        bad = client_for(self.owner).post(f"/api/v1/projects/{self.pid}/scans/", {"scan_type": "sast", "profile": "nope"}, format="json")
        self.assertEqual(bad.status_code, 400)

    def test_scan_diff(self):
        first = self.run_scan()
        owner = client_for(self.owner)
        self.assertIsNone(owner.get(f"/api/v1/scans/{first.id}/diff/").data["previous_scan"])
        # Pretend one issue from the first scan was since fixed and a different one is new.
        stale = first.findings.filter(source_type="code").first()
        Finding.objects.filter(pk=stale.pk).update(fingerprint="f" * 64)
        second = self.run_scan()
        diff = owner.get(f"/api/v1/scans/{second.id}/diff/").data
        self.assertEqual(diff["previous_scan"], str(first.id))
        self.assertEqual((diff["new_count"], diff["fixed_count"], diff["unchanged_count"]), (1, 1, 1))
        self.assertEqual(diff["new"][0]["issue_name"], stale.issue_name)
        self.assertEqual(client_for(self.viewer).get(f"/api/v1/scans/{second.id}/diff/").status_code, 200)

    def test_schedule_permissions_and_validation(self):
        payload = {"project": self.pid, "scan_type": "sast", "frequency": "weekly", "weekday": 2, "hour_utc": 3}
        self.assertEqual(client_for(self.viewer).post("/api/v1/schedules/", payload, format="json").status_code, 403)
        self.assertEqual(client_for(self.analyst).post("/api/v1/schedules/", {**payload, "weekday": None}, format="json").status_code, 400)
        self.assertEqual(client_for(self.analyst).post("/api/v1/schedules/", {**payload, "hour_utc": 24}, format="json").status_code, 400)
        outsider = User.objects.create_user("outsider@example.com", PASSWORD)
        self.assertEqual(client_for(outsider).post("/api/v1/schedules/", payload, format="json").status_code, 400)  # project not visible
        created = client_for(self.analyst).post("/api/v1/schedules/", payload, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertGreater(datetime.fromisoformat(created.data["next_run_at"].replace("Z", "+00:00")), timezone.now())
        sid = created.data["id"]
        self.assertEqual(client_for(self.viewer).get("/api/v1/schedules/").data["count"], 1)
        self.assertEqual(client_for(outsider).get("/api/v1/schedules/").data["count"], 0)
        self.assertEqual(client_for(self.viewer).patch(f"/api/v1/schedules/{sid}/", {"is_enabled": False}, format="json").status_code, 403)
        self.assertEqual(client_for(self.analyst).patch(f"/api/v1/schedules/{sid}/", {"is_enabled": False}, format="json").status_code, 200)
        self.assertEqual(client_for(self.analyst).delete(f"/api/v1/schedules/{sid}/").status_code, 204)

    def test_due_schedules_start_scans_once(self):
        schedule = ScanSchedule.objects.create(
            project_id=self.pid, scan_type="sast", profile="quick", frequency="daily", hour_utc=2, created_by=self.analyst,
            next_run_at=timezone.now() - timedelta(minutes=1))
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(run_due_schedules(), 1)
        schedule.refresh_from_db()
        self.assertEqual(schedule.last_result, "started")
        self.assertGreater(schedule.next_run_at, timezone.now())
        self.assertEqual(schedule.last_scan.engines, ["semgrep", "gitleaks"])
        self.assertEqual(Scan.objects.filter(project_id=self.pid).count(), 1)
        self.assertEqual(run_due_schedules(), 0)  # not due again

    def test_schedule_is_skipped_when_owner_lost_access(self):
        schedule = ScanSchedule.objects.create(
            project_id=self.pid, scan_type="sast", frequency="daily", hour_utc=2, created_by=self.viewer,
            next_run_at=timezone.now() - timedelta(minutes=1))
        run_due_schedules()
        schedule.refresh_from_db()
        self.assertTrue(schedule.last_result.startswith("skipped"), schedule.last_result)
        self.assertFalse(Scan.objects.exists())

    def test_next_run_computation(self):
        monday_noon = datetime(2026, 11, 16, 12, 0, tzinfo=UTC)  # a Monday
        self.assertEqual(compute_next_run("daily", 2, None, monday_noon), datetime(2026, 11, 17, 2, 0, tzinfo=UTC))
        self.assertEqual(compute_next_run("daily", 14, None, monday_noon), datetime(2026, 11, 16, 14, 0, tzinfo=UTC))
        self.assertEqual(compute_next_run("weekly", 2, 0, monday_noon), datetime(2026, 11, 23, 2, 0, tzinfo=UTC))
        self.assertEqual(compute_next_run("weekly", 2, 2, monday_noon), datetime(2026, 11, 18, 2, 0, tzinfo=UTC))

    def test_sarif_and_csv_reports(self):
        scan = self.run_scan()
        secret = Finding.objects.get(scan=scan, source_type="secret")
        client_for(self.owner).post(f"/api/v1/findings/{secret.id}/triage/", {"triage_status": "false_positive", "triage_note": "fixture"}, format="json")
        with self.captureOnCommitCallbacks(execute=True):
            client_for(self.owner).post("/api/v1/reports/regenerate/", {"scan": str(scan.id), "report_formats": ["sarif", "csv"]}, format="json")
        sarif = json.loads(Report.objects.get(scan=scan, report_format="sarif").file.read())
        self.assertEqual(sarif["version"], "2.1.0")
        results = sarif["runs"][0]["results"]
        self.assertEqual(len(results), 2)
        suppressed = [r for r in results if r.get("suppressions")]
        self.assertEqual(len(suppressed), 1)
        self.assertEqual(suppressed[0]["suppressions"][0]["justification"], "fixture")
        self.assertEqual(results[0]["locations"][0]["physicalLocation"]["artifactLocation"]["uri"], "app.py")
        csv_report = Report.objects.get(scan=scan, report_format="csv")
        self.assertEqual(csv_report.status, "ready")
        download = client_for(self.viewer).get(f"/api/v1/reports/{csv_report.id}/download/")
        self.assertEqual(download.status_code, 200)
        self.assertIn("text/csv", download["Content-Type"])

    def test_csv_cells_cannot_be_formulas(self):
        self.assertEqual(_csv_safe("=HYPERLINK(\"http://evil\")"), "'=HYPERLINK(\"http://evil\")")
        self.assertEqual(_csv_safe("+1"), "'+1")
        self.assertEqual(_csv_safe("@SUM(A1)"), "'@SUM(A1)")
        self.assertEqual(_csv_safe("plain"), "plain")
        self.assertEqual(_csv_safe(None), "")

