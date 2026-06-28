from rest_framework import serializers
import secrets
from .models import Incident, IncidentMedia, InsuranceClaim


class IncidentMediaSerializer(serializers.ModelSerializer):
    class Meta:
        model = IncidentMedia
        fields = ["id", "file", "media_type", "uploaded_at"]
        read_only_fields = ["id", "uploaded_at"]


class InsuranceClaimSerializer(serializers.ModelSerializer):
    class Meta:
        model = InsuranceClaim
        fields = ["id", "incident", "claim_no", "insurer", "claim_amount", "status", "filed_at", "settled_at", "settlement_amount"]
        read_only_fields = ["id", "filed_at"]


class IncidentSerializer(serializers.ModelSerializer):
    media = IncidentMediaSerializer(many=True, read_only=True)
    insurance_claims = InsuranceClaimSerializer(many=True, read_only=True)

    class Meta:
        model = Incident
        fields = [
            "id", "incident_no", "type", "vehicle_id", "driver_id", "route_id",
            "location", "description", "reported_by_id", "reported_at",
            "severity", "status", "resolved_at", "media", "insurance_claims",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "incident_no", "reported_at", "created_at", "updated_at"]

    def create(self, validated_data):
        incident_no = f"INC-{secrets.token_hex(4).upper()}"
        return Incident.objects.create(incident_no=incident_no, **validated_data)
