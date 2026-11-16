from django.db import models

from apps.common.models import BaseModel
from apps.scans.models import Scan


class ReportFormat(models.TextChoices):
    PDF = "pdf", "PDF"
    HTML = "html", "HTML"
    JSON = "json", "JSON"
    SARIF = "sarif", "SARIF"
    CSV = "csv", "CSV"


REPORT_CONTENT_TYPES = {ReportFormat.PDF: "application/pdf", ReportFormat.HTML: "text/html; charset=utf-8",
                        ReportFormat.JSON: "application/json",
                        ReportFormat.SARIF: "application/sarif+json", ReportFormat.CSV: "text/csv; charset=utf-8"}


class ReportStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    GENERATING = "generating", "Generating"
    READY = "ready", "Ready"
    FAILED = "failed", "Failed"


def report_upload_path(report: "Report", filename: str) -> str:
    return f"reports/{report.scan.project_id}/{report.scan_id}/{filename}"


class Report(BaseModel):
    """One file per (scan, format). Stored privately; served only through the permission-checked download endpoint."""
    scan = models.ForeignKey(Scan, on_delete=models.CASCADE, related_name="reports")
    report_format = models.CharField(max_length=5, choices=ReportFormat.choices)
    status = models.CharField(max_length=10, choices=ReportStatus.choices, default=ReportStatus.PENDING)
    file = models.FileField(upload_to=report_upload_path, blank=True)
    file_size_bytes = models.PositiveBigIntegerField(default=0)
    sha256_checksum = models.CharField(max_length=64, blank=True)
    generated_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("report_format",)
        constraints = [models.UniqueConstraint(fields=("scan", "report_format"), name="unique_report_format_per_scan")]

    def __str__(self):
        return f"{self.get_report_format_display()} report for {self.scan_id}"

    @property
    def download_filename(self) -> str:
        return f"{self.scan.project.slug}-{self.scan.scan_type}-{self.scan.created_at:%Y%m%d-%H%M}.{self.report_format}"

