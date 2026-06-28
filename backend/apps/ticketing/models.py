import uuid
from django.db import models


class Ticket(models.Model):
    class PaymentMethod(models.TextChoices):
        CASH = "CASH", "Cash"
        SMART_CARD = "SMART_CARD", "Smart Card"
        ESEWA = "ESEWA", "eSewa"
        KHALTI = "KHALTI", "Khalti"
        FONEPAY = "FONEPAY", "Fonepay"
        CONNECTIPS = "CONNECTIPS", "ConnectIPS"

    class Status(models.TextChoices):
        VALID = "VALID", "Valid"
        USED = "USED", "Used"
        EXPIRED = "EXPIRED", "Expired"
        CANCELLED = "CANCELLED", "Cancelled"

    class IssuedBy(models.TextChoices):
        POS = "POS", "POS Machine"
        MOBILE = "MOBILE", "Mobile App"
        CONDUCTOR = "CONDUCTOR", "Conductor"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ticket_uid = models.CharField(max_length=30, unique=True)
    ticket_type_id = models.UUIDField(null=True, blank=True)
    trip_id = models.UUIDField(null=True, blank=True)
    passenger_id = models.UUIDField(null=True, blank=True)
    passenger_name = models.CharField(max_length=255, blank=True)
    conductor_id = models.UUIDField(null=True, blank=True)
    issued_at = models.DateTimeField(auto_now_add=True)
    issued_by = models.CharField(max_length=10, choices=IssuedBy.choices, default=IssuedBy.POS)
    valid_until = models.DateTimeField()
    fare_paid = models.DecimalField(max_digits=8, decimal_places=2)
    payment_method = models.CharField(max_length=15, choices=PaymentMethod.choices, default=PaymentMethod.CASH)
    qr_code = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.VALID)
    from_stop_id = models.UUIDField(null=True, blank=True)
    to_stop_id = models.UUIDField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)

    class Meta:
        ordering = ["-issued_at"]
        indexes = [
            models.Index(fields=["ticket_uid"]),
            models.Index(fields=["trip_id"]),
            models.Index(fields=["status"]),
        ]

    def __str__(self):
        return self.ticket_uid


class DailyPass(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    passenger_id = models.UUIDField()
    date = models.DateField()
    fare_paid = models.DecimalField(max_digits=8, decimal_places=2)
    issued_at = models.DateTimeField(auto_now_add=True)
    usage_count = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = [["passenger_id", "date"]]


class MonthlyPass(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    passenger_id = models.UUIDField()
    month = models.DateField(help_text="First day of the month")
    fare_paid = models.DecimalField(max_digits=8, decimal_places=2)
    issued_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)
    route_id = models.UUIDField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["passenger_id", "month"])]


class StudentPass(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    passenger_id = models.UUIDField()
    school = models.CharField(max_length=255)
    grade = models.CharField(max_length=20)
    valid_from = models.DateField()
    valid_until = models.DateField()
    photo = models.ImageField(upload_to="student_pass_photos/", null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["passenger_id"])]
