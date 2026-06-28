from rest_framework import serializers
from .models import InventoryItem, StockMovement, StockAlert


class InventoryItemSerializer(serializers.ModelSerializer):
    is_low_stock = serializers.ReadOnlyField()

    class Meta:
        model = InventoryItem
        fields = ["id", "item_code", "name", "category", "unit", "reorder_level", "current_stock", "is_low_stock", "created_at"]
        read_only_fields = ["id", "current_stock", "created_at"]


class StockMovementSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockMovement
        fields = ["id", "item", "movement_type", "quantity", "reference", "date", "remarks", "created_at"]
        read_only_fields = ["id", "created_at"]


class StockAlertSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source="item.name", read_only=True)

    class Meta:
        model = StockAlert
        fields = ["id", "item", "item_name", "alert_type", "triggered_at", "resolved"]
        read_only_fields = ["id", "triggered_at"]
