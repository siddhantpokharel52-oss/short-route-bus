import uuid
from django.db import models


class Incident(models.Model):
    class IncidentType(models.TextChoices):
        ACCIDENT = "ACCIDENT", "Accident"
        BREAKDOWN = "BREAKDOWN", "Breakdown"
        CRIME = "CRIME", "Crime"
        MEDICAL_EMERGENCY = "MEDICAL_EMERGENCY", "Medical Emergency"
        OTHER = "OTHER", "Other"

    class Severity(models.TextChoices):
        LOW = "LOW", "Low"
        MEDIUM = "MEDIUM", "Medium"
        HIGH = "HIGH", "High"
        CRITICAL = "CRITICAL", "Critical"

    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        INVESTIGATING = "INVESTIGATING", "Investigating"
        RESOLVED = "RESOLVED", "Resolved"
        CLOSED = "CLOSED", "Closed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    incident_no = models.CharField(max_length=20, unique=True)
    type = models.CharField(max_length=20, choices=IncidentType.choices)
    vehicle_id = models.UUIDField(null=True, blank=True)
    driver_id = models.UUIDField(null=True, blank=True)
    route_id = models.UUIDField(null=True, blank=True)
    location = models.TextField()
    description = models.TextField()
    reported_by_id = models.UUIDField()
    reported_at = models.DateTimeField(auto_now_add=True)
    severity = models.CharField(max_length=10, choices=Severity.choices)
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.OPEN)
    resolved_at = models.DateTimeField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-reported_at"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["severity"]),
            models.Index(fields=["vehicle_id"]),
        ]

    def __str__(self):
        return f"{self.incident_no} - {self.type}"


class IncidentMedia(models.Model):
    class MediaType(models.TextChoices):
        IMAGE = "IMAGE", "Image"
        VIDEO = "VIDEO", "Video"
        DOCUMENT = "DOCUMENT", "Document"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    incident = models.ForeignKey(Incident, on_delete=models.CASCADE, related_name="media")
    file = models.FileField(upload_to="incident_media/")
    media_type = models.CharField(max_length=10, choices=MediaType.choices)
    uploaded_at = models.DateTimeField(auto_now_add=True)


class InsuranceClaim(models.Model):
    class Status(models.TextChoices):
        FILED = "FILED", "Filed"
        UNDER_REVIEW = "UNDER_REVIEW", "Under Review"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        SETTLED = "SETTLED", "Settled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    incident = models.ForeignKey(Incident, on_delete=models.CASCADE, related_name="insurance_claims")
    claim_no = models.CharField(max_length=50)
    insurer = models.CharField(max_length=255)
    claim_amount = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.FILED)
    filed_at = models.DateTimeField(auto_now_add=True)
    settled_at = models.DateTimeField(null=True, blank=True)
    settlement_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ["-filed_at"]
