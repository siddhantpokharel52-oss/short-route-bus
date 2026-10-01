"""
Dispatch Celery Tasks
=====================
Scheduled job that watches shift_end times across every tenant and:
  1. Auto-completes any PENDING/ACTIVE allocation whose shift has ended --
     the exact same effect as a dispatcher clicking "End Shift" by hand
     (DailyAllocationViewSet.end_shift), just triggered by the clock
     instead of a click.
  2. If that allocation was marked is_recurring, auto-creates tomorrow's
     equivalent (same vehicle/route/driver/conductor/shift times) --
     reusing the same vehicle/crew conflict checks the manual "Copy
     Schedule" action (DailyAllocationViewSet.copy) already applies, so an
     auto-created row never overwrites something a dispatcher already set
     up for that day. A conflict skips silently (logged, not failed).
"""
from celery import shared_task
from datetime import timedelta
from django.utils import timezone
import logging

logger = logging.getLogger("dispatch.tasks")


@shared_task(name="dispatch.auto_complete_and_recur_shifts")
def auto_complete_and_recur_shifts():
    from backend.apps.tenants.models import Tenant
    from django_tenants.utils import schema_context

    completed_total, recurred_total, skipped_total = 0, 0, 0
    for tenant in Tenant.objects.filter(status=Tenant.Status.ACTIVE):
        try:
            with schema_context(tenant.schema_name):
                c, r, s = _process_tenant_shifts()
                completed_total += c
                recurred_total += r
                skipped_total += s
        except Exception as exc:
            logger.error("Shift auto-completion failed for %s: %s", tenant.schema_name, exc)

    logger.info(
        "Shift auto-completion done: %d completed, %d recurred, %d skipped.",
        completed_total, recurred_total, skipped_total,
    )
    return {"completed": completed_total, "recurred": recurred_total, "skipped": skipped_total}


def _process_tenant_shifts():
    from backend.apps.dispatch.models import DailyAllocation, DispatchLog
    from backend.apps.fleet.models import Vehicle

    # TIME_ZONE is UTC repo-wide (no per-tenant local-time layer exists
    # anywhere in this codebase today) -- shift_start/shift_end are plain,
    # timezone-naive TimeFields storing whatever wall-clock value a
    # dispatcher typed in, so "now" here is compared on the same basis
    # every other "today"/"now" check in this app already uses.
    now = timezone.localtime()
    today, now_time = now.date(), now.time()

    due = DailyAllocation.objects.filter(
        date=today,
        status__in=[DailyAllocation.Status.PENDING, DailyAllocation.Status.ACTIVE],
        shift_end__lte=now_time,
    )

    completed, recurred, skipped = 0, 0, 0
    for allocation in due:
        Vehicle.objects.filter(pk=allocation.vehicle_id).update(status="ACTIVE", assigned_route_id=None)
        allocation.status = DailyAllocation.Status.COMPLETED
        allocation.save(update_fields=["status", "updated_at"])
        DispatchLog.objects.create(
            allocation=allocation,
            action_type=DispatchLog.ActionType.AUTO_COMPLETE,
            vehicle_id=allocation.vehicle_id,
            route_id=allocation.route_id,
            notes=f"Shift auto-completed for {allocation.date} (shift_end {allocation.shift_end} passed).",
        )
        completed += 1

        if not allocation.is_recurring:
            continue

        tomorrow = allocation.date + timedelta(days=1)
        skip_reason = _recur_skip_reason(allocation, tomorrow)
        if skip_reason:
            DispatchLog.objects.create(
                allocation=allocation,
                action_type=DispatchLog.ActionType.AUTO_RECUR,
                vehicle_id=allocation.vehicle_id,
                route_id=allocation.route_id,
                notes=f"Skipped auto-recur to {tomorrow}: {skip_reason}",
            )
            skipped += 1
            continue

        new_alloc = DailyAllocation.objects.create(
            date=tomorrow,
            route_id=allocation.route_id,
            vehicle_id=allocation.vehicle_id,
            driver_id=allocation.driver_id,
            conductor_id=allocation.conductor_id,
            shift_start=allocation.shift_start,
            shift_end=allocation.shift_end,
            status=DailyAllocation.Status.PENDING,
            is_recurring=True,
            notes=f"Auto-recurred from {allocation.date}",
        )
        Vehicle.objects.filter(pk=new_alloc.vehicle_id).update(
            status="ASSIGNED", assigned_route_id=new_alloc.route_id,
        )
        DispatchLog.objects.create(
            allocation=new_alloc,
            action_type=DispatchLog.ActionType.AUTO_RECUR,
            vehicle_id=new_alloc.vehicle_id,
            route_id=new_alloc.route_id,
            notes=f"Auto-created recurring allocation for {tomorrow} from {allocation.date}.",
        )
        recurred += 1

    return completed, recurred, skipped


def _recur_skip_reason(allocation, tomorrow):
    """Same checks DailyAllocationViewSet.copy() applies per-row -- never
    force an auto-recurred row onto a vehicle/driver/conductor a dispatcher
    has already allocated elsewhere for that day."""
    from backend.apps.dispatch.models import DailyAllocation

    if DailyAllocation.objects.filter(date=tomorrow, vehicle_id=allocation.vehicle_id).exists():
        return "vehicle is already allocated on that day."

    active_statuses = [DailyAllocation.Status.PENDING, DailyAllocation.Status.ACTIVE]
    for field, label, person_id in (
        ("driver_id", "driver", allocation.driver_id),
        ("conductor_id", "conductor", allocation.conductor_id),
    ):
        if not person_id:
            continue
        if DailyAllocation.objects.filter(
            date=tomorrow, status__in=active_statuses, **{field: person_id}
        ).exists():
            return f"{label} is already allocated to another vehicle on that day."
    return None
