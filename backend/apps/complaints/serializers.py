from rest_framework import serializers
import secrets
from .models import Complaint, ComplaintAssignment, ComplaintResolution, StaffIssueReport


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


class StaffIssueReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffIssueReport
        fields = ["id", "category", "subject", "description", "status", "created_at"]
        # reported_by_id is injected server-side (the calling view), never
        # accepted from the client -- same reasoning as issued_by/conductor_id
        # elsewhere in this codebase.
        read_only_fields = ["id", "status", "created_at"]
