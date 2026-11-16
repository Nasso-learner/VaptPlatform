import secrets

from django.conf import settings
from django.db import models
from django.utils.text import slugify

from apps.common.crypto import decrypt_secret, encrypt_secret
from apps.common.models import BaseModel


class ProjectRole(models.TextChoices):
    OWNER = "owner", "Owner"            # everything incl. members and deletion
    MAINTAINER = "maintainer", "Maintainer"  # edit settings, verify repo/target, run active scans
    ANALYST = "analyst", "Analyst"      # run scans, triage findings, regenerate reports
    VIEWER = "viewer", "Viewer"         # read-only: projects, scans, findings, reports


ROLE_RANK = {ProjectRole.VIEWER: 1, ProjectRole.ANALYST: 2, ProjectRole.MAINTAINER: 3, ProjectRole.OWNER: 4}


class RepositoryAccessLevel(models.TextChoices):
    UNVERIFIED = "unverified", "Unverified"
    READ = "read", "Read access"
    WRITE = "write", "Write access"
    ADMIN = "admin", "Admin access"
    UNKNOWN = "unknown", "Reachable (permission unknown)"


class ProjectQuerySet(models.QuerySet):
    def accessible_to(self, user):
        if user.is_staff:
            return self
        return self.filter(memberships__user=user).distinct()


class Project(BaseModel):
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, unique=True)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_projects")
    is_archived = models.BooleanField(default=False, db_index=True)

    # --- Source repository (SAST)
    repository_url = models.URLField(max_length=500, blank=True)
    repository_branch = models.CharField(max_length=200, blank=True)
    repository_token_encrypted = models.TextField(blank=True, help_text="Fernet-encrypted access token; never returned by the API")
    repository_access_level = models.CharField(max_length=12, choices=RepositoryAccessLevel.choices, default=RepositoryAccessLevel.UNVERIFIED)
    repository_verified_at = models.DateTimeField(null=True, blank=True)
    repository_head_commit = models.CharField(max_length=40, blank=True)

    # --- Running application (DAST)
    target_url = models.URLField(max_length=500, blank=True)
    target_verification_token = models.CharField(max_length=64, blank=True)
    target_verified_at = models.DateTimeField(null=True, blank=True)

    # --- Scan permissions (what this project is allowed to run)
    allow_sast = models.BooleanField(default=True)
    allow_dast = models.BooleanField(default=False)
    allow_active_dast = models.BooleanField(default=False, help_text="Allow attack payloads (SQLi/XSS fuzzing) against the target")
    authorization_confirmed_at = models.DateTimeField(null=True, blank=True)
    authorization_confirmed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    # --- Denormalized summary (updated after each scan) so dashboards don't aggregate findings on every request
    latest_risk_score = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    latest_risk_grade = models.CharField(max_length=1, blank=True)
    open_findings_count = models.PositiveIntegerField(default=0)
    last_scanned_at = models.DateTimeField(null=True, blank=True, db_index=True)

    objects = ProjectQuerySet.as_manager()

    class Meta(BaseModel.Meta):
        indexes = [models.Index(fields=("is_archived", "-created_at"))]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name)[:100] or "project"
            self.slug = f"{base}-{secrets.token_hex(3)}"
        if not self.target_verification_token:
            self.target_verification_token = secrets.token_urlsafe(24)
        super().save(*args, **kwargs)

    # Token is write-only: set via property, read only by the scan pipeline.
    @property
    def repository_token(self) -> str | None:
        return decrypt_secret(self.repository_token_encrypted)

    @repository_token.setter
    def repository_token(self, value: str | None):
        self.repository_token_encrypted = encrypt_secret(value)

    @property
    def is_repository_verified(self) -> bool:
        return self.repository_verified_at is not None

    @property
    def is_target_verified(self) -> bool:
        return self.target_verified_at is not None


class ProjectMembership(BaseModel):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="project_memberships")
    role = models.CharField(max_length=12, choices=ProjectRole.choices, default=ProjectRole.VIEWER)
    invited_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta(BaseModel.Meta):
        constraints = [models.UniqueConstraint(fields=("project", "user"), name="unique_project_member")]
        indexes = [models.Index(fields=("user", "project"))]

    def __str__(self):
        return f"{self.user} @ {self.project} ({self.role})"
