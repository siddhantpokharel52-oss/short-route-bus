from celery import shared_task


@shared_task
def auto_schedule_route(route_id, date):
    """Auto-generate trips for a route on a given date based on AutoScheduleConfig."""
    from .models import AutoScheduleConfig, Timetable, Trip, TimetableSlot
    from django.utils import timezone
    import datetime

    try:
        config = AutoScheduleConfig.objects.get(route_id=route_id, is_active=True)
    except AutoScheduleConfig.DoesNotExist:
        return f"No auto-schedule config for route {route_id}"

    target_date = datetime.date.fromisoformat(date)
    weekday = target_date.weekday()
    if weekday < 5:
        day_type = Timetable.DayType.WEEKDAY
    elif weekday == 5:
        day_type = Timetable.DayType.SATURDAY
    else:
        day_type = Timetable.DayType.SUNDAY

    timetable = Timetable.objects.filter(route_id=route_id, day_type=day_type, is_active=True).first()
    if not timetable:
        return f"No timetable found for route {route_id} on {day_type}"

    created_count = 0
    for slot in timetable.slots.all():
        trip_code = f"{route_id[:8].upper()}-{date}-{slot.departure_time.strftime('%H%M')}"
        if not Trip.objects.filter(trip_code=trip_code).exists():
            Trip.objects.create(
                trip_code=trip_code,
                timetable_slot=slot,
                vehicle_id=route_id,  # placeholder, needs real assignment
                driver_id=route_id,   # placeholder
                route_id=route_id,
                date=target_date,
                status=Trip.Status.SCHEDULED,
            )
            created_count += 1

    return f"Created {created_count} trips for route {route_id} on {date}"
