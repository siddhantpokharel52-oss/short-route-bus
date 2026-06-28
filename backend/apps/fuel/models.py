import uuid
from django.db import models


class FuelIssuance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle_id = models.UUIDField()
    driver_id = models.UUIDField()
    date = models.DateField()
    fuel_type = models.CharField(max_length=20)
    quantity_liters = models.DecimalField(max_digits=8, decimal_places=2)
    odometer_km = models.DecimalField(max_digits=10, decimal_places=2)
    issued_by_id = models.UUIDField(null=True, blank=True)
    station = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]
        indexes = [models.Index(fields=["vehicle_id", "date"])]


class FuelCost(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    fuel_issuance = models.OneToOneField(FuelIssuance, on_delete=models.CASCADE, related_name="cost")
    rate_per_liter = models.DecimalField(max_digits=8, decimal_places=2)
    total_cost = models.DecimalField(max_digits=12, decimal_places=2)


class MileageRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle_id = models.UUIDField()
    period_start = models.DateField()
    period_end = models.DateField()
    km_run = models.DecimalField(max_digits=10, decimal_places=2)
    fuel_consumed = models.DecimalField(max_digits=8, decimal_places=2)
    mileage_kmpl = models.DecimalField(max_digits=6, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["vehicle_id", "period_start"])]


class FuelAlert(models.Model):
    class AlertType(models.TextChoices):
        LOW_MILEAGE = "LOW_MILEAGE", "Low Mileage"
        SUSPECTED_THEFT = "SUSPECTED_THEFT", "Suspected Theft"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle_id = models.UUIDField()
    alert_type = models.CharField(max_length=20, choices=AlertType.choices)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved = models.BooleanField(default=False)
    description = models.TextField(blank=True)
