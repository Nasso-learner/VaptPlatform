from rest_framework import viewsets

from .models import VulnerabilityClass
from .serializers import VulnerabilityClassSerializer


class VulnerabilityClassViewSet(viewsets.ReadOnlyModelViewSet):
    """Vulnerability knowledge base: explanation, impact and generic remediation for each issue type."""
    queryset = VulnerabilityClass.objects.all()
    serializer_class = VulnerabilityClassSerializer
    lookup_field = "slug"
    filterset_fields = ("issue_category", "base_priority")
    search_fields = ("name", "slug", "explanation")
