from rest_framework import serializers
import secrets
from django.utils import timezone
from .models import Ticket, DailyPass, MonthlyPass, StudentPass, NamastePayConfig


def _resolve_stop_name(stop_id):
    """Resolve a stop UUID to its English name via the public Stop model."""
    if not stop_id:
        return None
    try:
        from backend.apps.platform.models import Stop
        stop = Stop.objects.filter(id=stop_id).first()
        return stop.name_en if stop else str(stop_id)
    except Exception:
        return str(stop_id)


def _resolve_vehicle_bus_number(vehicle_id):
    """Resolve a vehicle UUID to its display bus number via fleet.Vehicle."""
    if not vehicle_id:
        return None
    try:
        from backend.apps.fleet.models import Vehicle
        vehicle = Vehicle.objects.filter(id=vehicle_id).first()
        return vehicle.bus_number if vehicle else None
    except Exception:
        return None


class TicketSerializer(serializers.ModelSerializer):
    from_stop_name = serializers.SerializerMethodField()
    to_stop_name = serializers.SerializerMethodField()
    vehicle_bus_number = serializers.SerializerMethodField()

    class Meta:
        model = Ticket
        fields = [
            "id", "ticket_uid",
            "ticket_type_id", "trip_id", "vehicle_id", "passenger_id", "passenger_name",
            "conductor_id", "issued_at", "issued_by", "valid_until",
            "fare_paid", "payment_method",
            "qr_code", "status",
            "from_stop_id", "to_stop_id",
            "from_stop_name", "to_stop_name",
            "vehicle_bus_number",
        ]
        read_only_fields = [
            "id", "ticket_uid", "issued_at", "valid_until", "qr_code",
            "from_stop_name", "to_stop_name", "vehicle_bus_number",
        ]

    def get_from_stop_name(self, obj):
        return _resolve_stop_name(obj.from_stop_id)

    def get_to_stop_name(self, obj):
        return _resolve_stop_name(obj.to_stop_id)

    def get_vehicle_bus_number(self, obj):
        return _resolve_vehicle_bus_number(obj.vehicle_id)

    def create(self, validated_data):
        # Auto-generate ticket UID
        ticket_uid = f"TKT-{secrets.token_hex(6).upper()}"

        # Auto-set valid_until to end of today if not provided
        if not validated_data.get("valid_until"):
            validated_data["valid_until"] = (
                timezone.now()
                .replace(hour=23, minute=59, second=59, microsecond=0)
            )

        # Generate QR code
        try:
            import qrcode
            import io
            import base64
            qr = qrcode.make(ticket_uid)
            buf = io.BytesIO()
            qr.save(buf, format="PNG")
            qr_b64 = base64.b64encode(buf.getvalue()).decode()
        except Exception:
            qr_b64 = ""

        return Ticket.objects.create(
            ticket_uid=ticket_uid,
            qr_code=qr_b64,
            **validated_data,
        )


class TicketVerifySerializer(serializers.Serializer):
    ticket_uid = serializers.CharField()

    def validate_ticket_uid(self, value):
        try:
            ticket = Ticket.objects.get(ticket_uid=value)
        except Ticket.DoesNotExist:
            raise serializers.ValidationError("Ticket not found.")
        if ticket.status == Ticket.Status.USED:
            raise serializers.ValidationError("Ticket already used.")
        if ticket.status == Ticket.Status.EXPIRED or ticket.valid_until < timezone.now():
            raise serializers.ValidationError("Ticket has expired.")
        if ticket.status == Ticket.Status.CANCELLED:
            raise serializers.ValidationError("Ticket is cancelled.")
        return value


class NamastePayConfigSerializer(serializers.ModelSerializer):
    # Write-only: accepted on save, never echoed back. The read side gets
    # api_key_set instead, same convention as a password field -- the
    # frontend shows "configured" rather than ever displaying the real key.
    api_key = serializers.CharField(write_only=True, required=False, allow_blank=True)
    api_key_set = serializers.SerializerMethodField()

    class Meta:
        model = NamastePayConfig
        fields = [
            "id", "api_key", "api_key_set",
            "environment", "is_active", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "api_key_set", "created_at", "updated_at"]

    def get_api_key_set(self, obj):
        return bool(obj.api_key)

    def update(self, instance, validated_data):
        # A blank/omitted key on save means "leave the existing one alone"
        # -- the frontend never has the real value to resubmit.
        new_key = validated_data.pop("api_key", None)
        instance = super().update(instance, validated_data)
        if new_key:
            instance.api_key = new_key
            instance.save(update_fields=["api_key"])
        return instance


class DailyPassSerializer(serializers.ModelSerializer):
    class Meta:
        model = DailyPass
        fields = ["id", "passenger_id", "date", "fare_paid", "issued_at", "usage_count", "is_active"]
        read_only_fields = ["id", "issued_at", "usage_count"]


class MonthlyPassSerializer(serializers.ModelSerializer):
    class Meta:
        model = MonthlyPass
        fields = ["id", "passenger_id", "month", "fare_paid", "issued_at", "is_active", "route_id"]
        read_only_fields = ["id", "issued_at"]


class StudentPassSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentPass
        fields = [
            "id", "passenger_id", "school", "grade", "valid_from",
            "valid_until", "photo", "is_active", "created_at",
        ]
        read_only_fields = ["id", "created_at"]
