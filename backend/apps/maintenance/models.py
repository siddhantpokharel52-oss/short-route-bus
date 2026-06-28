import uuid
from django.db import models


class Workshop(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    address = models.TextField()
    contact = models.CharField(max_length=50)
    specialization = models.CharField(max_length=255, blank=True)
    rating = models.DecimalField(max_digits=3, decimal_places=1, default=5.0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class MaintenanceSchedule(models.Model):
    class ServiceType(models.TextChoices):
        PERIODIC = "PERIODIC", "Periodic Service"
        INSPECTION = "INSPECTION", "Inspection"
        REPAIR = "REPAIR", "Repair"
        EMERGENCY = "EMERGENCY", "Emergency"

    class Status(models.TextChoices):
        UPCOMING = "UPCOMING", "Upcoming"
        DUE = "DUE", "Due"
        OVERDUE = "OVERDUE", "Overdue"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle_id = models.UUIDField()
    service_type = models.CharField(max_length=15, choices=ServiceType.choices)
    due_date = models.DateField()
    due_km = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.UPCOMING)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["due_date"]
        indexes = [
            models.Index(fields=["vehicle_id", "status"]),
            models.Index(fields=["due_date"]),
        ]

    def __str__(self):
        return f"Vehicle {self.vehicle_id} - {self.service_type} ({self.due_date})"


class ServiceRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle_id = models.UUIDField()
    maintenance_schedule = models.ForeignKey(
        MaintenanceSchedule, null=True, blank=True, on_delete=models.SET_NULL, related_name="service_records"
    )
    workshop = models.ForeignKey(Workshop, null=True, blank=True, on_delete=models.SET_NULL)
    mechanic = models.CharField(max_length=255, blank=True)
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    total_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    parts_used = models.JSONField(default=list)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-start_date"]
        indexes = [models.Index(fields=["vehicle_id", "start_date"])]

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.end_date and self.maintenance_schedule:
            self.maintenance_schedule.status = MaintenanceSchedule.Status.COMPLETED
            self.maintenance_schedule.save(update_fields=["status"])


class MaintenanceCost(models.Model):
    class CostType(models.TextChoices):
        PARTS = "PARTS", "Parts"
        LABOR = "LABOR", "Labor"
        OTHER = "OTHER", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    service_record = models.ForeignKey(ServiceRecord, on_delete=models.CASCADE, related_name="costs")
    cost_type = models.CharField(max_length=10, choices=CostType.choices)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    supplier = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
