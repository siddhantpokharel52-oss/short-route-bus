from rest_framework import serializers
from .models import (
    Stop, StopAmenity, StopAnalytics, Route, RouteStop, RouteAssignment,
    RouteVersion, RouteDiversion, TicketType, FareMatrix, SmartCard,
    CardTransaction, CardRecharge, FarePolicy, ZoneFare, DistanceFare,
    PeakFareSurcharge, DiscountRule, AdminNotification, SuggestedStop,
    RouteRequirement, RouteDemand,
)


class StopAmenitySerializer(serializers.ModelSerializer):
    class Meta:
        model = StopAmenity
        fields = ["id", "amenity_type", "status", "last_maintained"]


class StopSerializer(serializers.ModelSerializer):
    amenities = StopAmenitySerializer(many=True, read_only=True)
    stop_code = serializers.CharField(required=False, allow_blank=True)
    name_ne = serializers.CharField(required=False, allow_blank=True, default="")
    routes = serializers.SerializerMethodField()

    class Meta:
        model = Stop
        fields = [
            "id", "stop_code", "name_en", "name_ne", "latitude", "longitude",
            "zone", "capacity", "has_shelter", "has_digital_signage", "status",
            "amenities", "routes", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_routes(self, obj):
        return [
            {"id": str(rs.route.id), "route_code": rs.route.route_code, "name_en": rs.route.name_en}
            for rs in obj.route_stops.select_related("route").all()
        ]

    def validate_stop_code(self, value):
        if not value:
            import secrets
            return f"KV{secrets.token_hex(3).upper()}"
        return value


class StopAnalyticsSerializer(serializers.ModelSerializer):
    class Meta:
        model = StopAnalytics
        fields = ["id", "date", "boarding_count", "alighting_count", "peak_hour"]


class RouteStopSerializer(serializers.ModelSerializer):
    stop_detail = StopSerializer(source="stop", read_only=True)

    class Meta:
        model = RouteStop
        fields = ["id", "stop", "stop_detail", "sequence_no", "estimated_time_from_start", "status"]


class SuggestedStopSerializer(serializers.ModelSerializer):
    class Meta:
        model = SuggestedStop
        fields = ["id", "route", "latitude", "longitude", "order", "created_at"]
        read_only_fields = fields


class AdminNotificationSerializer(serializers.ModelSerializer):
    route_code = serializers.CharField(source="route.route_code", read_only=True, default=None)
    route_name = serializers.CharField(source="route.name_en", read_only=True, default=None)
    tenant_name = serializers.CharField(source="tenant.name", read_only=True, default=None)

    class Meta:
        model = AdminNotification
        fields = [
            "id", "event_type", "title", "message", "route", "route_code",
            "route_name", "route_stop", "tenant_name", "is_read", "created_at",
        ]
        read_only_fields = fields


class RouteOperatorSerializer(serializers.ModelSerializer):
    """One tenant's assignment to a route -- a SHARED route legitimately has
    more than one of these; an EXCLUSIVE route should only ever have one."""
    tenant_id = serializers.UUIDField(source="tenant.id", read_only=True)
    tenant_name = serializers.CharField(source="tenant.name", read_only=True)
    schema_name = serializers.CharField(source="tenant.schema_name", read_only=True)

    class Meta:
        model = RouteAssignment
        fields = ["tenant_id", "tenant_name", "schema_name", "status", "share_percentage"]


class RouteRequirementSerializer(serializers.ModelSerializer):
    class Meta:
        model = RouteRequirement
        fields = [
            "id", "route", "mode", "min_seats", "require_ac", "allowed_categories",
            "permit_class", "min_total_seats", "min_ac_count", "category_bounds",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "route", "created_at", "updated_at"]

    def validate_category_bounds(self, value):
        # RG-025: an unvalidated shape here reaches fleet's balance() and
        # check_group_route_eligibility() unconditionally as {code: {min?, max?}}
        # -- anything else 500s the Balance Check screen for the whole operator.
        if not isinstance(value, dict):
            raise serializers.ValidationError("Must be an object of {category_code: {min?, max?}}.")
        for code, bounds in value.items():
            if not isinstance(bounds, dict) or not set(bounds).issubset({"min", "max"}):
                raise serializers.ValidationError(f"'{code}': must be an object with only 'min'/'max' integer keys.")
            for k in ("min", "max"):
                if k in bounds and not isinstance(bounds[k], int):
                    raise serializers.ValidationError(f"'{code}.{k}' must be an integer.")
        return value

    def validate_allowed_categories(self, value):
        # RG-028: reject a bare string (accepted today since a string is
        # JSON-serializable) -- must be a list of category-code strings.
        # Can't check the codes actually exist: RouteRequirement is
        # shared-schema and a route can be served by several tenants, each
        # with their own VehicleCategory codes, so there's no single fleet
        # to validate against at save time.
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise serializers.ValidationError("Must be a list of category code strings.")
        return value

    def validate(self, attrs):
        # RG-029/032: this endpoint is always a partial update once a
        # RouteRequirement row exists (see requirement() in views.py), so a
        # payload for the new mode naturally omits the old mode's fields --
        # they survive as stale leftovers unless explicitly cleared here.
        # Only fires when the client is actually setting mode; an ordinary
        # partial update of some unrelated field is untouched.
        mode = attrs.get("mode")
        if mode == RouteRequirement.Mode.PER_VEHICLE:
            attrs.setdefault("min_total_seats", None)
            attrs.setdefault("min_ac_count", None)
            attrs.setdefault("category_bounds", {})
        elif mode == RouteRequirement.Mode.GROUP_LEVEL:
            attrs.setdefault("min_seats", None)
            attrs.setdefault("require_ac", False)
            attrs.setdefault("allowed_categories", [])
        return attrs


class RouteDemandSerializer(serializers.ModelSerializer):
    class Meta:
        model = RouteDemand
        fields = ["id", "route", "day_type", "slot_count", "effective_from", "effective_to", "created_at"]
        read_only_fields = ["id", "route", "created_at"]


class RouteSerializer(serializers.ModelSerializer):
    route_stops = RouteStopSerializer(many=True, read_only=True)
    start_stop = serializers.PrimaryKeyRelatedField(
        queryset=Stop.objects.all(), required=False, allow_null=True
    )
    end_stop = serializers.PrimaryKeyRelatedField(
        queryset=Stop.objects.all(), required=False, allow_null=True
    )
    name_ne = serializers.CharField(required=False, allow_blank=True, default="")
    distance_km = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, default=0)
    operators = RouteOperatorSerializer(source="assignments", many=True, read_only=True)
    requirement = RouteRequirementSerializer(read_only=True)
    demand_profiles = RouteDemandSerializer(many=True, read_only=True)

    class Meta:
        model = Route
        fields = [
            "id", "route_code", "name_en", "name_ne", "start_stop", "end_stop",
            "distance_km", "route_type", "status", "geojson_path",
            "approved_by", "approved_at", "route_stops", "operators",
            "requirement", "demand_profiles", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "approved_by", "approved_at", "created_at", "updated_at"]


