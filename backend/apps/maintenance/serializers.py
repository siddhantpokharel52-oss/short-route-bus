from rest_framework import serializers
from .models import Workshop, MaintenanceSchedule, ServiceRecord, MaintenanceCost


class WorkshopSerializer(serializers.ModelSerializer):
    class Meta:
        model = Workshop
        fields = ["id", "name", "address", "contact", "specialization", "rating", "is_active"]
        read_only_fields = ["id"]


class MaintenanceScheduleSerializer(serializers.ModelSerializer):
    vehicle_registration = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = MaintenanceSchedule
        fields = [
            "id", "vehicle_id", "vehicle_registration",
            "service_type", "due_date", "due_km", "status", "notes", "created_at",
        ]
        read_only_fields = ["id", "created_at", "vehicle_registration"]

    def get_vehicle_registration(self, obj):
        try:
            from backend.apps.fleet.models import Vehicle
            vehicle = Vehicle.objects.get(id=obj.vehicle_id)
            return vehicle.registration_no
        except Exception:
            return str(obj.vehicle_id)


class MaintenanceCostSerializer(serializers.ModelSerializer):
    class Meta:
        model = MaintenanceCost
        fields = ["id", "cost_type", "amount", "supplier", "description"]
        read_only_fields = ["id"]


class ServiceRecordSerializer(serializers.ModelSerializer):
    costs = MaintenanceCostSerializer(many=True, read_only=True)

    class Meta:
        model = ServiceRecord
        fields = [
            "id", "vehicle_id", "maintenance_schedule", "workshop", "mechanic",
            "start_date", "end_date", "total_cost", "parts_used", "notes",
            "costs", "created_at",
        ]
        read_only_fields = ["id", "created_at"]
