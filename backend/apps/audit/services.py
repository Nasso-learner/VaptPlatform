import logging

from .models import AuditLog

logger = logging.getLogger(__name__)


def _client_ip(request) -> str | None:
    if request is None:
        return None
    # Only trust the socket address: X-Forwarded-For is client-controlled unless a trusted proxy rewrites it.
    return request.META.get("REMOTE_ADDR") or None


def record(*, actor, action: str, request=None, target=None, target_label: str = "", project=None, **metadata) -> None:
    """Write an audit entry. Never raises: auditing must not break the action it describes."""
    try:
        if project is None and target is not None:
            project = getattr(target, "project", None) or (target if target.__class__.__name__ == "Project" else None)
        AuditLog.objects.create(
            actor=actor if actor and getattr(actor, "is_authenticated", False) else None,
            actor_email=getattr(actor, "email", "") if actor else "",
            action=action,
            target_type=target.__class__.__name__.lower() if target is not None else "",
            target_id=str(getattr(target, "pk", "")) if target is not None else "",
            target_label=(target_label or (str(target) if target is not None else ""))[:300],
            project=project if getattr(project, "pk", None) else None,
            metadata=metadata,
            ip_address=_client_ip(request),
        )
    except Exception:  # noqa: BLE001
        logger.exception("could not write audit log entry %s", action)
