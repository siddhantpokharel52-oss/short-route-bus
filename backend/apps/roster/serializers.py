from django.utils import timezone
from rest_framework import serializers
from .models import RosterPeriod, Duty, DutyOverride, VehicleSubstitution, RotationPolicy


class RosterPeriodSerializer(serializers.ModelSerializer):
    # RG-062: no existing "maximum reasonable range" convention elsewhere in
    # this codebase to match -- roughly two months is generous for any real
    # rotation cycle while still catching a fat-fingered multi-year range.
    MAX_PERIOD_DAYS = 62

    class Meta:
        model = RosterPeriod
        fields = ["id", "start_date", "end_date", "status", "version", "created_at", "updated_at"]
        read_only_fields = ["id", "status", "version", "created_at", "updated_at"]

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end:
            if start > end:
                raise serializers.ValidationError("start_date must be before end_date.")
            if (end - start).days > self.MAX_PERIOD_DAYS:
                raise serializers.ValidationError(f"A roster period can span at most {self.MAX_PERIOD_DAYS} days.")
            if self.instance is None and end < timezone.now().date():
                raise serializers.ValidationError("This date range is entirely in the past.")
            overlapping = RosterPeriod.objects.filter(
                is_deleted=False, start_date__lte=end, end_date__gte=start,
            )
            if self.instance:
                overlapping = overlapping.exclude(pk=self.instance.pk)
            if overlapping.exists():
                raise serializers.ValidationError(
                    "This date range overlaps an existing roster period. Close or adjust it first."
                )
        return attrs


class RotationPolicySerializer(serializers.ModelSerializer):
    # RG-040: no existing cross-model convention for "a reasonable max" here
    # (same gap RosterPeriodSerializer.MAX_PERIOD_DAYS already noted) --
    # this establishes the second instance of that same class-constant pattern.
    MAX_COOLDOWN_DAYS = 90

    class Meta:
        model = RotationPolicy
        fields = [
            "id", "ring_step", "week_pattern", "week_step", "epoch_date",
            "same_weekday_lookback_weeks", "route_cooldown_days",
            "rotation_preference_weight", "route_cooldown_weight",
            "max_consecutive_days_same_route", "consecutive_weight", "fair_share_weight",
            "depot_proximity_weight", "crew_max_hours", "crew_hours_weight",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        # RG-037: ring_step=0 means "no rotation ever happens" -- always
        # invalid regardless of ring length (gcd(0, n) != 1 for any n > 1),
        # so it doesn't need the ring-length-dependent coprimality check
        # (services.is_coprime_step, only computable at rotate time) to reject.
        ring_step = attrs.get("ring_step", getattr(self.instance, "ring_step", None))
        if ring_step is not None and ring_step < 1:
            raise serializers.ValidationError({"ring_step": "Must be at least 1 -- 0 means no rotation ever happens."})

        cooldown = attrs.get("route_cooldown_days", getattr(self.instance, "route_cooldown_days", None))
        if cooldown is not None and cooldown > self.MAX_COOLDOWN_DAYS:
            raise serializers.ValidationError(
                {"route_cooldown_days": f"Must be at most {self.MAX_COOLDOWN_DAYS} days."}
            )
        return attrs


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
