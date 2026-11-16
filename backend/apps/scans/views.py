from datetime import timedelta

import django_filters
from django.db.models import Count, F, OuterRef, Q, Subquery
from django.db.models.functions import TruncDate
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import record
from apps.projects.models import Project, ProjectRole
from apps.projects.permissions import HasProjectRole, has_project_role

from .ingestion import issue_category_breakdown
from .models import Finding, Scan, ScanSchedule, ScanStatus
from .serializers import (FindingDetailSerializer, FindingListSerializer, FindingTriageSerializer, ScanDetailSerializer, ScanListSerializer,
                          ScanScheduleSerializer)
from .services import cancel_scan, triage_finding


class ScanFilter(django_filters.FilterSet):
    created_after = django_filters.IsoDateTimeFilter(field_name="created_at", lookup_expr="gte")

    class Meta:
        model = Scan
        fields = ("project", "scan_type", "status", "risk_grade")


class ScanViewSet(viewsets.ReadOnlyModelViewSet):
    """Scans across all projects the user belongs to. Create scans via POST /projects/{id}/scans/."""
    permission_classes = (HasProjectRole,)
    required_roles = {"list": ProjectRole.VIEWER, "retrieve": ProjectRole.VIEWER, "summary": ProjectRole.VIEWER,
                      "diff": ProjectRole.VIEWER, "cancel": ProjectRole.ANALYST}
    filterset_class = ScanFilter
    ordering_fields = ("created_at", "risk_score", "findings_count")
    search_fields = ("project__name", "target", "branch")

    def get_queryset(self):
        queryset = Scan.objects.select_related("project", "triggered_by")
        if not self.request.user.is_staff:
            queryset = queryset.filter(project__memberships__user=self.request.user)
        if self.action == "retrieve":
            queryset = queryset.prefetch_related("engine_runs", "reports")
        return queryset

    def get_serializer_class(self):
        return ScanDetailSerializer if self.action == "retrieve" else ScanListSerializer

    @extend_schema(request=None, responses=ScanDetailSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        scan = cancel_scan(self.get_object())
        record(actor=request.user, action="scan.cancel", request=request, target=scan, target_label=f"{scan.scan_type.upper()} scan of {scan.project.name}")
        return Response(ScanDetailSerializer(scan, context={"request": request}).data)

    @action(detail=True, methods=["get"])
    def diff(self, request, pk=None):
        """What changed since the previous completed scan of the same type: new, fixed and unchanged findings."""
        scan = self.get_object()
        previous = (Scan.objects.filter(project=scan.project, scan_type=scan.scan_type, status=ScanStatus.COMPLETED, created_at__lt=scan.created_at)
                    .order_by("-created_at").first())
        if previous is None:
            return Response({"scan": str(scan.id), "previous_scan": None, "new": [], "fixed": [], "new_count": 0, "fixed_count": 0, "unchanged_count": 0})
        current_fingerprints = set(scan.findings.values_list("fingerprint", flat=True))
        previous_fingerprints = set(previous.findings.values_list("fingerprint", flat=True))
        new = scan.findings.open().exclude(fingerprint__in=previous_fingerprints).select_related("vulnerability_class").order_by("-risk_score")
        fixed = previous.findings.open().exclude(fingerprint__in=current_fingerprints).select_related("vulnerability_class").order_by("-risk_score")
        limit = 200
        return Response({
            "scan": str(scan.id), "previous_scan": str(previous.id), "previous_scan_created_at": previous.created_at,
            "new_count": new.count(), "fixed_count": fixed.count(),
            "unchanged_count": len(current_fingerprints & previous_fingerprints),
            "new": FindingListSerializer(new[:limit], many=True).data,
            "fixed": FindingListSerializer(fixed[:limit], many=True).data,
        })

    @action(detail=True, methods=["get"])
    def summary(self, request, pk=None):
        """Findings grouped by issue category and priority, plus top-risk items, for the summary panel."""
        scan = self.get_object()
        top_findings = scan.findings.open().select_related("vulnerability_class").order_by("-risk_score")[:10]
        return Response({
            "scan": ScanListSerializer(scan).data,
            "issue_categories": issue_category_breakdown(scan),
            "priority_counts": scan.priority_counts,
            "severity_counts": scan.severity_counts,
            "top_findings": FindingListSerializer(top_findings, many=True).data,
        })


class FindingFilter(django_filters.FilterSet):
    severity = django_filters.MultipleChoiceFilter(choices=Finding._meta.get_field("severity").choices)
    priority = django_filters.MultipleChoiceFilter(choices=Finding._meta.get_field("priority").choices)
    triage_status = django_filters.MultipleChoiceFilter(choices=Finding._meta.get_field("triage_status").choices)
    issue_category = django_filters.CharFilter(field_name="vulnerability_class__issue_category")

    class Meta:
        model = Finding
        fields = ("scan", "project", "source_type", "is_new", "confidence")


class FindingViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = (HasProjectRole,)
    required_roles = {"list": ProjectRole.VIEWER, "retrieve": ProjectRole.VIEWER, "triage": ProjectRole.ANALYST}
    filterset_class = FindingFilter
    ordering_fields = ("risk_score", "severity", "priority", "created_at", "fix_due_date")
    search_fields = ("issue_name", "file_path", "url", "cwe_id", "rule_id")

    def get_queryset(self):
        queryset = Finding.objects.accessible_to(self.request.user).select_related("vulnerability_class", "project")
        if self.action != "list":
            queryset = queryset.select_related("scan", "triaged_by")
        return queryset

    def get_serializer_class(self):
        return FindingListSerializer if self.action == "list" else FindingDetailSerializer

    @extend_schema(request=FindingTriageSerializer, responses=FindingDetailSerializer)
    @action(detail=True, methods=["post"])
    def triage(self, request, pk=None):
        finding = self.get_object()
        payload = FindingTriageSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        triage_finding(finding, user=request.user, **payload.validated_data)
        record(actor=request.user, action="finding.triage", request=request, target=finding, target_label=finding.issue_name,
               triage_status=finding.triage_status)
        return Response(FindingDetailSerializer(finding, context={"request": request}).data)


class DashboardView(APIView):
    """Portfolio overview for the current user: cards, severity totals, trend, riskiest projects, recent scans."""

    def get(self, request):
        projects = Project.objects.accessible_to(request.user).filter(is_archived=False)
        scans = Scan.objects.filter(project__in=projects)
        # Open findings only from each project's latest completed scan per type (current exposure, not history).
        latest_of_kind = (Scan.objects.filter(project=OuterRef("project"), scan_type=OuterRef("scan_type"), status=ScanStatus.COMPLETED)
                          .order_by("-created_at").values("id")[:1])
        latest_scan_ids = (scans.filter(status=ScanStatus.COMPLETED).annotate(latest_id=Subquery(latest_of_kind))
                           .filter(id=F("latest_id")).values("id"))
        open_findings = Finding.objects.open().filter(scan_id__in=latest_scan_ids)
        since = timezone.now() - timedelta(days=30)

        return Response({
            "cards": {
                "projects": projects.count(),
                "scans_total": scans.count(),
                "scans_running": scans.exclude(status__in=(ScanStatus.COMPLETED, ScanStatus.FAILED, ScanStatus.CANCELLED)).count(),
                "scans_last_30_days": scans.filter(created_at__gte=since).count(),
                "open_findings": open_findings.count(),
                "p1_findings": open_findings.filter(priority="P1").count(),
                "overdue_findings": open_findings.filter(fix_due_date__lt=timezone.now().date()).count(),
            },
            "severity_totals": dict(open_findings.values_list("severity").annotate(n=Count("id")).values_list("severity", "n")),
            "priority_totals": dict(open_findings.values_list("priority").annotate(n=Count("id")).values_list("priority", "n")),
            "issue_category_totals": list(open_findings.values("vulnerability_class__issue_category")
                                          .annotate(count=Count("id")).order_by("-count")[:10]),
            "scan_trend": list(scans.filter(created_at__gte=since).annotate(day=TruncDate("created_at")).values("day")
                               .annotate(sast=Count("id", filter=Q(scan_type="sast")), dast=Count("id", filter=Q(scan_type="dast")))
                               .order_by("day")),
            "riskiest_projects": list(projects.filter(latest_risk_score__isnull=False).order_by("-latest_risk_score")
                                      .values("id", "name", "latest_risk_score", "latest_risk_grade", "open_findings_count", "last_scanned_at")[:5]),
            "recent_scans": ScanListSerializer(scans.select_related("project", "triggered_by").order_by("-created_at")[:8], many=True).data,
        })


class ScanScheduleViewSet(viewsets.ModelViewSet):
    """Recurring scans. Viewers can see them; analysts and above create, change and delete."""
    serializer_class = ScanScheduleSerializer
    permission_classes = (HasProjectRole,)
    required_roles = {"retrieve": ProjectRole.VIEWER, "update": ProjectRole.ANALYST, "partial_update": ProjectRole.ANALYST,
                      "destroy": ProjectRole.ANALYST}
    filterset_fields = ("project", "scan_type", "is_enabled", "frequency")
    ordering_fields = ("next_run_at", "created_at")

    def get_queryset(self):
        queryset = ScanSchedule.objects.select_related("project", "created_by", "last_scan")
        if not self.request.user.is_staff:
            queryset = queryset.filter(project__memberships__user=self.request.user).distinct()
        return queryset

    def get_permission_project(self, schedule):
        return schedule.project

    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        if not has_project_role(self.request.user, project, ProjectRole.ANALYST):
            raise PermissionDenied("Scheduling scans requires the analyst role or above.")
        schedule = serializer.save(created_by=self.request.user)
        record(actor=self.request.user, action="schedule.create", request=self.request, target=schedule, target_label=str(schedule))

    def perform_update(self, serializer):
        schedule = serializer.save()
        record(actor=self.request.user, action="schedule.update", request=self.request, target=schedule, target_label=str(schedule),
               changed=sorted(serializer.validated_data))

    def perform_destroy(self, schedule):
        record(actor=self.request.user, action="schedule.delete", request=self.request, project=schedule.project, target_label=str(schedule))
        schedule.delete()
