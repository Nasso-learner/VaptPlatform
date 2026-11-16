from django.contrib import admin

from .models import EngineRun, Finding, Scan


class EngineRunInline(admin.TabularInline):
    model = EngineRun
    extra = 0
    readonly_fields = ("engine", "engine_version", "status", "raw_findings_count", "duration_ms", "error_message")


@admin.register(Scan)
class ScanAdmin(admin.ModelAdmin):
    list_display = ("project", "scan_type", "status", "risk_grade", "findings_count", "created_at")
    list_filter = ("scan_type", "status", "risk_grade")
    search_fields = ("project__name", "target")
    inlines = (EngineRunInline,)


@admin.register(Finding)
class FindingAdmin(admin.ModelAdmin):
    list_display = ("issue_name", "severity", "priority", "risk_score", "triage_status", "project", "created_at")
    list_filter = ("severity", "priority", "triage_status", "source_type")
    search_fields = ("issue_name", "file_path", "url", "cwe_id")
    raw_id_fields = ("scan", "project", "vulnerability_class", "triaged_by")
