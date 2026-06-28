import uuid
from django.db import models
from django.utils import timezone


class Vehicle(models.Model):
    class FuelType(models.TextChoices):
        DIESEL = "DIESEL", "Diesel"
        PETROL = "PETROL", "Petrol"
        CNG = "CNG", "CNG"
        ELECTRIC = "ELECTRIC", "Electric"
        HYBRID = "HYBRID", "Hybrid"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        AVAILABLE = "AVAILABLE", "Available"
        ASSIGNED = "ASSIGNED", "Assigned"
        IN_SERVICE = "IN_SERVICE", "In Service"
        IN_MAINTENANCE = "IN_MAINTENANCE", "In Maintenance"
        INACTIVE = "INACTIVE", "Inactive"
        RETIRED = "RETIRED", "Retired"
        BREAKDOWN = "BREAKDOWN", "Breakdown"

    class VehicleType(models.TextChoices):
        BUS = "BUS", "Bus"
        MICROBUS = "MICROBUS", "Microbus"
        MINIBUS = "MINIBUS", "Minibus"
        TEMPO = "TEMPO", "Tempo"
        ELECTRIC_BUS = "ELECTRIC_BUS", "Electric Bus"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    registration_no = models.CharField(max_length=20, unique=True)
    bus_number = models.CharField(max_length=20, blank=True, help_text="Display bus number (e.g. Bus 1, KV-001)")

    # ── Basic Info ───────────────────────────────────────────────
    vehicle_type = models.CharField(max_length=15, choices=VehicleType.choices, default=VehicleType.BUS)
    make = models.CharField(max_length=100)
    model = models.CharField(max_length=100)
    year = models.PositiveSmallIntegerField()
    color = models.CharField(max_length=50, blank=True)

    # ── Vehicle Identification ───────────────────────────────────
    chassis_no = models.CharField(max_length=50, unique=True)
    engine_no = models.CharField(max_length=50, blank=True)

    # ── Capacity & Specs ─────────────────────────────────────────
    capacity_seated = models.PositiveSmallIntegerField()
    capacity_standing = models.PositiveSmallIntegerField(default=0)
    fuel_type = models.CharField(max_length=10, choices=FuelType.choices, default=FuelType.DIESEL)
    engine_capacity_cc = models.PositiveIntegerField(null=True, blank=True)

    # ── Operational ──────────────────────────────────────────────
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    assigned_route_id = models.UUIDField(null=True, blank=True)
    current_driver_id = models.UUIDField(null=True, blank=True)
    current_conductor_id = models.UUIDField(null=True, blank=True)
    gps_device_id = models.CharField(max_length=50, blank=True)
    odometer_km = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    # ── System ───────────────────────────────────────────────────
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by_id = models.UUIDField(null=True, blank=True)

    class Meta:
        ordering = ["registration_no"]
        indexes = [
            models.Index(fields=["registration_no"]),
            models.Index(fields=["status"]),
            models.Index(fields=["is_deleted"]),
        ]

    def __str__(self):
        return f"{self.registration_no} - {self.make} {self.model}"

    @property
    def is_available_for_trip(self):
        if self.status not in [self.Status.ACTIVE]:
            return False
        # Check insurance validity
        valid_insurance = self.documents.filter(
            doc_type=VehicleDocument.DocType.INSURANCE,
            expiry_date__gte=timezone.now().date(),
        ).exists()
        if not valid_insurance:
            return False
        overdue_maintenance = self.maintenance_schedules.filter(
            status="OVERDUE"
        ).exists()
        return not overdue_maintenance


class VehicleDocument(models.Model):
    class DocType(models.TextChoices):
        BLUEBOOK = "BLUEBOOK", "Bluebook (Nagarik Praman Patra)"
        INSURANCE = "INSURANCE", "Insurance"
        POLLUTION = "POLLUTION", "Pollution Certificate"
        ROUTE_PERMIT = "ROUTE_PERMIT", "Route Permit"
        TAX = "TAX", "Tax Receipt"
        FITNESS = "FITNESS", "Fitness / Inspection Certificate"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE, related_name="documents")
    doc_type = models.CharField(max_length=15, choices=DocType.choices)
    doc_no = models.CharField(max_length=100)
    issued_date = models.DateField()
    expiry_date = models.DateField()
    file = models.FileField(upload_to="vehicle_docs/", null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["vehicle", "doc_type"]),
            models.Index(fields=["expiry_date"]),
        ]

    def __str__(self):
        return f"{self.vehicle.registration_no} - {self.doc_type}"

    @property
    def days_to_expiry(self):
        delta = self.expiry_date - timezone.now().date()
        return delta.days


class VehicleInsurance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE, related_name="insurances")
    provider = models.CharField(max_length=255)
    policy_no = models.CharField(max_length=100)
    coverage_amount = models.DecimalField(max_digits=12, decimal_places=2)
    premium = models.DecimalField(max_digits=10, decimal_places=2)
    start_date = models.DateField()
    end_date = models.DateField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-start_date"]
        indexes = [models.Index(fields=["vehicle", "end_date"])]


class VehicleGPS(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        INACTIVE = "INACTIVE", "Inactive"
        FAULT = "FAULT", "Fault"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle = models.OneToOneField(Vehicle, on_delete=models.CASCADE, related_name="gps_device")
    device_id = models.CharField(max_length=50, unique=True)
    imei = models.CharField(max_length=20, unique=True)
    provider = models.CharField(max_length=100)
    sim_no = models.CharField(max_length=20, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    installed_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"GPS {self.device_id} - {self.vehicle.registration_no}"
