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
    booking = models.ForeignKey(
        "Booking", null=True, blank=True, on_delete=models.CASCADE, related_name="tickets"
    )
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


class Booking(models.Model):
    """Ties several tickets together under one purchase -- a family buying tickets
    together, per the payment design doc's CB2. Grouping only: each ticket's own
    fare_paid stays client-supplied, same trust model a single ticket already has;
    no fare-lookup logic lives here (that's CB3's concern, not this one)."""
    class Status(models.TextChoices):
        VALID = "VALID", "Valid"
        CANCELLED = "CANCELLED", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    passenger_id = models.UUIDField(null=True, blank=True)
    route_id = models.UUIDField(null=True, blank=True)
    from_stop_id = models.UUIDField(null=True, blank=True)
    to_stop_id = models.UUIDField(null=True, blank=True)
    total_fare = models.DecimalField(max_digits=9, decimal_places=2)
    payment_method = models.CharField(max_length=15, choices=Ticket.PaymentMethod.choices, default=Ticket.PaymentMethod.CASH)
    booked_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.VALID)
    is_deleted = models.BooleanField(default=False)

    class Meta:
        ordering = ["-booked_at"]

    def __str__(self):
        return str(self.id)


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


class NamastePayCheckout(models.Model):
    """A NamastePay hosted-checkout attempt -- CB9. NamastePay's real API has no
    signed server-to-server webhook (confirmed against their spec): only a browser
    redirect to a fixed return_url carrying untrusted query params, which their own
    docs say to always re-verify via GET /api/v2/enquire/{checkout_id}. This row is
    what that confirmation step checks against and, once genuinely confirmed,
    creates a Booking (same shape CB2 already built) from -- a Ticket must never be
    created on an unconfirmed payment (accounting.signals fires revenue recognition
    unconditionally the instant one exists)."""
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        CONFIRMED = "CONFIRMED", "Confirmed"
        FAILED = "FAILED", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    checkout_id = models.CharField(max_length=100, unique=True)
    reference_id = models.CharField(max_length=100, unique=True)
    passenger_id = models.UUIDField(null=True, blank=True)
    route_id = models.UUIDField(null=True, blank=True)
    from_stop_id = models.UUIDField(null=True, blank=True)
    to_stop_id = models.UUIDField(null=True, blank=True)
    passengers = models.JSONField()
    amount = models.DecimalField(max_digits=9, decimal_places=2)
    return_to = models.URLField(max_length=500)
    booking = models.ForeignKey(Booking, null=True, blank=True, on_delete=models.SET_NULL)
    status = models.CharField(max_length=9, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.checkout_id} ({self.status})"


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
