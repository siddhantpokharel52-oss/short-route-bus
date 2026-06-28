from rest_framework import serializers
import secrets
from .models import Complaint, ComplaintAssignment, ComplaintResolution


class ComplaintAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = ComplaintAssignment
        fields = ["id", "complaint", "assigned_to_id", "assigned_at", "due_at"]
        read_only_fields = ["id", "assigned_at"]


class ComplaintResolutionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ComplaintResolution
        fields = ["id", "complaint", "resolved_by_id", "resolved_at", "resolution_notes", "satisfaction_rating"]
        read_only_fields = ["id", "resolved_at"]


class ComplaintSerializer(serializers.ModelSerializer):
    resolution = ComplaintResolutionSerializer(read_only=True)

    class Meta:
        model = Complaint
        fields = [
            "id", "complaint_no", "passenger_id", "passenger_name", "passenger_phone",
            "complaint_type", "description", "trip_id", "vehicle_no", "route_id",
            "tenant_id", "submitted_at", "status", "resolution",
        ]
        read_only_fields = ["id", "complaint_no", "submitted_at"]

    def create(self, validated_data):
        complaint_no = f"CMP-{secrets.token_hex(4).upper()}"
        return Complaint.objects.create(complaint_no=complaint_no, **validated_data)