class RoutePublicSerializer(serializers.ModelSerializer):
    """RG-089: what an anonymous/unauthenticated caller may see -- excludes
    requirement/demand_profiles (internal fleet-composition and slot-planning
    data), approved_by (a raw user id), and operators (tenant schema names +
    revenue-share percentages). RouteViewSet also filters unapproved routes
    out of this path entirely; this serializer only handles field exposure."""
    route_stops = RouteStopSerializer(many=True, read_only=True)

    class Meta:
        model = Route
        fields = [
            "id", "route_code", "name_en", "name_ne", "start_stop", "end_stop",
            "distance_km", "route_type", "status", "geojson_path", "route_stops",
            "created_at", "updated_at",
        ]
        read_only_fields = fields


class RouteAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = RouteAssignment
        fields = [
            "id", "route", "tenant", "share_percentage", "approved_by",
            "start_date", "end_date", "status", "created_at",
        ]
        read_only_fields = ["id", "approved_by", "created_at"]

    def validate(self, data):
        route = data.get("route")
        if route and route.route_type == Route.RouteType.EXCLUSIVE:
            existing = RouteAssignment.objects.filter(
                route=route, status=RouteAssignment.Status.ACTIVE
            )
            if self.instance:
                existing = existing.exclude(pk=self.instance.pk)
            if existing.exists():
                raise serializers.ValidationError(
                    {"route": "Exclusive route already has an active assignment."}
                )
        return data


