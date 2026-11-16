import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException

from apps.audit.services import record
from apps.projects.models import ProjectRole
from apps.projects.permissions import has_project_role

from .models import PROFILE_ENGINES, ScanSchedule, ScheduleFrequency

logger = logging.getLogger(__name__)


def compute_next_run(frequency: str, hour_utc: int, weekday: int | None, after):
    """First run strictly after `after` that falls on the configured hour (and weekday, for weekly)."""
    candidate = after.replace(hour=hour_utc, minute=0, second=0, microsecond=0)
    if frequency == ScheduleFrequency.WEEKLY:
        candidate += timedelta(days=((weekday or 0) - candidate.weekday()) % 7)
        step = timedelta(days=7)
    else:
        step = timedelta(days=1)
    return candidate if candidate > after else candidate + step


def _reason(exc: Exception) -> str:
    detail = exc.detail if isinstance(exc, APIException) else str(exc)
    return str(detail)[:250]


def run_schedule(schedule: ScanSchedule, now) -> None:
    from .services import create_scan  # local import: services imports tasks lazily as well

    schedule.last_run_at = now
    schedule.last_scan = None
    try:
        user = schedule.created_by
        if user is None or not user.is_active or not has_project_role(user, schedule.project, ProjectRole.ANALYST):
            raise PermissionError("the schedule's owner no longer has analyst access to this project")
        scan = create_scan(project=schedule.project, user=user, scan_type=schedule.scan_type,
                           engines=list(PROFILE_ENGINES[schedule.scan_type][schedule.profile]), profile=schedule.profile)
        schedule.last_scan, schedule.last_result = scan, "started"
        record(actor=user, action="scan.scheduled", target=scan, target_label=f"{scan.scan_type.upper()} scan of {schedule.project.name}",
               schedule_id=str(schedule.id))
    except Exception as exc:  # noqa: BLE001  one bad schedule must never stop the others
        if not isinstance(exc, (APIException, PermissionError)):
            logger.exception("schedule %s failed", schedule.id)
        schedule.last_result = f"skipped: {_reason(exc)}"
    schedule.next_run_at = compute_next_run(schedule.frequency, schedule.hour_utc, schedule.weekday, now)
    schedule.save(update_fields=["last_run_at", "last_scan", "last_result", "next_run_at", "updated_at"])


def run_due_schedules() -> int:
    now = timezone.now()
    ran = 0
    for schedule_id in ScanSchedule.objects.filter(is_enabled=True, next_run_at__lte=now).values_list("pk", flat=True):
        with transaction.atomic():
            # Re-check under a row lock so two beat processes cannot both start the same run.
            schedule = ScanSchedule.objects.select_for_update().select_related("project", "created_by").get(pk=schedule_id)
            if not schedule.is_enabled or schedule.next_run_at > now:
                continue
            run_schedule(schedule, now)
            ran += 1
    return ran
