import uuid
from django.db import models
from django.contrib.postgres.fields import ArrayField


class Stop(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        INACTIVE = "INACTIVE", "Inactive"
        UNDER_MAINTENANCE = "UNDER_MAINTENANCE", "Under Maintenance"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    stop_code = models.CharField(max_length=20, unique=True)
    name_en = models.CharField(max_length=255)
    name_ne = models.CharField(max_length=255)
    latitude = models.DecimalField(max_digits=10, decimal_places=7)
    longitude = models.DecimalField(max_digits=10, decimal_places=7)
    zone = models.CharField(max_length=50, blank=True)
    capacity = models.PositiveIntegerField(default=50)
    has_shelter = models.BooleanField(default=False)
    has_digital_signage = models.BooleanField(default=False)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        "users.User", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="created_stops"
    )

    class Meta:
        ordering = ["stop_code"]
        indexes = [
            models.Index(fields=["stop_code"]),
            models.Index(fields=["status"]),
            models.Index(fields=["is_deleted"]),
        ]

    def __str__(self):
        return f"{self.stop_code} - {self.name_en}"


class StopAmenity(models.Model):
    class AmenityType(models.TextChoices):
        TOILET = "TOILET", "Toilet"
        DRINKING_WATER = "DRINKING_WATER", "Drinking Water"
        SEATING = "SEATING", "Seating"
        RAMP = "RAMP", "Wheelchair Ramp"
        CCTV = "CCTV", "CCTV"
        LIGHTING = "LIGHTING", "Lighting"

    class AmenityStatus(models.TextChoices):
        FUNCTIONAL = "FUNCTIONAL", "Functional"
        BROKEN = "BROKEN", "Broken"
        UNDER_REPAIR = "UNDER_REPAIR", "Under Repair"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    stop = models.ForeignKey(Stop, on_delete=models.CASCADE, related_name="amenities")
    amenity_type = models.CharField(max_length=30, choices=AmenityType.choices)
    status = models.CharField(max_length=20, choices=AmenityStatus.choices, default=AmenityStatus.FUNCTIONAL)
    last_maintained = models.DateField(null=True, blank=True)

    class Meta:
        unique_together = [["stop", "amenity_type"]]


class StopAnalytics(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    stop = models.ForeignKey(Stop, on_delete=models.CASCADE, related_name="analytics")
    date = models.DateField()
    boarding_count = models.PositiveIntegerField(default=0)
    alighting_count = models.PositiveIntegerField(default=0)
    peak_hour = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        unique_together = [["stop", "date"]]
        indexes = [models.Index(fields=["stop", "date"])]


class Route(models.Model):
    class RouteType(models.TextChoices):
        EXCLUSIVE = "EXCLUSIVE", "Exclusive"
        SHARED = "SHARED", "Shared"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING_APPROVAL = "PENDING_APPROVAL", "Pending Approval"
        APPROVED = "APPROVED", "Approved"
        INACTIVE = "INACTIVE", "Inactive"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    route_code = models.CharField(max_length=20, unique=True)
    name_en = models.CharField(max_length=255)
    name_ne = models.CharField(max_length=255)
    start_stop = models.ForeignKey(Stop, null=True, blank=True, on_delete=models.SET_NULL, related_name="routes_as_start")
    end_stop = models.ForeignKey(Stop, null=True, blank=True, on_delete=models.SET_NULL, related_name="routes_as_end")
    distance_km = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    route_type = models.CharField(max_length=20, choices=RouteType.choices, default=RouteType.EXCLUSIVE)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    geojson_path = models.TextField(blank=True)
    approved_by = models.ForeignKey(
        "users.User", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="approved_routes"
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        "users.User", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="created_routes"
    )

    class Meta:
        ordering = ["route_code"]
        indexes = [
            models.Index(fields=["route_code"]),
            models.Index(fields=["status"]),
            models.Index(fields=["route_type"]),
        ]

    def __str__(self):
        return f"{self.route_code} - {self.name_en}"


class RouteStop(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    route = models.ForeignKey(Route, on_delete=models.CASCADE, related_name="route_stops")
    stop = models.ForeignKey(Stop, on_delete=models.PROTECT, related_name="route_stops")
    sequence_no = models.PositiveSmallIntegerField()
    estimated_time_from_start = models.PositiveIntegerField(help_text="Minutes from route start")

    class Meta:
        unique_together = [["route", "sequence_no"], ["route", "stop"]]
        ordering = ["route", "sequence_no"]


class RouteAssignment(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        PENDING = "PENDING", "Pending"
        EXPIRED = "EXPIRED", "Expired"
        REVOKED = "REVOKED", "Revoked"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    route = models.ForeignKey(Route, on_delete=models.CASCADE, related_name="assignments")
    tenant = models.ForeignKey("tenants.Tenant", on_delete=models.CASCADE, related_name="route_assignments")
    share_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=100.00)
    approved_by = models.ForeignKey(
        "users.User", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="approved_assignments"
    )
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["route", "status"]),
            models.Index(fields=["tenant", "status"]),
        ]

    def __str__(self):
        return f"{self.route.route_code} → {self.tenant.name}"


class RouteVersion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    route = models.ForeignKey(Route, on_delete=models.CASCADE, related_name="versions")
    version_no = models.PositiveSmallIntegerField()
    change_summary = models.TextField()
    changed_by = models.ForeignKey(
        "users.User", null=True, blank=True, on_delete=models.SET_NULL
    )
    changed_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)
    snapshot = models.JSONField(default=dict)

    class Meta:
        unique_together = [["route", "version_no"]]
        ordering = ["-version_no"]


