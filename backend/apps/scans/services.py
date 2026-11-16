from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.common.crypto import encrypt_secret
from apps.projects.models import Project, ProjectRole
from apps.projects.permissions import has_project_role

from .ingestion import refresh_scan_summary
from .models import (ACTIVE_SCAN_STATUSES, DAST_ENGINES, PROFILE_ENGINES, SAST_ENGINES, Finding, Scan, ScanProfile, ScanStatus,
                     ScanType)


class ScanConflict(ValidationError):
    status_code = 409


def create_scan(*, project: Project, user, scan_type: str, active: bool = False, openapi_url: str = "",
                auth_header: str = "", engines: list[str] | None = None, profile: str = ScanProfile.STANDARD) -> Scan:
    """Step 3: validate the request against project permissions, create the Scan record, queue the Celery job."""
    if project.is_archived:
        raise ValidationError("Project is archived.")
    if not project.authorization_confirmed_at:
        raise ValidationError("Testing authorization has not been confirmed for this project.")

    if scan_type == ScanType.SAST:
        if not project.allow_sast:
            raise PermissionDenied("SAST scans are not enabled for this project.")
        if not project.is_repository_verified:
            raise ValidationError("Validate the repository before running a SAST scan.")
        allowed_engines, target = SAST_ENGINES, project.repository_url
    elif scan_type == ScanType.DAST:
        if not project.allow_dast:
            raise PermissionDenied("DAST scans are not enabled for this project.")
        if not project.is_target_verified:
            raise ValidationError("Verify ownership of the target URL before running a DAST scan.")
        if active and not project.allow_active_dast:
            raise PermissionDenied("Active (attack) scanning is not enabled for this project.")
        if active and not has_project_role(user, project, ProjectRole.MAINTAINER):
            raise PermissionDenied("Active scans require the maintainer role.")
        allowed_engines, target = DAST_ENGINES, project.target_url
    else:
        raise ValidationError({"scan_type": "must be 'sast' or 'dast'"})

    selected_engines = list(engines or PROFILE_ENGINES[scan_type][profile])
    unknown = set(selected_engines) - set(allowed_engines)
    if unknown:
        raise ValidationError({"engines": f"unknown engines for {scan_type}: {sorted(unknown)}"})

    with transaction.atomic():
        # Lock the project row so two requests can't both start a scan of the same type.
        Project.objects.select_for_update().get(pk=project.pk)
        if Scan.objects.filter(project=project, scan_type=scan_type, status__in=ACTIVE_SCAN_STATUSES).exists():
            raise ScanConflict(f"A {scan_type.upper()} scan is already running for this project.")
        scan = Scan.objects.create(
            project=project, scan_type=scan_type, triggered_by=user, target=target,
            branch=project.repository_branch if scan_type == ScanType.SAST else "",
            engines=selected_engines,
            configuration={"profile": str(profile), **({"active": bool(active), "openapi_url": openapi_url or "", "authenticated": bool(auth_header)}
                                                       if scan_type == ScanType.DAST else {})},
        )

    from .tasks import run_scan  # local import: tasks imports this module's siblings
    # The auth header is a secret: encrypted before it touches the broker, never stored in the database.
    transaction.on_commit(lambda: _enqueue(scan, run_scan, encrypt_secret(auth_header) if auth_header else ""))
    return scan


def _enqueue(scan: Scan, task, encrypted_auth_header: str):
    result = task.apply_async(args=[str(scan.id)], kwargs={"encrypted_auth_header": encrypted_auth_header})
    Scan.objects.filter(pk=scan.pk).update(celery_task_id=result.id or "")


def cancel_scan(scan: Scan) -> Scan:
    if not scan.is_active:
        raise ValidationError("Only queued or running scans can be cancelled.")
    from config.celery import celery_app
    if scan.celery_task_id:
        celery_app.control.revoke(scan.celery_task_id, terminate=True)
    scan.status = ScanStatus.CANCELLED
    scan.completed_at = timezone.now()
    scan.save(update_fields=["status", "completed_at", "updated_at"])
    return scan


def triage_finding(finding: Finding, *, user, triage_status: str, triage_note: str = "") -> Finding:
    finding.triage_status = triage_status
    finding.triage_note = triage_note
    finding.triaged_by = user
    finding.triaged_at = timezone.now()
    finding.save(update_fields=["triage_status", "triage_note", "triaged_by", "triaged_at", "updated_at"])
    refresh_scan_summary(finding.scan)
    return finding
