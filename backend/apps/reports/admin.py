from django.contrib import admin

from .models import Report


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display = ("scan", "report_format", "status", "file_size_bytes", "generated_at")
    list_filter = ("report_format", "status")
    raw_id_fields = ("scan",)
