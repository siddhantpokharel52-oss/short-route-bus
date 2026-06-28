from rest_framework import serializers
import secrets
from django.utils import timezone
from .models import Ticket, DailyPass, MonthlyPass, StudentPass


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


class TicketSerializer(serializers.ModelSerializer):
    from_stop_name = serializers.SerializerMethodField()
    to_stop_name = serializers.SerializerMethodField()

    class Meta:
        model = Ticket
        fields = [
            "id", "ticket_uid",
            "ticket_type_id", "trip_id", "passenger_id", "passenger_name",
            "conductor_id", "issued_at", "issued_by", "valid_until",
            "fare_paid", "payment_method",
            "qr_code", "status",
            "from_stop_id", "to_stop_id",
            "from_stop_name", "to_stop_name",
        ]
        read_only_fields = [
            "id", "ticket_uid", "issued_at", "valid_until", "qr_code",
            "from_stop_name", "to_stop_name",
        ]

    def get_from_stop_name(self, obj):
        return _resolve_stop_name(obj.from_stop_id)

    def get_to_stop_name(self, obj):
        return _resolve_stop_name(obj.to_stop_id)

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
