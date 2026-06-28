import uuid
from django.db import models


class NotificationTemplate(models.Model):
    class Channel(models.TextChoices):
        SMS = "SMS", "SMS"
        EMAIL = "EMAIL", "Email"
        PUSH = "PUSH", "Push Notification"
        EMERGENCY = "EMERGENCY", "Emergency Alert"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    channel = models.CharField(max_length=15, choices=Channel.choices)
    subject_en = models.CharField(max_length=255, blank=True)
    subject_ne = models.CharField(max_length=255, blank=True)
    body_en = models.TextField()
    body_ne = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.code} ({self.channel})"


class NotificationLog(models.Model):
    class Status(models.TextChoices):
        SENT = "SENT", "Sent"
        FAILED = "FAILED", "Failed"
        PENDING = "PENDING", "Pending"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient = models.CharField(max_length=255)
    channel = models.CharField(max_length=15, choices=NotificationTemplate.Channel.choices)
    template = models.ForeignKey(
        NotificationTemplate, null=True, blank=True, on_delete=models.SET_NULL
    )
    sent_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    error_message = models.TextField(blank=True)
    payload = models.JSONField(default=dict)

    class Meta:
        ordering = ["-sent_at"]
        indexes = [
            models.Index(fields=["recipient", "sent_at"]),
            models.Index(fields=["status"]),
        ]


class NotificationSubscription(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_id = models.UUIDField()
    event_type = models.CharField(max_length=100)
    channel = models.CharField(max_length=15, choices=NotificationTemplate.Channel.choices)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = [["user_id", "event_type", "channel"]]
