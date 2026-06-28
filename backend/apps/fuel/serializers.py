from rest_framework import serializers
from .models import FuelIssuance, FuelCost, MileageRecord, FuelAlert


class FuelCostSerializer(serializers.ModelSerializer):
    class Meta:
        model = FuelCost
        fields = ["rate_per_liter", "total_cost"]


class FuelIssuanceSerializer(serializers.ModelSerializer):
    cost = FuelCostSerializer(read_only=True)

    class Meta:
        model = FuelIssuance
        fields = [
            "id", "vehicle_id", "driver_id", "date", "fuel_type",
            "quantity_liters", "odometer_km", "station", "cost", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class MileageRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = MileageRecord
        fields = ["id", "vehicle_id", "period_start", "period_end", "km_run", "fuel_consumed", "mileage_kmpl"]
        read_only_fields = ["id"]


class FuelAlertSerializer(serializers.ModelSerializer):
    class Meta:
        model = FuelAlert
        fields = ["id", "vehicle_id", "alert_type", "created_at", "resolved", "description"]
        read_only_fields = ["id", "created_at"]
