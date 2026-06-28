from rest_framework import serializers
from .models import (
    Driver, DriverTraining, DriverMedical, DriverAttendance,
    DriverViolation, DriverPerformance,
    Conductor, ConductorAttendance, TicketCollection,
    BusCompany, CompanyLicense,
)


class DriverTrainingSerializer(serializers.ModelSerializer):
    class Meta:
        model = DriverTraining
        fields = ["id", "training_name", "provider", "date", "score", "certificate", "created_at"]
        read_only_fields = ["id", "created_at"]


class DriverMedicalSerializer(serializers.ModelSerializer):
    class Meta:
        model = DriverMedical
        fields = ["id", "examination_date", "doctor", "result", "valid_until", "remarks", "created_at"]
        read_only_fields = ["id", "created_at"]


class DriverAttendanceSerializer(serializers.ModelSerializer):
    class Meta:
        model = DriverAttendance
        fields = ["id", "driver", "date", "check_in", "check_out", "status"]
        read_only_fields = ["id"]


class DriverPerformanceSerializer(serializers.ModelSerializer):
    class Meta:
        model = DriverPerformance
        fields = ["id", "month", "trips_completed", "on_time_rate", "complaints_received", "safety_score"]
        read_only_fields = ["id"]


class DriverSerializer(serializers.ModelSerializer):
    class Meta:
        model = Driver
        fields = [
            # identifiers
            "id", "employee_id",
            # personal
            "full_name_en", "full_name_ne", "gender", "dob", "citizenship_no",
            "phone", "address", "emergency_contact_name", "emergency_contact_number", "photo",
            # license
            "license_no", "license_category", "license_issue_date",
            "license_expiry", "license_issuing_authority",
            # employment
            "employment_type", "date_of_joining", "experience_years",
            "previous_employer", "shift", "route_id", "bus_id",
            # medical
            "blood_group", "medical_conditions", "last_medical_checkup_date",
            # salary
            "basic_salary", "allowances",
            # system
            "status", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "employee_id", "created_at", "updated_at"]

    def create(self, validated_data):
        # Auto-generate employee_id: DRV-0001, DRV-0002, …
        count = Driver.objects.count() + 1
        validated_data["employee_id"] = f"DRV-{count:04d}"
        return super().create(validated_data)


class ConductorAttendanceSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConductorAttendance
        fields = ["id", "conductor", "date", "check_in", "check_out", "status"]
        read_only_fields = ["id"]


class TicketCollectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = TicketCollection
        fields = [
            "id", "conductor", "trip_id", "total_tickets",
            "cash_collected", "card_collected", "submitted_at", "is_verified",
        ]
        read_only_fields = ["id", "submitted_at", "is_verified"]


class ConductorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Conductor
        fields = [
            "id", "employee_id",
            "full_name_en", "full_name_ne", "gender", "dob",
            "citizenship_no", "phone", "address",
            "emergency_contact_name", "emergency_contact_number",
            "blood_group", "photo",
            "employment_type", "date_of_joining", "shift",
            "assigned_vehicle_id", "assigned_route_id",
            "basic_salary", "allowances",
            "status", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "employee_id", "created_at", "updated_at"]

    def create(self, validated_data):
        count = Conductor.objects.count() + 1
        validated_data["employee_id"] = f"CDR-{count:04d}"
        return super().create(validated_data)


class BusCompanySerializer(serializers.ModelSerializer):
    registration_no = serializers.CharField(max_length=100, allow_blank=True, required=False)
    address = serializers.CharField(allow_blank=True, required=False)
    contact_phone = serializers.CharField(max_length=20, allow_blank=True, required=False)

    class Meta:
        model = BusCompany
        fields = [
            "id", "company_name", "registration_no", "address",
            "contact_phone", "contact_email", "logo", "tax_pan", "established_date",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class CompanyLicenseSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompanyLicense
        fields = [
            "id", "company", "license_type", "license_no", "issued_date",
            "expiry_date", "issuing_authority", "document", "created_at",
        ]
        read_only_fields = ["id", "created_at"]
