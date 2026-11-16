from django.contrib import admin

from .models import Project, ProjectMembership


class ProjectMembershipInline(admin.TabularInline):
    model = ProjectMembership
    extra = 0
    raw_id_fields = ("user", "invited_by")


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "created_by", "allow_sast", "allow_dast", "latest_risk_grade", "open_findings_count", "last_scanned_at")
    list_filter = ("allow_sast", "allow_dast", "is_archived", "latest_risk_grade")
    search_fields = ("name", "repository_url", "target_url")
    exclude = ("repository_token_encrypted",)
    inlines = (ProjectMembershipInline,)
