from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from apps.accounts.views import UserViewSet
from apps.audit.views import AuditLogViewSet
from apps.knowledge.views import VulnerabilityClassViewSet
from apps.projects.views import ProjectMembershipViewSet, ProjectViewSet
from apps.reports.views import ReportViewSet
from apps.scans.views import DashboardView, FindingViewSet, ScanScheduleViewSet, ScanViewSet

router = DefaultRouter()
router.register("projects", ProjectViewSet, basename="project")
router.register("scans", ScanViewSet, basename="scan")
router.register("findings", FindingViewSet, basename="finding")
router.register("reports", ReportViewSet, basename="report")
router.register("knowledge", VulnerabilityClassViewSet, basename="knowledge")
router.register("users", UserViewSet, basename="user")
router.register("audit-logs", AuditLogViewSet, basename="audit-log")
router.register("schedules", ScanScheduleViewSet, basename="schedule")

membership_list = ProjectMembershipViewSet.as_view({"get": "list", "post": "create"})
membership_detail = ProjectMembershipViewSet.as_view({"patch": "partial_update", "delete": "destroy"})

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/dashboard/", DashboardView.as_view(), name="dashboard"),
    path("api/v1/projects/<uuid:project_id>/members/", membership_list, name="project-members"),
    path("api/v1/projects/<uuid:project_id>/members/<uuid:pk>/", membership_detail, name="project-member-detail"),
    path("api/v1/", include(router.urls)),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]

