from rest_framework import serializers
from rest_framework.reverse import reverse

from .models import Report, ReportFormat


class ReportSerializer(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()
    filename = serializers.CharField(source="download_filename", read_only=True)

    class Meta:
        model = Report
        fields = ("id", "scan", "report_format", "status", "filename", "file_size_bytes", "sha256_checksum",
                  "generated_at", "error_message", "download_url")

    def get_download_url(self, report) -> str | None:
        if report.status != "ready":
            return None
        return reverse("report-download", kwargs={"pk": report.pk}, request=self.context.get("request"))


class ReportRegenerateSerializer(serializers.Serializer):
    scan = serializers.UUIDField()
    report_formats = serializers.ListField(child=serializers.ChoiceField(choices=ReportFormat.choices), required=False)
