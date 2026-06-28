from rest_framework import serializers
from .models import (
    Stop, StopAmenity, StopAnalytics, Route, RouteStop, RouteAssignment,
    RouteVersion, RouteDiversion, TicketType, FareMatrix, SmartCard,
    CardTransaction, CardRecharge, FarePolicy, ZoneFare, DistanceFare,
    PeakFareSurcharge, DiscountRule,
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
        fields = ["id", "stop", "stop_detail", "sequence_no", "estimated_time_from_start"]


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

    class Meta:
        model = Route
        fields = [
            "id", "route_code", "name_en", "name_ne", "start_stop", "end_stop",
            "distance_km", "route_type", "status", "geojson_path",
            "approved_by", "approved_at", "route_stops", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "approved_by", "approved_at", "created_at", "updated_at"]


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
    class Meta:
        model = TicketType
        fields = ["id", "code", "name_en", "name_ne", "description", "validity_hours", "is_transferable", "is_active"]


class FareMatrixSerializer(serializers.ModelSerializer):
    class Meta:
        model = FareMatrix
        fields = [
            "id", "route", "zone_from", "zone_to", "ticket_type",
            "base_fare", "peak_fare", "student_fare", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class SmartCardSerializer(serializers.ModelSerializer):
    class Meta:
        model = SmartCard
        fields = ["id", "card_no", "passenger", "balance", "status", "issued_at", "issued_by_tenant"]
        read_only_fields = ["id", "balance", "issued_at"]


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
