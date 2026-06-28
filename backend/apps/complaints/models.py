import uuid
from django.db import models


class Complaint(models.Model):
    class ComplaintType(models.TextChoices):
        LATE_BUS = "LATE_BUS", "Late Bus"
        DRIVER_BEHAVIOR = "DRIVER_BEHAVIOR", "Driver Behavior"
        CONDUCTOR_BEHAVIOR = "CONDUCTOR_BEHAVIOR", "Conductor Behavior"
        TICKET_ISSUE = "TICKET_ISSUE", "Ticket Issue"
        CLEANLINESS = "CLEANLINESS", "Cleanliness"
        OVERCROWDING = "OVERCROWDING", "Overcrowding"
        SAFETY = "SAFETY", "Safety"
        OTHER = "OTHER", "Other"

    class Status(models.TextChoices):
        SUBMITTED = "SUBMITTED", "Submitted"
        ASSIGNED = "ASSIGNED", "Assigned"
        IN_PROGRESS = "IN_PROGRESS", "In Progress"
        RESOLVED = "RESOLVED", "Resolved"
        CLOSED = "CLOSED", "Closed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    complaint_no = models.CharField(max_length=20, unique=True)
    passenger_id = models.UUIDField(null=True, blank=True)
    passenger_name = models.CharField(max_length=255, blank=True)
    passenger_phone = models.CharField(max_length=20, blank=True)
    complaint_type = models.CharField(max_length=25, choices=ComplaintType.choices)
    description = models.TextField()
    trip_id = models.UUIDField(null=True, blank=True)
    vehicle_no = models.CharField(max_length=20, blank=True)
    route_id = models.UUIDField(null=True, blank=True)
    tenant_id = models.UUIDField(null=True, blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.SUBMITTED)
    is_deleted = models.BooleanField(default=False)

    class Meta:
        ordering = ["-submitted_at"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["tenant_id"]),
            models.Index(fields=["complaint_type"]),
        ]

    def __str__(self):
        return f"{self.complaint_no} - {self.complaint_type}"


class ComplaintAssignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    complaint = models.ForeignKey(Complaint, on_delete=models.CASCADE, related_name="assignments")
    assigned_to_id = models.UUIDField()
    assigned_at = models.DateTimeField(auto_now_add=True)
    due_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-assigned_at"]


class ComplaintResolution(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    complaint = models.OneToOneField(Complaint, on_delete=models.CASCADE, related_name="resolution")
    resolved_by_id = models.UUIDField()
    resolved_at = models.DateTimeField(auto_now_add=True)
    resolution_notes = models.TextField()
    satisfaction_rating = models.PositiveSmallIntegerField(null=True, blank=True)
