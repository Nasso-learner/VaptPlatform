"""
Per-project role-based access control.

Views declare the minimum role per action in `required_roles`, e.g.
    required_roles = {"list": "viewer", "create_scan": "analyst", "destroy": "owner"}
The project is resolved from the object via `get_permission_project(obj)` (defaults to obj.project / obj).
Platform staff bypass role checks.
"""
from rest_framework.permissions import BasePermission

from .models import ROLE_RANK, Project, ProjectMembership, ProjectRole


def get_user_role(user, project: Project) -> str | None:
    if user.is_staff:
        return ProjectRole.OWNER
    cache = getattr(user, "_project_role_cache", None)
    if cache is None:
        cache = user._project_role_cache = {}
    if project.pk not in cache:
        cache[project.pk] = ProjectMembership.objects.filter(project=project, user=user).values_list("role", flat=True).first()
    return cache[project.pk]


def has_project_role(user, project: Project, minimum_role: str) -> bool:
    role = get_user_role(user, project)
    return role is not None and ROLE_RANK[role] >= ROLE_RANK[minimum_role]


class HasProjectRole(BasePermission):
    message = "You do not have the required role on this project."

    def has_permission(self, request, view):
        # This class replaces the global IsAuthenticated default, so it must enforce authentication itself.
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        minimum_role = getattr(view, "required_roles", {}).get(view.action, ProjectRole.VIEWER)
        project = view.get_permission_project(obj) if hasattr(view, "get_permission_project") else getattr(obj, "project", obj)
        return has_project_role(request.user, project, minimum_role)
