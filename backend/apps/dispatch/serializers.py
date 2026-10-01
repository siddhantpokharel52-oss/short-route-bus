from rest_framework import serializers
from .models import DailyAllocation, DispatchLog


def resolve_route_name(route_id):
    if not route_id:
        return None
    try:
        from django_tenants.utils import schema_context
        with schema_context("public"):
            from backend.apps.platform.models import Route
            return Route.objects.get(pk=route_id).name_en
    except Exception:
        return str(route_id)


def resolve_vehicle_registration(vehicle_id):
    if not vehicle_id:
        return None
    try:
        from backend.apps.fleet.models import Vehicle
        return Vehicle.objects.get(pk=vehicle_id).registration_no
    except Exception:
        return str(vehicle_id)


def resolve_driver_name(driver_id):
    if not driver_id:
        return None
    try:
        from backend.apps.staff.models import Driver
        return Driver.objects.get(pk=driver_id).full_name_en
    except Exception:
        return str(driver_id)


def resolve_conductor_name(conductor_id):
    if not conductor_id:
        return None
    try:
        from backend.apps.staff.models import Conductor
        return Conductor.objects.get(pk=conductor_id).full_name_en
    except Exception:
        return str(conductor_id)


class DailyAllocationSerializer(serializers.ModelSerializer):
    route_name = serializers.SerializerMethodField()
    vehicle_registration = serializers.SerializerMethodField()
    driver_name = serializers.SerializerMethodField()
    conductor_name = serializers.SerializerMethodField()

    class Meta:
        model = DailyAllocation
        fields = [
            "id", "date", "route_id", "route_name",
            "vehicle_id", "vehicle_registration",
            "driver_id", "driver_name", "conductor_id", "conductor_name",
            "shift_start", "shift_end", "status", "is_recurring",
            "notes", "created_at", "created_by_id",
        ]
        read_only_fields = [
            "id", "created_at", "route_name", "vehicle_registration",
            "driver_name", "conductor_name",
        ]

    def get_route_name(self, obj):
        return resolve_route_name(obj.route_id)

    def get_vehicle_registration(self, obj):
        return resolve_vehicle_registration(obj.vehicle_id)

    def get_driver_name(self, obj):
        return resolve_driver_name(obj.driver_id)

    def get_conductor_name(self, obj):
        return resolve_conductor_name(obj.conductor_id)


class DispatchLogSerializer(serializers.ModelSerializer):
    route_name = serializers.SerializerMethodField()
    vehicle_registration = serializers.SerializerMethodField()
    # Driver/conductor aren't fields on DispatchLog itself -- they're only
    # reachable through the linked allocation (when one exists; a
    # GENERATE_SCHEDULE log has no single allocation to point at).
    driver_name = serializers.SerializerMethodField()
    conductor_name = serializers.SerializerMethodField()

    class Meta:
        model = DispatchLog
        fields = [
            "id", "allocation", "action_type", "vehicle_id", "vehicle_registration",
            "route_id", "route_name", "driver_name", "conductor_name",
            "trip_id", "performed_by_id", "notes", "timestamp", "metadata",
        ]
        read_only_fields = ["id", "timestamp"]

    def get_route_name(self, obj):
        return resolve_route_name(obj.route_id)

    def get_vehicle_registration(self, obj):
        return resolve_vehicle_registration(obj.vehicle_id)

    def get_driver_name(self, obj):
        if not obj.allocation_id:
            return None
        return resolve_driver_name(obj.allocation.driver_id)

    def get_conductor_name(self, obj):
        if not obj.allocation_id:
            return None
        return resolve_conductor_name(obj.allocation.conductor_id)
