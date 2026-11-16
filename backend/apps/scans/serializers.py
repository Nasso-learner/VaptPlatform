from django.utils import timezone
from rest_framework import serializers

from apps.accounts.serializers import UserSerializer
from apps.knowledge.serializers import VulnerabilityClassSerializer
from apps.projects.models import Project

from .models import EngineRun, Finding, Scan, ScanProfile, ScanSchedule, ScanType, ScheduleFrequency, TriageStatus
from .schedules import compute_next_run


class EngineRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = EngineRun
        fields = ("engine", "engine_version", "status", "raw_findings_count", "duration_ms", "error_message")


class ScanListSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)
    triggered_by = serializers.EmailField(source="triggered_by.email", read_only=True, default=None)
    duration_seconds = serializers.IntegerField(read_only=True)

    class Meta:
        model = Scan
        fields = ("id", "project", "project_name", "scan_type", "status", "progress_percent", "target", "branch", "commit_sha",
                  "risk_score", "risk_grade", "severity_counts", "priority_counts", "findings_count", "new_findings_count",
                  "triggered_by", "created_at", "started_at", "completed_at", "duration_seconds")


class ScanDetailSerializer(ScanListSerializer):
    engine_runs = EngineRunSerializer(many=True, read_only=True)
    reports = serializers.SerializerMethodField()

    class Meta(ScanListSerializer.Meta):
        fields = ScanListSerializer.Meta.fields + ("engines", "configuration", "engine_runs", "error_message", "reports")

    def get_reports(self, scan):
        from apps.reports.serializers import ReportSerializer
        return ReportSerializer(scan.reports.all(), many=True, context=self.context).data


class ScanCreateSerializer(serializers.Serializer):
    scan_type = serializers.ChoiceField(choices=ScanType.choices)
    engines = serializers.ListField(child=serializers.CharField(), required=False,
                                    help_text="Overrides the profile's engine list")
    profile = serializers.ChoiceField(choices=ScanProfile.choices, default=ScanProfile.STANDARD)
    active = serializers.BooleanField(default=False, help_text="DAST only: send attack payloads")
    openapi_url = serializers.URLField(required=False, allow_blank=True, help_text="DAST only: OpenAPI spec to drive an API scan")
    auth_header = serializers.CharField(required=False, allow_blank=True, write_only=True,
                                        help_text='DAST only, never stored. e.g. "Authorization: Bearer ..."')

    def validate_auth_header(self, value):
        if value and (":" not in value or "\n" in value or "\r" in value):
            raise serializers.ValidationError('Use the form "Header-Name: value" on a single line.')
        return value


class FindingListSerializer(serializers.ModelSerializer):
    issue_category = serializers.CharField(source="vulnerability_class.issue_category", default=None, read_only=True)
    issue_category_label = serializers.CharField(source="vulnerability_class.get_issue_category_display", default=None, read_only=True)
    location = serializers.CharField(read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = Finding
        fields = ("id", "scan", "project", "project_name", "issue_name", "issue_category", "issue_category_label", "source_type", "severity", "confidence",
                  "priority", "risk_score", "cwe_id", "owasp_category", "location", "file_path", "line_number", "url",
                  "detected_by", "triage_status", "is_new", "fix_due_date", "first_seen_at")


class FindingDetailSerializer(FindingListSerializer):
    vulnerability_class = VulnerabilityClassSerializer(read_only=True)
    triaged_by = UserSerializer(read_only=True)
    source_link = serializers.SerializerMethodField()

    class Meta(FindingListSerializer.Meta):
        fields = FindingListSerializer.Meta.fields + (
            "rule_id", "http_method", "parameter", "description", "evidence", "recommended_fix", "references",
            "vulnerability_class", "triage_note", "triaged_by", "triaged_at", "source_link")

    def get_source_link(self, finding) -> str | None:
        """Deep link to the exact line at the scanned commit (GitHub/GitLab)."""
        scan = finding.scan
        if not finding.file_path or not scan.commit_sha or "://" not in scan.target:
            return None
        base = scan.target.removesuffix(".git")
        line = f"#L{finding.line_number}" if finding.line_number else ""
        if "github.com" in base:
            return f"{base}/blob/{scan.commit_sha}/{finding.file_path}{line}"
        if "gitlab.com" in base:
            return f"{base}/-/blob/{scan.commit_sha}/{finding.file_path}{line}"
        return None


class FindingTriageSerializer(serializers.Serializer):
    triage_status = serializers.ChoiceField(choices=TriageStatus.choices)
    triage_note = serializers.CharField(required=False, allow_blank=True, max_length=2000)

    def validate(self, attrs):
        if attrs["triage_status"] in (TriageStatus.FALSE_POSITIVE, TriageStatus.ACCEPTED_RISK) and not attrs.get("triage_note"):
            raise serializers.ValidationError({"triage_note": "A justification is required for false positives and accepted risks."})
        return attrs


class ScanScheduleSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)
    created_by_email = serializers.EmailField(source="created_by.email", read_only=True, default=None)
    last_scan_status = serializers.CharField(source="last_scan.status", read_only=True, default=None)

    class Meta:
        model = ScanSchedule
        fields = ("id", "project", "project_name", "scan_type", "profile", "frequency", "hour_utc", "weekday", "is_enabled",
                  "created_by_email", "next_run_at", "last_run_at", "last_scan", "last_scan_status", "last_result", "created_at")
        read_only_fields = ("next_run_at", "last_run_at", "last_scan", "last_result")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is not None and "project" in self.fields:  # don't reveal or accept projects the caller cannot see
            self.fields["project"].queryset = Project.objects.accessible_to(request.user)

    def validate_hour_utc(self, value):
        if not 0 <= value <= 23:
            raise serializers.ValidationError("Hour must be between 0 and 23.")
        return value

    def validate_weekday(self, value):
        if value is not None and not 0 <= value <= 6:
            raise serializers.ValidationError("Weekday must be 0 (Monday) to 6 (Sunday).")
        return value

    def validate(self, attrs):
        current = {f: getattr(self.instance, f) for f in ("project", "scan_type", "frequency", "weekday")} if self.instance else {}
        merged = {**current, **attrs}
        if self.instance and "project" in attrs and attrs["project"].pk != self.instance.project_id:
            raise serializers.ValidationError({"project": "A schedule cannot be moved to another project."})
        if merged["frequency"] == ScheduleFrequency.WEEKLY and merged.get("weekday") is None:
            raise serializers.ValidationError({"weekday": "Required for weekly schedules."})
        project: Project = merged["project"]
        if merged["scan_type"] == ScanType.SAST and not project.allow_sast:
            raise serializers.ValidationError({"scan_type": "SAST is not enabled for this project."})
        if merged["scan_type"] == ScanType.DAST and not project.allow_dast:
            raise serializers.ValidationError({"scan_type": "DAST is not enabled for this project."})
        return attrs

    def _with_next_run(self, validated_data: dict, instance: ScanSchedule | None = None) -> dict:
        source = {f: validated_data.get(f, getattr(instance, f, None)) for f in ("frequency", "hour_utc", "weekday")}
        if source["frequency"] == ScheduleFrequency.DAILY:
            validated_data["weekday"] = None
            source["weekday"] = None
        validated_data["next_run_at"] = compute_next_run(source["frequency"], source["hour_utc"], source["weekday"], timezone.now())
        return validated_data

    def create(self, validated_data):
        return super().create(self._with_next_run(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._with_next_run(validated_data, instance))
