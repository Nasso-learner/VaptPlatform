"""Celery scan pipeline: validate -> prepare -> run engines -> normalize -> score -> report."""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from celery import shared_task
from django.utils import timezone

from apps.common.crypto import decrypt_secret
from apps.common.scanner_client import ScannerClient, ScannerServiceError

from .ingestion import ingest_findings
from .models import EngineRun, EngineRunStatus, Scan, ScanStatus, ScanType

logger = logging.getLogger(__name__)

STAGE_PROGRESS = {
    ScanStatus.VALIDATING: 5, ScanStatus.PREPARING: 10, ScanStatus.SCANNING: 20,
    ScanStatus.NORMALIZING: 75, ScanStatus.SCORING: 85, ScanStatus.REPORTING: 90, ScanStatus.COMPLETED: 100,
}


class ScanCancelled(Exception):
    pass


@shared_task
def start_due_scheduled_scans():
    """Celery beat entry point (see CELERY_BEAT_SCHEDULE): starts every enabled schedule whose time has come."""
    from .schedules import run_due_schedules
    return run_due_schedules()


def _advance(scan: Scan, status: str) -> None:
    """Move to the next stage, aborting if the user cancelled in the meantime."""
    if Scan.objects.filter(pk=scan.pk, status=ScanStatus.CANCELLED).exists():
        raise ScanCancelled()
    scan.status = status
    scan.progress_percent = STAGE_PROGRESS.get(status, scan.progress_percent)
    scan.save(update_fields=["status", "progress_percent", "updated_at"])


@shared_task(bind=True, acks_late=True, max_retries=0)
def run_scan(self, scan_id: str, encrypted_auth_header: str = ""):
    scan = Scan.objects.select_related("project").get(pk=scan_id)
    if scan.status != ScanStatus.QUEUED:
        return  # duplicate delivery or cancelled before start
    project = scan.project
    scan.started_at = timezone.now()
    scan.save(update_fields=["started_at"])
    workspace_id = None
    client = ScannerClient()
    try:
        # Step 2: validate target
        _advance(scan, ScanStatus.VALIDATING)
        if scan.scan_type == ScanType.SAST:
            validation = client.validate_repository(project.repository_url, scan.branch, project.repository_token)
            if not validation.get("ok"):
                raise ScannerServiceError(f"repository validation failed: {validation.get('message')}")
            scan.commit_sha = validation["commit_sha"]
            scan.branch = validation.get("branch") or scan.branch
            scan.save(update_fields=["commit_sha", "branch"])
            # Step 2b: clone exactly that revision
            _advance(scan, ScanStatus.PREPARING)
            workspace_id = client.create_workspace(project.repository_url, scan.branch, scan.commit_sha, project.repository_token)
        elif not project.is_target_verified:
            raise ScannerServiceError("target ownership is no longer verified")

        # Step 4: run engines in parallel (each in its own isolated container on the scanner side)
        _advance(scan, ScanStatus.SCANNING)
        auth_header = decrypt_secret(encrypted_auth_header) if encrypted_auth_header else None
        raw_findings = _run_engines(scan, client, workspace_id, auth_header)

        # Steps 5-6: normalize, dedupe, classify, score
        _advance(scan, ScanStatus.NORMALIZING)
        _advance(scan, ScanStatus.SCORING)
        ingest_findings(scan, raw_findings)

        # Step 7: reports (separate queue so slow PDF rendering never blocks scanning workers)
        _advance(scan, ScanStatus.REPORTING)
        from apps.reports.tasks import generate_scan_reports
        generate_scan_reports.delay(str(scan.id))
    except ScanCancelled:
        logger.info("scan %s cancelled", scan_id)
    except Exception as exc:  # any failure marks the scan failed with a readable reason
        logger.exception("scan %s failed", scan_id)
        scan.status = ScanStatus.FAILED
        scan.error_message = str(exc)[:5000]
        scan.completed_at = timezone.now()
        scan.save(update_fields=["status", "error_message", "completed_at", "updated_at"])
    finally:
        if workspace_id:
            try:
                client.delete_workspace(workspace_id)
            except ScannerServiceError:
                logger.warning("could not delete workspace %s", workspace_id)
        client.close()


def _run_engines(scan: Scan, client: ScannerClient, workspace_id: str | None, auth_header: str | None) -> list[dict]:
    engine_runs = {name: EngineRun.objects.create(scan=scan, engine=name, status=EngineRunStatus.RUNNING) for name in scan.engines}
    configuration = scan.configuration

    def call_engine(engine: str) -> dict:
        # Threads only do HTTP (engines run remotely in parallel); all DB writes stay on the task's own connection.
        if scan.scan_type == ScanType.SAST:
            return client.run_sast_engine(workspace_id, engine)
        return client.run_dast_engine(engine, scan.target, auth_header, configuration.get("openapi_url"), configuration.get("active", False))

    all_findings: list[dict] = []
    with ThreadPoolExecutor(max_workers=len(engine_runs)) as pool:
        futures = {pool.submit(call_engine, engine): engine for engine in engine_runs}
        for completed, future in enumerate(as_completed(futures), start=1):
            engine_run = engine_runs[futures[future]]
            try:
                result = future.result()
                engine_run.status = EngineRunStatus.SUCCEEDED
                engine_run.engine_version = result.get("version", "")
                engine_run.duration_ms = result.get("duration_ms", 0)
                engine_run.raw_findings_count = len(result["findings"])
                all_findings.extend(result["findings"])
            except ScannerServiceError as exc:
                engine_run.status = EngineRunStatus.FAILED
                engine_run.error_message = str(exc)[:5000]
            engine_run.save()
            Scan.objects.filter(pk=scan.pk).update(progress_percent=20 + int(55 * completed / len(engine_runs)))

    if all(run.status == EngineRunStatus.FAILED for run in engine_runs.values()):
        raise ScannerServiceError("all engines failed: " + "; ".join(f"{r.engine}: {r.error_message[:200]}" for r in engine_runs.values()))
    return all_findings
