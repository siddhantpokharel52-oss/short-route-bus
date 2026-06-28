from rest_framework import serializers
from .models import Timetable, TimetableSlot, Trip, DriverShift, AutoScheduleConfig


class TimetableSlotSerializer(serializers.ModelSerializer):
    class Meta:
        model = TimetableSlot
        fields = ["id", "departure_time", "arrival_time", "frequency_minutes"]
        read_only_fields = ["id"]


class TimetableSerializer(serializers.ModelSerializer):
    slots = TimetableSlotSerializer(many=True, read_only=True)

    class Meta:
        model = Timetable
        fields = ["id", "route_id", "day_type", "version", "effective_date", "is_active", "slots", "created_at"]
        read_only_fields = ["id", "created_at"]


class TripSerializer(serializers.ModelSerializer):
    # Enriched read-only fields (cross-schema lookups)
    route_name = serializers.SerializerMethodField()
    vehicle_registration = serializers.SerializerMethodField()
    vehicle_bus_number = serializers.SerializerMethodField()
    scheduled_departure = serializers.SerializerMethodField()
    scheduled_arrival = serializers.SerializerMethodField()

    class Meta:
        model = Trip
        fields = [
            "id", "trip_code",
            "timetable_slot",
            "vehicle_id", "vehicle_registration", "vehicle_bus_number",
            "driver_id", "conductor_id",
            "route_id", "route_name",
            "date",
            "scheduled_departure_time", "scheduled_arrival_time",
            "scheduled_departure", "scheduled_arrival",
            "status",
            "actual_departure", "actual_arrival",
            "cancellation_reason",
            "delay_reason", "delay_minutes",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "created_at", "updated_at",
            "route_name", "vehicle_registration", "vehicle_bus_number",
            "scheduled_departure", "scheduled_arrival",
        ]

    def get_route_name(self, obj):
        try:
            from django_tenants.utils import schema_context
            with schema_context("public"):
                from backend.apps.platform.models import Route
                route = Route.objects.get(pk=obj.route_id)
                return route.name_en
        except Exception:
            return None

    def get_vehicle_registration(self, obj):
        try:
            from backend.apps.fleet.models import Vehicle
            v = Vehicle.objects.get(pk=obj.vehicle_id)
            return v.registration_no
        except Exception:
            return None

    def get_vehicle_bus_number(self, obj):
        try:
            from backend.apps.fleet.models import Vehicle
            v = Vehicle.objects.get(pk=obj.vehicle_id)
            return v.bus_number or v.registration_no
        except Exception:
            return None

    def get_scheduled_departure(self, obj):
        if obj.scheduled_departure_time:
            return obj.scheduled_departure_time.strftime("%H:%M")
        if obj.timetable_slot:
            return obj.timetable_slot.departure_time.strftime("%H:%M")
        return None

    def get_scheduled_arrival(self, obj):
        if obj.scheduled_arrival_time:
            return obj.scheduled_arrival_time.strftime("%H:%M")
        if obj.timetable_slot:
            return obj.timetable_slot.arrival_time.strftime("%H:%M")
        return None

    def validate(self, data):
        # Check driver not on another active trip on same date
        driver_id = data.get("driver_id", getattr(self.instance, "driver_id", None))
        date = data.get("date", getattr(self.instance, "date", None))
        if driver_id and date:
            existing = Trip.objects.filter(
                driver_id=driver_id,
                date=date,
                status=Trip.Status.IN_PROGRESS,
                is_deleted=False,
            )
            if self.instance:
                existing = existing.exclude(pk=self.instance.pk)
            if existing.exists():
                raise serializers.ValidationError({
                    "driver_id": "Driver is already on an active trip."
                })
        return data


class DriverShiftSerializer(serializers.ModelSerializer):
    class Meta:
        model = DriverShift
        fields = ["id", "driver_id", "date", "shift_start", "shift_end", "created_at"]
        read_only_fields = ["id", "created_at"]


class AutoScheduleConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = AutoScheduleConfig
        fields = [
            "id", "route_id", "min_headway_minutes", "peak_buses",
            "off_peak_buses", "peak_start", "peak_end", "is_active",
        ]
        read_only_fields = ["id"]
