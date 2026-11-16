from django.conf import settings
from django.db import models

from apps.common.models import BaseModel
from apps.knowledge.models import RemediationPriority, VulnerabilityClass
from apps.projects.models import Project


class ScanType(models.TextChoices):
    SAST = "sast", "Static (source code)"
    DAST = "dast", "Dynamic (running application)"


class ScanStatus(models.TextChoices):
    QUEUED = "queued", "Queued"
    VALIDATING = "validating", "Validating target"
    PREPARING = "preparing", "Preparing workspace"
    SCANNING = "scanning", "Running engines"
    NORMALIZING = "normalizing", "Normalizing results"
    SCORING = "scoring", "Scoring & deduplicating"
    REPORTING = "reporting", "Generating reports"
    COMPLETED = "completed", "Completed"
    FAILED = "failed", "Failed"
    CANCELLED = "cancelled", "Cancelled"


ACTIVE_SCAN_STATUSES = (ScanStatus.QUEUED, ScanStatus.VALIDATING, ScanStatus.PREPARING, ScanStatus.SCANNING,
                        ScanStatus.NORMALIZING, ScanStatus.SCORING, ScanStatus.REPORTING)

SAST_ENGINES = ("semgrep", "gitleaks", "trivy")
DAST_ENGINES = ("builtin", "nuclei", "zap")


class ScanProfile(models.TextChoices):
    QUICK = "quick", "Quick (fast engines only)"
    STANDARD = "standard", "Standard (all engines)"


# Which engines each profile runs. "Quick" skips the slow engines (dependency DB / full ZAP spider).
PROFILE_ENGINES = {
    "sast": {ScanProfile.QUICK: ("semgrep", "gitleaks"), ScanProfile.STANDARD: SAST_ENGINES},
    "dast": {ScanProfile.QUICK: ("builtin",), ScanProfile.STANDARD: DAST_ENGINES},
}


class Severity(models.TextChoices):
    CRITICAL = "critical", "Critical"
    HIGH = "high", "High"
    MEDIUM = "medium", "Medium"
    LOW = "low", "Low"
    INFO = "info", "Informational"


SEVERITY_ORDER = [s.value for s in Severity]


class Confidence(models.TextChoices):
    HIGH = "high", "High"
    MEDIUM = "medium", "Medium"
    LOW = "low", "Low"


class SourceType(models.TextChoices):
    CODE = "code", "Source code"
    SECRET = "secret", "Secret"
    DEPENDENCY = "dependency", "Dependency"
    IAC = "iac", "Infrastructure as code"
    DAST = "dast", "Runtime (DAST)"


class TriageStatus(models.TextChoices):
    OPEN = "open", "Open"
    CONFIRMED = "confirmed", "Confirmed"
    FALSE_POSITIVE = "false_positive", "False positive"
    ACCEPTED_RISK = "accepted_risk", "Accepted risk"
    FIXED = "fixed", "Fixed"


# Triage decisions that carry over to the same issue in later scans.
STICKY_TRIAGE_STATUSES = (TriageStatus.FALSE_POSITIVE, TriageStatus.ACCEPTED_RISK)


