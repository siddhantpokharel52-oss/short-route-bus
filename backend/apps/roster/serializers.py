from rest_framework import serializers
from .models import RosterPeriod, Duty, DutyOverride, VehicleSubstitution


class RosterPeriodSerializer(serializers.ModelSerializer):
    class Meta:
        model = RosterPeriod
        fields = ["id", "start_date", "end_date", "status", "version", "created_at", "updated_at"]
        read_only_fields = ["id", "status", "version", "created_at", "updated_at"]


class DutyOverrideSerializer(serializers.ModelSerializer):
    class Meta:
        model = DutyOverride
        fields = ["id", "duty", "previous_group", "new_group", "reason", "actor_id", "created_at"]
        read_only_fields = fields


class VehicleSubstitutionSerializer(serializers.ModelSerializer):
    class Meta:
        model = VehicleSubstitution
        fields = ["id", "duty", "out_vehicle", "in_vehicle", "reason", "actor_id", "created_at"]
        read_only_fields = fields


class DutySerializer(serializers.ModelSerializer):
    route_code = serializers.SerializerMethodField()
    route_name = serializers.SerializerMethodField()
    group_code = serializers.CharField(source="group.code", read_only=True, default=None)
    overrides = DutyOverrideSerializer(many=True, read_only=True)
    substitutions = VehicleSubstitutionSerializer(many=True, read_only=True)

    class Meta:
        model = Duty
        fields = [
            "id", "roster_period", "service_date", "route_id", "route_code", "route_name",
            "slot_index", "group", "group_code", "source", "locked",
            "overrides", "substitutions", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "roster_period", "service_date", "route_id", "route_code", "route_name",
            "slot_index", "group_code", "source", "overrides", "substitutions", "created_at", "updated_at",
        ]

    def get_route_code(self, obj):
        try:
            from django_tenants.utils import schema_context
            from backend.apps.platform.models import Route
            with schema_context("public"):
                return Route.objects.get(pk=obj.route_id).route_code
        except Exception:
            return str(obj.route_id)

    def get_route_name(self, obj):
        try:
            from django_tenants.utils import schema_context
            from backend.apps.platform.models import Route
            with schema_context("public"):
                return Route.objects.get(pk=obj.route_id).name_en
        except Exception:
            return str(obj.route_id)
