import hashlib
import logging

from celery import shared_task
from django.core.files.base import ContentFile
from django.utils import timezone

from apps.scans.models import Scan, ScanStatus

from .generators import RENDERERS
from .models import Report, ReportFormat, ReportStatus

logger = logging.getLogger(__name__)


def generate_report(scan: Scan, report_format: str) -> Report:
    report, _ = Report.objects.get_or_create(scan=scan, report_format=report_format)
    report.status = ReportStatus.GENERATING
    report.error_message = ""
    report.save(update_fields=["status", "error_message", "updated_at"])
    try:
        content = RENDERERS[report_format](scan)
        if report.file:
            report.file.delete(save=False)
        report.file.save(f"report.{report_format}", ContentFile(content), save=False)
        report.file_size_bytes = len(content)
        report.sha256_checksum = hashlib.sha256(content).hexdigest()
        report.generated_at = timezone.now()
        report.status = ReportStatus.READY
    except Exception as exc:  # one format failing (e.g. PDF libs) must not block the others
        logger.exception("report %s for scan %s failed", report_format, scan.id)
        report.status = ReportStatus.FAILED
        report.error_message = f"{type(exc).__name__}: {exc}"[:2000]
    report.save()
    return report


@shared_task(acks_late=True)
def generate_scan_reports(scan_id: str, report_formats: list[str] | None = None):
    scan = Scan.objects.select_related("project").get(pk=scan_id)
    for report_format in report_formats or ReportFormat.values:
        generate_report(scan, report_format)
    if scan.status == ScanStatus.REPORTING:
        scan.status = ScanStatus.COMPLETED
        scan.progress_percent = 100
        scan.completed_at = timezone.now()
        scan.save(update_fields=["status", "progress_percent", "completed_at", "updated_at"])
        # Project summaries only count COMPLETED/REPORTING scans, so refresh now that this one is complete.
        from apps.scans.ingestion import refresh_project_summary
        refresh_project_summary(scan.project)
