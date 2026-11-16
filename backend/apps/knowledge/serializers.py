from rest_framework import serializers

from .models import VulnerabilityClass


class VulnerabilityClassSerializer(serializers.ModelSerializer):
    issue_category_label = serializers.CharField(source="get_issue_category_display", read_only=True)

    class Meta:
        model = VulnerabilityClass
        fields = ("id", "slug", "name", "issue_category", "issue_category_label", "owasp_category", "cwe_ids",
                  "explanation", "business_impact", "remediation_steps", "base_priority", "references")
