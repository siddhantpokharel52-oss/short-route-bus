import uuid
from django.db import models


class Document(models.Model):
    class EntityType(models.TextChoices):
        DRIVER = "DRIVER", "Driver"
        VEHICLE = "VEHICLE", "Vehicle"
        COMPANY = "COMPANY", "Company"

    class DocCategory(models.TextChoices):
        LICENSE = "LICENSE", "License"
        CITIZENSHIP = "CITIZENSHIP", "Citizenship"
        TRAINING = "TRAINING", "Training Certificate"
        MEDICAL = "MEDICAL", "Medical Clearance"
        BLUEBOOK = "BLUEBOOK", "Bluebook"
        INSURANCE = "INSURANCE", "Insurance"
        ROUTE_PERMIT = "ROUTE_PERMIT", "Route Permit"
        POLLUTION = "POLLUTION", "Pollution Certificate"
        TAX = "TAX", "Tax Receipt"
        REGISTRATION = "REGISTRATION", "Registration"
        PAN = "PAN", "PAN Certificate"
        CONTRACT = "CONTRACT", "Government Contract"
        OTHER = "OTHER", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    entity_type = models.CharField(max_length=10, choices=EntityType.choices)
    entity_id = models.UUIDField()
    doc_category = models.CharField(max_length=15, choices=DocCategory.choices)
    doc_type = models.CharField(max_length=100)
    file_path = models.FileField(upload_to="documents/")
    file_size = models.PositiveIntegerField(default=0)
    doc_no = models.CharField(max_length=100, blank=True)
    issued_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    uploaded_by_id = models.UUIDField()
    uploaded_at = models.DateTimeField(auto_now_add=True)
    verified = models.BooleanField(default=False)
    verified_by_id = models.UUIDField(null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)

    class Meta:
        ordering = ["-uploaded_at"]
        indexes = [
            models.Index(fields=["entity_type", "entity_id"]),
            models.Index(fields=["expiry_date"]),
            models.Index(fields=["verified"]),
        ]

    def __str__(self):
        return f"{self.entity_type}/{self.entity_id} - {self.doc_type}"


class DocumentAlert(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="alerts")
    days_to_expiry = models.IntegerField()
    alert_type = models.CharField(max_length=50)
    sent_at = models.DateTimeField(auto_now_add=True)
    resolved = models.BooleanField(default=False)