class Scan(BaseModel):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="scans")
    scan_type = models.CharField(max_length=4, choices=ScanType.choices)
    status = models.CharField(max_length=12, choices=ScanStatus.choices, default=ScanStatus.QUEUED, db_index=True)
    progress_percent = models.PositiveSmallIntegerField(default=0)
    triggered_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="triggered_scans")

    # What was scanned (snapshot: project settings may change later)
    target = models.CharField(max_length=500, help_text="Repository URL (SAST) or target URL (DAST)")
    branch = models.CharField(max_length=200, blank=True)
    commit_sha = models.CharField(max_length=40, blank=True)
    engines = models.JSONField(default=list)
    configuration = models.JSONField(default=dict, help_text="Non-secret options: active, openapi_url, authenticated")

    # Results summary (denormalized for fast lists/dashboards)
    risk_score = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    risk_grade = models.CharField(max_length=1, blank=True)
    severity_counts = models.JSONField(default=dict)
    priority_counts = models.JSONField(default=dict)
    findings_count = models.PositiveIntegerField(default=0)
    new_findings_count = models.PositiveIntegerField(default=0)

    error_message = models.TextField(blank=True)
    celery_task_id = models.CharField(max_length=64, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta(BaseModel.Meta):
        indexes = [
            models.Index(fields=("project", "scan_type", "-created_at")),
            models.Index(fields=("status", "-created_at")),
        ]

    def __str__(self):
        return f"{self.get_scan_type_display()} scan of {self.project} ({self.status})"

    @property
    def is_active(self) -> bool:
        return self.status in ACTIVE_SCAN_STATUSES

    @property
    def duration_seconds(self) -> int | None:
        if self.started_at and self.completed_at:
            return int((self.completed_at - self.started_at).total_seconds())
        return None


class ScheduleFrequency(models.TextChoices):
    DAILY = "daily", "Daily"
    WEEKLY = "weekly", "Weekly"


class ScanSchedule(BaseModel):
    """Recurring scan. A Celery beat task starts due schedules through the same create_scan rules as a manual scan."""
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="schedules")
    scan_type = models.CharField(max_length=4, choices=ScanType.choices)
    profile = models.CharField(max_length=10, choices=ScanProfile.choices, default=ScanProfile.STANDARD)
    frequency = models.CharField(max_length=8, choices=ScheduleFrequency.choices, default=ScheduleFrequency.WEEKLY)
    hour_utc = models.PositiveSmallIntegerField(default=2, help_text="Hour of day (0-23, UTC)")
    weekday = models.PositiveSmallIntegerField(null=True, blank=True, help_text="0=Monday .. 6=Sunday; weekly schedules only")
    is_enabled = models.BooleanField(default=True, db_index=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+",
                                   help_text="Scans run with this user's permissions")
    next_run_at = models.DateTimeField(db_index=True)
    last_run_at = models.DateTimeField(null=True, blank=True)
    last_scan = models.ForeignKey("Scan", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    last_result = models.CharField(max_length=300, blank=True)

    def __str__(self):
        return f"{self.get_frequency_display()} {self.scan_type.upper()} scan of {self.project}"


class EngineRunStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    RUNNING = "running", "Running"
    SUCCEEDED = "succeeded", "Succeeded"
    FAILED = "failed", "Failed"


class EngineRun(BaseModel):
    scan = models.ForeignKey(Scan, on_delete=models.CASCADE, related_name="engine_runs")
    engine = models.CharField(max_length=30)
    engine_version = models.CharField(max_length=80, blank=True)
    status = models.CharField(max_length=10, choices=EngineRunStatus.choices, default=EngineRunStatus.PENDING)
    raw_findings_count = models.PositiveIntegerField(default=0)
    duration_ms = models.PositiveIntegerField(default=0)
    error_message = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("engine",)
        constraints = [models.UniqueConstraint(fields=("scan", "engine"), name="unique_engine_per_scan")]


class FindingQuerySet(models.QuerySet):
    def accessible_to(self, user):
        if user.is_staff:
            return self
        return self.filter(project__memberships__user=user)

    def open(self):
        return self.filter(triage_status__in=(TriageStatus.OPEN, TriageStatus.CONFIRMED))


class Finding(BaseModel):
    scan = models.ForeignKey(Scan, on_delete=models.CASCADE, related_name="findings")
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="findings", help_text="Denormalized for cross-scan queries")
    vulnerability_class = models.ForeignKey(VulnerabilityClass, null=True, blank=True, on_delete=models.SET_NULL, related_name="findings")

    # Identity
    fingerprint = models.CharField(max_length=64, help_text="Stable hash of the issue; same issue in a later scan = same fingerprint")
    issue_name = models.CharField(max_length=300)
    rule_id = models.CharField(max_length=300, blank=True)
    source_type = models.CharField(max_length=12, choices=SourceType.choices)
    detected_by = models.JSONField(default=list, help_text="Engines that reported this issue (cross-engine dedupe)")

    # Classification
    severity = models.CharField(max_length=8, choices=Severity.choices)
    confidence = models.CharField(max_length=6, choices=Confidence.choices, default=Confidence.MEDIUM)
    cwe_id = models.CharField(max_length=20, blank=True)
    owasp_category = models.CharField(max_length=80, blank=True)

    # Location (code or HTTP)
    file_path = models.CharField(max_length=1000, blank=True)
    line_number = models.PositiveIntegerField(null=True, blank=True)
    url = models.URLField(max_length=2000, blank=True)
    http_method = models.CharField(max_length=10, blank=True)
    parameter = models.CharField(max_length=300, blank=True)

    # Explanation & remediation
    description = models.TextField(blank=True, help_text="Engine-specific reason this location was flagged")
    evidence = models.TextField(blank=True)
    recommended_fix = models.TextField(blank=True, help_text="Engine-specific fix; generic steps come from vulnerability_class")
    references = models.JSONField(default=list)

    # Prioritization
    risk_score = models.DecimalField(max_digits=4, decimal_places=2)
    priority = models.CharField(max_length=2, choices=RemediationPriority.choices, db_index=True)
    fix_due_date = models.DateField(null=True, blank=True)

    # Lifecycle / triage
    triage_status = models.CharField(max_length=15, choices=TriageStatus.choices, default=TriageStatus.OPEN)
    triage_note = models.TextField(blank=True)
    triaged_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    triaged_at = models.DateTimeField(null=True, blank=True)
    first_seen_at = models.DateTimeField()
    is_new = models.BooleanField(default=True, help_text="Not present in the previous scan of the same type")

    objects = FindingQuerySet.as_manager()

    class Meta(BaseModel.Meta):
        ordering = ("-risk_score", "issue_name")
        constraints = [models.UniqueConstraint(fields=("scan", "fingerprint"), name="unique_finding_per_scan")]
        indexes = [
            models.Index(fields=("scan", "severity")),
            models.Index(fields=("scan", "priority")),
            models.Index(fields=("project", "fingerprint")),
            models.Index(fields=("project", "triage_status", "priority")),
        ]

    def __str__(self):
        return f"[{self.severity}] {self.issue_name}"

    @property
    def location(self) -> str:
        if self.file_path:
            return f"{self.file_path}:{self.line_number}" if self.line_number else self.file_path
        return f"{self.http_method} {self.url}".strip() + (f" [{self.parameter}]" if self.parameter else "")
