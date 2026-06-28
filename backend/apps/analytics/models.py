import uuid
from django.db import models


class TenantAnalyticsSnapshot(models.Model):
    """Pre-computed tenant-level analytics snapshots (refreshed nightly)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant_schema = models.CharField(max_length=63)
    snapshot_date = models.DateField()
    total_vehicles = models.PositiveIntegerField(default=0)
    active_vehicles = models.PositiveIntegerField(default=0)
    total_drivers = models.PositiveIntegerField(default=0)
    trips_today = models.PositiveIntegerField(default=0)
    daily_revenue = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    on_time_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    fleet_utilization = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    open_complaints = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [["tenant_schema", "snapshot_date"]]
        ordering = ["-snapshot_date"]
        indexes = [models.Index(fields=["tenant_schema", "snapshot_date"])]


class CityAnalyticsSnapshot(models.Model):
    """Platform-level city analytics (for government/transport authority)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    snapshot_date = models.DateField(unique=True)
    total_daily_passengers = models.PositiveIntegerField(default=0)
    total_active_routes = models.PositiveIntegerField(default=0)
    total_active_buses = models.PositiveIntegerField(default=0)
    total_revenue = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    total_complaints = models.PositiveIntegerField(default=0)
    fleet_availability_ratio = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-snapshot_date"]
