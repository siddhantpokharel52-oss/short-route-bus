import uuid
from django.db import models


class DailyAllocation(models.Model):
    """
    Links a vehicle to a route for a specific operating day.
    One bus = one route per day (can be changed by dispatcher).
    """
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        ACTIVE = "ACTIVE", "Active"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    date = models.DateField()
    route_id = models.UUIDField()
    vehicle_id = models.UUIDField()
    driver_id = models.UUIDField(null=True, blank=True)
    conductor_id = models.UUIDField(null=True, blank=True)
    shift_start = models.TimeField(default="05:00")
    shift_end = models.TimeField(default="21:00")
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.PENDING)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by_id = models.UUIDField(null=True, blank=True)

    class Meta:
        ordering = ["date", "shift_start"]
        # Each vehicle can only be allocated once per day
        unique_together = [["date", "vehicle_id"]]
        indexes = [
            models.Index(fields=["date", "status"]),
            models.Index(fields=["date", "route_id"]),
            models.Index(fields=["vehicle_id", "date"]),
        ]

    def __str__(self):
        return f"Allocation {self.date} - Vehicle {self.vehicle_id}"


class DispatchLog(models.Model):
    """Audit trail of all dispatcher actions."""
    class ActionType(models.TextChoices):
        ASSIGN = "ASSIGN", "Assign Bus to Route"
        REMOVE = "REMOVE", "Remove Bus from Route"
        EXTRA_TRIP = "EXTRA_TRIP", "Create Extra Trip"
        BREAKDOWN = "BREAKDOWN", "Mark Bus Breakdown"
        REASSIGN = "REASSIGN", "Reassign Replacement Bus"
        DELAY = "DELAY", "Report Delay"
        STATUS_UPDATE = "STATUS_UPDATE", "Status Update"
        GENERATE_SCHEDULE = "GENERATE_SCHEDULE", "Generate Daily Schedule"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    allocation = models.ForeignKey(
        DailyAllocation, on_delete=models.CASCADE, related_name="logs",
        null=True, blank=True
    )
    action_type = models.CharField(max_length=20, choices=ActionType.choices)
    vehicle_id = models.UUIDField(null=True, blank=True)
    route_id = models.UUIDField(null=True, blank=True)
    trip_id = models.UUIDField(null=True, blank=True)
    performed_by_id = models.UUIDField(null=True, blank=True)
    notes = models.TextField(blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)
    metadata = models.JSONField(default=dict)

    class Meta:
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["timestamp"]),
            models.Index(fields=["action_type"]),
            models.Index(fields=["vehicle_id", "timestamp"]),
        ]

    def __str__(self):
        return f"{self.action_type} at {self.timestamp}"
