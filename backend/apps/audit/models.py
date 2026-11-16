from django.conf import settings
from django.db import models

from apps.common.models import BaseModel


class AuditLog(BaseModel):
    """Append-only record of who did what. Actor email is denormalized so history survives account deletion."""
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    actor_email = models.CharField(max_length=254, blank=True, db_index=True)
    action = models.CharField(max_length=60, db_index=True, help_text='Dotted verb, e.g. "scan.create"')
    target_type = models.CharField(max_length=40, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    target_label = models.CharField(max_length=300, blank=True)
    project = models.ForeignKey("projects.Project", null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_logs")
    metadata = models.JSONField(default=dict, help_text="Non-secret context only (never tokens or passwords)")
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta(BaseModel.Meta):
        indexes = [models.Index(fields=("project", "-created_at")), models.Index(fields=("action", "-created_at"))]

    def __str__(self):
        return f"{self.actor_email or 'system'} {self.action} {self.target_label}"
