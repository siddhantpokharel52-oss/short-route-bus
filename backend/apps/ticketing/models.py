import uuid
from django.db import models
from encrypted_model_fields.fields import EncryptedCharField


class Ticket(models.Model):
    class PaymentMethod(models.TextChoices):
        CASH = "CASH", "Cash"
        SMART_CARD = "SMART_CARD", "Smart Card"
        ESEWA = "ESEWA", "eSewa"
        KHALTI = "KHALTI", "Khalti"
        FONEPAY = "FONEPAY", "Fonepay"
        CONNECTIPS = "CONNECTIPS", "ConnectIPS"
        NAMASTEPAY = "NAMASTEPAY", "NamastePay"

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
    vehicle_id = models.UUIDField(null=True, blank=True)
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


class NamastePayConfig(models.Model):
    """A tenant's own NamastePay merchant credentials -- every tenant hits
    the same NamastePay API (shared base URLs, shared request/response
    shapes), but authenticates with their own API key, so this is a
    singleton-per-tenant row, same shape as staff.BusCompany. api_key is
    encrypted at rest (django-encrypted-model-fields, already an installed
    dependency) since it's effectively a password that can move the
    tenant's own revenue.

    Was originally client_id/client_secret (a guess at the auth scheme
    before real docs existed) -- confirmed against NamastePay's actual
    published OpenAPI v2 spec that auth is a single API key sent as the
    X-API-KEY header, generated via their merchant portal. Renamed to
    match; no real credentials were ever saved under the old fields."""
    class Environment(models.TextChoices):
        TEST = "TEST", "Test"
        LIVE = "LIVE", "Live"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    api_key = EncryptedCharField(max_length=255, blank=True)
    environment = models.CharField(max_length=4, choices=Environment.choices, default=Environment.TEST)
    is_active = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"NamastePay config ({self.environment})"


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
