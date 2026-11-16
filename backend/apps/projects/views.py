from django.db.models import OuterRef, Subquery
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from apps.audit.services import record
from apps.scans.serializers import ScanCreateSerializer, ScanDetailSerializer, ScanListSerializer
from apps.scans.services import create_scan

from .models import Project, ProjectMembership, ProjectRole
from .permissions import HasProjectRole, has_project_role
from .serializers import MembershipRoleSerializer, ProjectMembershipSerializer, ProjectSerializer
from .services import create_project, target_verification_instructions, validate_repository, verify_target


class ProjectViewSet(viewsets.ModelViewSet):
    """
    Projects the user is a member of. Creating a project makes the caller its owner.
    Role needed per action is declared in `required_roles`.
    """
    serializer_class = ProjectSerializer
    permission_classes = (HasProjectRole,)
    required_roles = {
        "retrieve": ProjectRole.VIEWER, "scans": ProjectRole.VIEWER,
        "update": ProjectRole.MAINTAINER, "partial_update": ProjectRole.MAINTAINER,
        "validate_repository": ProjectRole.MAINTAINER, "target_verification": ProjectRole.MAINTAINER,
        "destroy": ProjectRole.OWNER,
    }
    filterset_fields = ("is_archived", "allow_sast", "allow_dast", "latest_risk_grade")
    search_fields = ("name", "description", "repository_url", "target_url")
    ordering_fields = ("name", "created_at", "latest_risk_score", "last_scanned_at", "open_findings_count")

    def get_queryset(self):
        my_role = ProjectMembership.objects.filter(project=OuterRef("pk"), user=self.request.user).values("role")[:1]
        return Project.objects.accessible_to(self.request.user).select_related("created_by").annotate(my_role=Subquery(my_role))

    def perform_create(self, serializer):
        data = dict(serializer.validated_data)
        project = create_project(created_by=self.request.user, repository_token=data.pop("repository_token", None), **data)
        serializer.instance = self.get_queryset().get(pk=project.pk)  # re-read so the my_role annotation is present
        record(actor=self.request.user, action="project.create", request=self.request, target=project, target_label=project.name)

    def perform_update(self, serializer):
        changed = sorted(f for f in serializer.validated_data if f != "repository_token")
        serializer.save()
        # Field names only: values (and the repository token) never enter the audit log.
        record(actor=self.request.user, action="project.update", request=self.request, target=serializer.instance,
               target_label=serializer.instance.name, changed=changed, token_changed="repository_token" in serializer.validated_data)

    def perform_destroy(self, project):
        record(actor=self.request.user, action="project.delete", request=self.request, target_label=project.name, project_name=project.name)
        project.delete()

    @extend_schema(request=None)
    @action(detail=True, methods=["post"], url_path="validate-repository")
    def validate_repository(self, request, pk=None):
        project = self.get_object()
        result = validate_repository(project)
        record(actor=request.user, action="project.validate_repository", request=request, target=project, target_label=project.name, ok=bool(result.get("ok")))
        return Response({**result, "project": ProjectSerializer(self.get_queryset().get(pk=project.pk), context={"request": request}).data},
                        status=status.HTTP_200_OK if result.get("ok") else status.HTTP_400_BAD_REQUEST)

    @extend_schema(request=None)
    @action(detail=True, methods=["get", "post"], url_path="target-verification")
    def target_verification(self, request, pk=None):
        """GET: instructions (file + token to publish). POST: check the token is served and mark the target verified."""
        project = self.get_object()
        if request.method == "GET":
            return Response(target_verification_instructions(project))
        result = verify_target(project)
        record(actor=request.user, action="project.verify_target", request=request, target=project, target_label=project.name, verified=result["verified"])
        return Response({**result, **target_verification_instructions(project)},
                        status=status.HTTP_200_OK if result["verified"] else status.HTTP_400_BAD_REQUEST)

    @extend_schema(methods=["POST"], request=ScanCreateSerializer, responses=ScanDetailSerializer)
    @action(detail=True, methods=["get", "post"])
    def scans(self, request, pk=None):
        """GET: this project's scan history. POST: start a SAST or DAST scan (analyst or above)."""
        project = self.get_object()
        if request.method == "GET":
            queryset = project.scans.select_related("project", "triggered_by")
            scan_type = request.query_params.get("scan_type")
            if scan_type:
                queryset = queryset.filter(scan_type=scan_type)
            page = self.paginate_queryset(queryset)
            return self.get_paginated_response(ScanListSerializer(page, many=True).data)
        if not has_project_role(request.user, project, ProjectRole.ANALYST):
            raise PermissionDenied("Running scans requires the analyst role or above.")
        payload = ScanCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        scan = create_scan(project=project, user=request.user, **payload.validated_data)
        record(actor=request.user, action="scan.create", request=request, target=scan, target_label=f"{scan.scan_type.upper()} scan of {project.name}",
               scan_type=scan.scan_type, engines=scan.engines, active=bool(scan.configuration.get("active")))
        return Response(ScanDetailSerializer(scan, context={"request": request}).data, status=status.HTTP_201_CREATED)

    def get_throttles(self):
        if self.action == "scans" and self.request.method == "POST":
            self.throttle_scope = "scan_create"
            return [ScopedRateThrottle()]
        return super().get_throttles()


class ProjectMembershipViewSet(viewsets.ModelViewSet):
    """Members of a project. Any member can list; only owners can add, change roles or remove."""
    http_method_names = ("get", "post", "patch", "delete")
    pagination_class = None

    def get_project(self) -> Project:
        project = get_object_or_404(Project.objects.accessible_to(self.request.user), pk=self.kwargs["project_id"])
        minimum = ProjectRole.VIEWER if self.request.method == "GET" else ProjectRole.OWNER
        if not has_project_role(self.request.user, project, minimum):
            raise PermissionDenied("Only project owners can manage members.")
        return project

    def get_queryset(self):
        return ProjectMembership.objects.filter(project=self.get_project()).select_related("user").order_by("created_at")

    def get_serializer_class(self):
        return MembershipRoleSerializer if self.action == "partial_update" else ProjectMembershipSerializer

    def perform_create(self, serializer):
        project = self.get_project()
        user = serializer.validated_data.pop("email")
        if ProjectMembership.objects.filter(project=project, user=user).exists():
            raise ValidationError({"email": "User is already a member."})
        membership = serializer.save(project=project, user=user, invited_by=self.request.user)
        record(actor=self.request.user, action="member.add", request=self.request, target=membership, project=project,
               target_label=user.email, role=membership.role)

    def _guard_last_owner(self, membership: ProjectMembership, new_role: str | None = None):
        if membership.role == ProjectRole.OWNER and new_role != ProjectRole.OWNER:
            if not ProjectMembership.objects.filter(project=membership.project, role=ProjectRole.OWNER).exclude(pk=membership.pk).exists():
                raise ValidationError("A project must keep at least one owner.")

    def perform_update(self, serializer):
        self._guard_last_owner(serializer.instance, serializer.validated_data.get("role"))
        previous_role = serializer.instance.role
        membership = serializer.save()
        record(actor=self.request.user, action="member.role_change", request=self.request, target=membership, project=membership.project,
               target_label=membership.user.email, from_role=previous_role, to_role=membership.role)

    def perform_destroy(self, membership):
        self._guard_last_owner(membership)
        record(actor=self.request.user, action="member.remove", request=self.request, project=membership.project,
               target_label=membership.user.email, role=membership.role)
        membership.delete()
