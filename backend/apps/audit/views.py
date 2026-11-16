import django_filters
from rest_framework import serializers, viewsets

from apps.projects.models import ProjectRole

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", default=None, read_only=True)

    class Meta:
        model = AuditLog
        fields = ("id", "created_at", "actor", "actor_email", "action", "target_type", "target_id", "target_label",
                  "project", "project_name", "metadata", "ip_address")


class AuditLogFilter(django_filters.FilterSet):
    action_prefix = django_filters.CharFilter(field_name="action", lookup_expr="istartswith")
    created_after = django_filters.IsoDateTimeFilter(field_name="created_at", lookup_expr="gte")

    class Meta:
        model = AuditLog
        fields = ("project", "actor", "action")


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Platform admins see everything; project owners see events of projects they own."""
    serializer_class = AuditLogSerializer
    filterset_class = AuditLogFilter
    search_fields = ("actor_email", "action", "target_label")
    ordering_fields = ("created_at", "action")

    def get_queryset(self):
        queryset = AuditLog.objects.select_related("project")
        user = self.request.user
        if user.is_staff:
            return queryset
        return queryset.filter(project__memberships__user=user, project__memberships__role=ProjectRole.OWNER).distinct()
