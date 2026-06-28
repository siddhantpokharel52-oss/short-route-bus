import uuid
from django.db import models


class Timetable(models.Model):
    class DayType(models.TextChoices):
        WEEKDAY = "WEEKDAY", "Weekday"
        SATURDAY = "SATURDAY", "Saturday"
        SUNDAY = "SUNDAY", "Sunday"
        HOLIDAY = "HOLIDAY", "Holiday"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    route_id = models.UUIDField()
    day_type = models.CharField(max_length=10, choices=DayType.choices)
    version = models.PositiveSmallIntegerField(default=1)
    effective_date = models.DateField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["route_id", "day_type"]
        indexes = [
            models.Index(fields=["route_id", "day_type"]),
            models.Index(fields=["effective_date"]),
        ]

    def __str__(self):
        return f"Route {self.route_id} - {self.day_type} v{self.version}"


class TimetableSlot(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    timetable = models.ForeignKey(Timetable, on_delete=models.CASCADE, related_name="slots")
    departure_time = models.TimeField()
    arrival_time = models.TimeField()
    frequency_minutes = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["departure_time"]


class Trip(models.Model):
    class Status(models.TextChoices):
        SCHEDULED = "SCHEDULED", "Scheduled"
        IN_PROGRESS = "IN_PROGRESS", "In Progress"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"
        DELAYED = "DELAYED", "Delayed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    trip_code = models.CharField(max_length=30, unique=True)
    timetable_slot = models.ForeignKey(
        TimetableSlot, null=True, blank=True, on_delete=models.SET_NULL, related_name="trips"
    )
    vehicle_id = models.UUIDField()
    driver_id = models.UUIDField()
    conductor_id = models.UUIDField(null=True, blank=True)
    route_id = models.UUIDField()
    date = models.DateField()
    scheduled_departure_time = models.TimeField(null=True, blank=True)
    scheduled_arrival_time = models.TimeField(null=True, blank=True)
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.SCHEDULED)
    actual_departure = models.DateTimeField(null=True, blank=True)
    actual_arrival = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.TextField(blank=True)
    delay_reason = models.TextField(blank=True)
    delay_minutes = models.PositiveSmallIntegerField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "trip_code"]
        indexes = [
            models.Index(fields=["date", "status"]),
            models.Index(fields=["vehicle_id", "date"]),
            models.Index(fields=["driver_id", "date"]),
            models.Index(fields=["route_id", "date"]),
        ]

    def __str__(self):
        return f"{self.trip_code} - {self.date}"


class DriverShift(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    driver_id = models.UUIDField()
    date = models.DateField()
    shift_start = models.TimeField()
    shift_end = models.TimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [["driver_id", "date"]]
        indexes = [models.Index(fields=["driver_id", "date"])]


class AutoScheduleConfig(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    route_id = models.UUIDField(unique=True)
    min_headway_minutes = models.PositiveSmallIntegerField(default=15)
    peak_buses = models.PositiveSmallIntegerField(default=5)
    off_peak_buses = models.PositiveSmallIntegerField(default=3)
    peak_start = models.TimeField(default="07:00")
    peak_end = models.TimeField(default="09:00")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