class RouteDiversionSerializer(serializers.ModelSerializer):
    class Meta:
        model = RouteDiversion
        fields = [
            "id", "route", "start_stop", "end_stop", "reason",
            "start_time", "end_time", "alternate_path", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class TicketTypeSerializer(serializers.ModelSerializer):
    # True for the platform-wide defaults (tenant=None) every tenant shares
    # and can use but never edit; False for a type a tenant created for
    # itself. tenant itself is exposed too (read-only -- injected server-side
    # by TicketTypeViewSet.perform_create(), never client-settable) so the
    # frontend doesn't have to infer ownership from is_global alone.
    is_global = serializers.SerializerMethodField()

    class Meta:
        model = TicketType
        fields = ["id", "code", "name_en", "name_ne", "description", "is_transferable", "is_active", "tenant", "is_global"]
        read_only_fields = ["id", "tenant", "is_global"]

    def get_is_global(self, obj):
        return obj.tenant_id is None


class FareMatrixSerializer(serializers.ModelSerializer):
    class Meta:
        model = FareMatrix
        fields = [
            "id", "route", "zone_from", "zone_to", "ticket_type",
            "base_fare", "peak_fare", "student_fare", "senior_citizen_fare", "child_fare", "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def validate_ticket_type(self, value):
        # TicketType is now genuinely per-tenant (tenant=None means a
        # platform-wide default). DRF's auto-generated PK field would
        # otherwise let a tenant attach a fare to ANY ticket type by ID,
        # including another tenant's private one -- this is the one place
        # that lookup happens on the plain create()/update() path (bulk-
        # import and generate-from-formula go through
        # FareMatrixViewSet._resolve_ticket_type instead, scoped the same
        # way).
        request = self.context.get("request")
        user = getattr(request, "user", None) if request else None
        if user and getattr(user, "is_authenticated", False) and not user.is_platform_role:
            if value.tenant_id and value.tenant.schema_name != user.tenant_schema:
                raise serializers.ValidationError("This ticket type belongs to a different tenant.")
        return value

    def validate(self, data):
        zone_from = data.get("zone_from", getattr(self.instance, "zone_from", ""))
        zone_to = data.get("zone_to", getattr(self.instance, "zone_to", ""))
        if zone_from and zone_to and zone_from == zone_to:
            raise serializers.ValidationError(
                "zone_from and zone_to must be different stops (a blank/blank pair for a flat, "
                "zone-independent fare is still allowed)."
            )
        return data


class SmartCardSerializer(serializers.ModelSerializer):
    # holder_name/email were never actually returned before (the frontend's
    # column read a field that didn't exist on this serializer at all), and
    # `passenger` itself is a raw User FK -- issuing a card previously had no
    # way to identify who to issue it to except by pasting in a raw user
    # UUID, which no admin has memorized. passenger_email resolves that.
    passenger_name = serializers.CharField(source="passenger.full_name_en", read_only=True)
    passenger_email = serializers.EmailField(source="passenger.email", read_only=True)
    issue_to_email = serializers.EmailField(write_only=True, required=False)

    class Meta:
        model = SmartCard
        fields = [
            "id", "card_no", "passenger", "passenger_name", "passenger_email",
            "issue_to_email", "balance", "status", "issued_at", "issued_by_tenant",
        ]
        read_only_fields = ["id", "passenger", "balance", "issued_at"]

    def validate(self, data):
        if self.instance is None:
            email = (data.pop("issue_to_email", "") or "").strip().lower()
            if not email:
                raise serializers.ValidationError({"issue_to_email": "Required to issue a new card."})
            from backend.apps.users.models import User
            try:
                passenger = User.objects.get(email=email, role=User.Role.PASSENGER)
            except User.DoesNotExist:
                raise serializers.ValidationError({
                    "issue_to_email": f"No passenger account found for '{email}'. "
                                       "The passenger must already have an account before a card can be issued."
                })
            data["passenger"] = passenger
        else:
            data.pop("issue_to_email", None)
        return data


class CardTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CardTransaction
        fields = ["id", "card", "trip_id", "tenant", "amount", "transaction_type", "balance_after", "timestamp"]
        read_only_fields = ["id", "timestamp", "balance_after"]


class CardRechargeSerializer(serializers.ModelSerializer):
    class Meta:
        model = CardRecharge
        fields = ["id", "card", "amount", "recharge_method", "reference_no", "timestamp", "status"]
        read_only_fields = ["id", "timestamp", "status"]


class FarePolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = FarePolicy
        fields = ["id", "name", "description", "effective_date", "approved_by", "status", "created_at"]
        read_only_fields = ["id", "approved_by", "created_at"]
