import uuid
from django.db import models


class InventoryItem(models.Model):
    class Category(models.TextChoices):
        SPARE_PART = "SPARE_PART", "Spare Part"
        TIRE = "TIRE", "Tire"
        BATTERY = "BATTERY", "Battery"
        LUBRICANT = "LUBRICANT", "Lubricant"
        CONSUMABLE = "CONSUMABLE", "Consumable"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item_code = models.CharField(max_length=30, unique=True)
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=15, choices=Category.choices)
    unit = models.CharField(max_length=20)
    reorder_level = models.PositiveIntegerField(default=5)
    current_stock = models.PositiveIntegerField(default=0)
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["item_code"]
        indexes = [models.Index(fields=["item_code"]), models.Index(fields=["category"])]

    def __str__(self):
        return f"{self.item_code} - {self.name}"

    @property
    def is_low_stock(self):
        return self.current_stock <= self.reorder_level


class StockMovement(models.Model):
    class MovementType(models.TextChoices):
        IN = "IN", "Stock In"
        OUT = "OUT", "Stock Out"
        ADJUSTMENT = "ADJUSTMENT", "Adjustment"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(InventoryItem, on_delete=models.CASCADE, related_name="movements")
    movement_type = models.CharField(max_length=15, choices=MovementType.choices)
    quantity = models.IntegerField()
    reference = models.CharField(max_length=100, blank=True)
    date = models.DateField()
    remarks = models.TextField(blank=True)
    created_by_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]
        indexes = [models.Index(fields=["item", "date"])]

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        item = self.item
        if self.movement_type == self.MovementType.IN:
            item.current_stock += self.quantity
        elif self.movement_type == self.MovementType.OUT:
            item.current_stock -= self.quantity
        else:
            item.current_stock = self.quantity
        item.save(update_fields=["current_stock", "updated_at"])
        if item.is_low_stock:
            StockAlert.objects.get_or_create(
                item=item,
                alert_type=StockAlert.AlertType.LOW_STOCK if item.current_stock > 0 else StockAlert.AlertType.OUT_OF_STOCK,
                resolved=False,
            )


class StockAlert(models.Model):
    class AlertType(models.TextChoices):
        LOW_STOCK = "LOW_STOCK", "Low Stock"
        OUT_OF_STOCK = "OUT_OF_STOCK", "Out of Stock"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(InventoryItem, on_delete=models.CASCADE, related_name="alerts")
    alert_type = models.CharField(max_length=15, choices=AlertType.choices)
    triggered_at = models.DateTimeField(auto_now_add=True)
    resolved = models.BooleanField(default=False)
