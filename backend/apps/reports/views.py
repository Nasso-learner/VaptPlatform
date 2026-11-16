from django.http import FileResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.audit.services import record
from apps.projects.models import ProjectRole
from apps.projects.permissions import HasProjectRole, has_project_role
from apps.scans.models import Scan

from .models import REPORT_CONTENT_TYPES, Report, ReportStatus
from .serializers import ReportRegenerateSerializer, ReportSerializer
from .tasks import generate_scan_reports


class ReportViewSet(viewsets.ReadOnlyModelViewSet):
    """Generated reports. Download requires viewer role on the scan's project."""
    serializer_class = ReportSerializer
    permission_classes = (HasProjectRole,)
    required_roles = {"retrieve": ProjectRole.VIEWER, "download": ProjectRole.VIEWER}
    filterset_fields = ("scan", "report_format", "status")

    def get_queryset(self):
        queryset = Report.objects.select_related("scan__project")
        if not self.request.user.is_staff:
            queryset = queryset.filter(scan__project__memberships__user=self.request.user)
        return queryset

    def get_permission_project(self, report):
        return report.scan.project

    @extend_schema(parameters=[OpenApiParameter("inline", bool, description="HTML only: open in browser instead of downloading")],
                   responses={(200, "application/octet-stream"): bytes})
    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        report = self.get_object()
        if report.status != ReportStatus.READY or not report.file:
            raise NotFound("Report is not ready.")
        record(actor=request.user, action="report.download", request=request, target=report, project=report.scan.project,
               target_label=report.download_filename)
        inline = report.report_format == "html" and request.query_params.get("inline") in ("1", "true")
        response = FileResponse(report.file.open("rb"), as_attachment=not inline, filename=report.download_filename,
                                content_type=REPORT_CONTENT_TYPES[report.report_format])
        # Reports contain attacker-controlled evidence: never let an HTML report run scripts.
        response["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox"
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(request=ReportRegenerateSerializer, responses=ReportSerializer(many=True))
    @action(detail=False, methods=["post"])
    def regenerate(self, request):
        payload = ReportRegenerateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        scan = get_object_or_404(Scan.objects.select_related("project"), pk=payload.validated_data["scan"])
        if not has_project_role(request.user, scan.project, ProjectRole.ANALYST):
            raise PermissionDenied("Regenerating reports requires the analyst role.")
        if scan.is_active and scan.status != "reporting":
            raise ValidationError("Scan is still running.")
        generate_scan_reports.delay(str(scan.id), payload.validated_data.get("report_formats"))
        record(actor=request.user, action="report.regenerate", request=request, target=scan, project=scan.project,
               target_label=f"{scan.scan_type.upper()} scan of {scan.project.name}")
        return Response(ReportSerializer(scan.reports.all(), many=True, context={"request": request}).data, status=status.HTTP_202_ACCEPTED)
