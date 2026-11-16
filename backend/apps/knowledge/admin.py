from django.contrib import admin

from .models import VulnerabilityClass


@admin.register(VulnerabilityClass)
class VulnerabilityClassAdmin(admin.ModelAdmin):
    list_display = ("name", "issue_category", "owasp_category", "base_priority")
    list_filter = ("issue_category", "base_priority")
    search_fields = ("name", "slug")
