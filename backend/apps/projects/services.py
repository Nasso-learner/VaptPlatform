from urllib.parse import urljoin, urlparse

import httpx
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.common.scanner_client import ScannerClient, ScannerServiceError

from .models import Project, ProjectMembership, ProjectRole, RepositoryAccessLevel

LOCAL_HOSTS = {"localhost", "127.0.0.1", "host.docker.internal"}
VERIFICATION_PATH = "/.well-known/vapt-verification.txt"


@transaction.atomic
def create_project(*, created_by, repository_token: str | None = None, **fields) -> Project:
    project = Project(created_by=created_by, authorization_confirmed_at=timezone.now(), authorization_confirmed_by=created_by, **fields)
    if repository_token:
        project.repository_token = repository_token
    project.save()
    ProjectMembership.objects.create(project=project, user=created_by, role=ProjectRole.OWNER)
    return project


def validate_repository(project: Project) -> dict:
    """Step 2: verify the repository is reachable with the stored credentials and resolve the branch to a commit."""
    if not project.repository_url:
        return {"ok": False, "message": "project has no repository_url"}
    try:
        with ScannerClient() as client:
            result = client.validate_repository(project.repository_url, project.repository_branch, project.repository_token)
    except ScannerServiceError as exc:
        return {"ok": False, "message": str(exc)}
    if result.get("ok"):
        project.repository_access_level = result.get("access") or RepositoryAccessLevel.UNKNOWN
        project.repository_verified_at = timezone.now()
        project.repository_head_commit = result.get("commit_sha") or ""
        project.repository_branch = project.repository_branch or result.get("branch") or ""
    else:
        project.repository_access_level = RepositoryAccessLevel.UNVERIFIED
        project.repository_verified_at = None
    project.save(update_fields=["repository_access_level", "repository_verified_at", "repository_head_commit", "repository_branch", "updated_at"])
    return result


def target_verification_instructions(project: Project) -> dict:
    return {
        "method": "http-file",
        "file_url": urljoin(project.target_url or "https://your-app", VERIFICATION_PATH),
        "file_content": project.target_verification_token,
        "verified": project.is_target_verified,
        "verified_at": project.target_verified_at,
    }


def verify_target(project: Project) -> dict:
    """Prove ownership of the DAST target: the token must be served at /.well-known/vapt-verification.txt."""
    if not project.target_url:
        return {"verified": False, "message": "project has no target_url"}
    host = (urlparse(project.target_url).hostname or "").lower()
    if settings.ALLOW_LOCAL_DAST_TARGETS and host in LOCAL_HOSTS:
        verified, message = True, "local target accepted (ALLOW_LOCAL_DAST_TARGETS)"
    else:
        try:
            # Only a boolean comparison leaves this function; the response body is never returned to the caller.
            response = httpx.get(urljoin(project.target_url, VERIFICATION_PATH), timeout=10, follow_redirects=False)
            verified = response.status_code == 200 and response.text.strip() == project.target_verification_token
            message = "ownership verified" if verified else f"token not found at {VERIFICATION_PATH} (HTTP {response.status_code})"
        except httpx.HTTPError as exc:
            verified, message = False, f"could not reach target: {type(exc).__name__}"
    project.target_verified_at = timezone.now() if verified else None
    project.save(update_fields=["target_verified_at", "updated_at"])
    return {"verified": verified, "message": message}
