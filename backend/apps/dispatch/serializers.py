from rest_framework import serializers
from .models import DailyAllocation, DispatchLog


class DailyAllocationSerializer(serializers.ModelSerializer):
    route_name = serializers.SerializerMethodField()
    vehicle_registration = serializers.SerializerMethodField()
    driver_name = serializers.SerializerMethodField()

    class Meta:
        model = DailyAllocation
        fields = [
            "id", "date", "route_id", "route_name",
            "vehicle_id", "vehicle_registration",
            "driver_id", "driver_name", "conductor_id",
            "shift_start", "shift_end", "status",
            "notes", "created_at", "created_by_id",
        ]
        read_only_fields = ["id", "created_at", "route_name", "vehicle_registration", "driver_name"]

    def get_route_name(self, obj):
        try:
            from django_tenants.utils import schema_context
            with schema_context("public"):
                from backend.apps.platform.models import Route
                route = Route.objects.get(pk=obj.route_id)
                return route.name_en
        except Exception:
            return str(obj.route_id)

    def get_vehicle_registration(self, obj):
        try:
            from backend.apps.fleet.models import Vehicle
            v = Vehicle.objects.get(pk=obj.vehicle_id)
            return v.registration_no
        except Exception:
            return str(obj.vehicle_id)

    def get_driver_name(self, obj):
        if not obj.driver_id:
            return None
        try:
            from backend.apps.staff.models import Driver
            d = Driver.objects.get(pk=obj.driver_id)
            return d.full_name
        except Exception:
            return str(obj.driver_id)


class DispatchLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = DispatchLog
        fields = [
            "id", "allocation", "action_type", "vehicle_id", "route_id",
            "trip_id", "performed_by_id", "notes", "timestamp", "metadata",
        ]
        read_only_fields = ["id", "timestamp"]