class RouteDiversion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    route = models.ForeignKey(Route, on_delete=models.CASCADE, related_name="diversions")
    start_stop = models.ForeignKey(Stop, on_delete=models.PROTECT, related_name="diversions_start")
    end_stop = models.ForeignKey(Stop, on_delete=models.PROTECT, related_name="diversions_end")
    reason = models.TextField()
    start_time = models.DateTimeField()
    end_time = models.DateTimeField(null=True, blank=True)
    alternate_path = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        "users.User", null=True, blank=True, on_delete=models.SET_NULL
    )

    class Meta:
        indexes = [
            models.Index(fields=["route", "start_time"]),
        ]


class TicketType(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=20, unique=True)
    name_en = models.CharField(max_length=100)
    name_ne = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    validity_hours = models.PositiveSmallIntegerField(default=4)
    is_transferable = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.code} - {self.name_en}"


class FareMatrix(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    route = models.ForeignKey(Route, null=True, blank=True, on_delete=models.CASCADE, related_name="fares")
    zone_from = models.CharField(max_length=50, blank=True)
    zone_to = models.CharField(max_length=50, blank=True)
    ticket_type = models.ForeignKey(TicketType, on_delete=models.PROTECT, related_name="fares")
    base_fare = models.DecimalField(max_digits=8, decimal_places=2)
    peak_fare = models.DecimalField(max_digits=8, decimal_places=2)
    student_fare = models.DecimalField(max_digits=8, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        "users.User", null=True, blank=True, on_delete=models.SET_NULL
    )

    class Meta:
        indexes = [
            models.Index(fields=["route", "ticket_type"]),
        ]


class SmartCard(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        BLOCKED = "BLOCKED", "Blocked"
        LOST = "LOST", "Lost"
        EXPIRED = "EXPIRED", "Expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card_no = models.CharField(max_length=20, unique=True)
    passenger = models.ForeignKey(
        "users.User", on_delete=models.PROTECT, related_name="smart_cards"
    )
    balance = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    issued_at = models.DateTimeField(auto_now_add=True)
    issued_by_tenant = models.ForeignKey(
        "tenants.Tenant", null=True, blank=True, on_delete=models.SET_NULL
    )
    is_deleted = models.BooleanField(default=False)

    class Meta:
        indexes = [
            models.Index(fields=["card_no"]),
            models.Index(fields=["passenger", "status"]),
        ]

    def __str__(self):
        return f"Card {self.card_no} - {self.passenger.email}"


class CardTransaction(models.Model):
    class TransactionType(models.TextChoices):
        DEBIT = "DEBIT", "Debit"
        CREDIT = "CREDIT", "Credit"
        RECHARGE = "RECHARGE", "Recharge"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card = models.ForeignKey(SmartCard, on_delete=models.PROTECT, related_name="transactions")
    trip_id = models.UUIDField(null=True, blank=True)
    tenant = models.ForeignKey("tenants.Tenant", null=True, blank=True, on_delete=models.SET_NULL)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    transaction_type = models.CharField(max_length=10, choices=TransactionType.choices)
    balance_after = models.DecimalField(max_digits=10, decimal_places=2)
    timestamp = models.DateTimeField(auto_now_add=True)
    reference = models.CharField(max_length=100, blank=True)

    class Meta:
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["card", "timestamp"]),
            models.Index(fields=["transaction_type"]),
        ]


class CardRecharge(models.Model):
    class RechargeMethod(models.TextChoices):
        CASH = "CASH", "Cash"
        ESEWA = "ESEWA", "eSewa"
        KHALTI = "KHALTI", "Khalti"
        FONEPAY = "FONEPAY", "Fonepay"
        CONNECT_IPS = "CONNECT_IPS", "ConnectIPS"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card = models.ForeignKey(SmartCard, on_delete=models.PROTECT, related_name="recharges")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    recharge_method = models.CharField(max_length=15, choices=RechargeMethod.choices)
    reference_no = models.CharField(max_length=100, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=20, default="COMPLETED")

    class Meta:
        ordering = ["-timestamp"]
        indexes = [models.Index(fields=["card", "timestamp"])]


class FarePolicy(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING = "PENDING", "Pending Approval"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    effective_date = models.DateField()
    approved_by = models.ForeignKey(
        "users.User", null=True, blank=True, on_delete=models.SET_NULL
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class ZoneFare(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    policy = models.ForeignKey(FarePolicy, on_delete=models.CASCADE, related_name="zone_fares")
    zone_from = models.CharField(max_length=50)
    zone_to = models.CharField(max_length=50)
    base_fare = models.DecimalField(max_digits=8, decimal_places=2)


class DistanceFare(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    policy = models.ForeignKey(FarePolicy, on_delete=models.CASCADE, related_name="distance_fares")
    per_km_rate = models.DecimalField(max_digits=8, decimal_places=2)
    minimum_fare = models.DecimalField(max_digits=8, decimal_places=2)


class PeakFareSurcharge(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    policy = models.ForeignKey(FarePolicy, on_delete=models.CASCADE, related_name="peak_surcharges")
    peak_start = models.TimeField()
    peak_end = models.TimeField()
    surcharge_percentage = models.DecimalField(max_digits=5, decimal_places=2)


class DiscountRule(models.Model):
    class PassengerType(models.TextChoices):
        STUDENT = "STUDENT", "Student"
        SENIOR = "SENIOR", "Senior Citizen"
        DISABILITY = "DISABILITY", "Disability"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    policy = models.ForeignKey(FarePolicy, on_delete=models.CASCADE, related_name="discounts")
    passenger_type = models.CharField(max_length=20, choices=PassengerType.choices)
    discount_percentage = models.DecimalField(max_digits=5, decimal_places=2)
