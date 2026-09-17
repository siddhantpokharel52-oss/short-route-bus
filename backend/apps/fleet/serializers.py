from rest_framework import serializers
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from .models import (
    Vehicle, VehicleDocument, VehicleInsurance, VehicleGPS,
    VehicleCategory, VehicleGroup, GroupMember, GroupCompositionRule,
    GroupDriverAssignment,
)


class VehicleDocumentSerializer(serializers.ModelSerializer):
    days_to_expiry = serializers.ReadOnlyField()

    class Meta:
        model = VehicleDocument
        fields = [
            "id", "vehicle", "doc_type", "doc_no", "issued_date",
            "expiry_date", "file", "days_to_expiry", "created_at",
        ]
        # vehicle is injected server-side by VehicleDocumentViewSet.perform_create()
        # from the URL's vehicle_pk, never supplied by the client -- read_only so
        # is_valid() doesn't reject a create for lacking a field it was never
        # meant to send.
        read_only_fields = ["id", "vehicle", "created_at"]


class VehicleGPSSerializer(serializers.ModelSerializer):
    class Meta:
        model = VehicleGPS
        fields = ["id", "device_id", "imei", "provider", "sim_no", "status", "installed_at"]
        read_only_fields = ["id", "installed_at"]


class VehicleSerializer(serializers.ModelSerializer):
    documents = VehicleDocumentSerializer(many=True, read_only=True)
    gps_device = VehicleGPSSerializer(read_only=True)
    is_available_for_trip = serializers.ReadOnlyField()
    category_code = serializers.CharField(source="category.code", read_only=True, default=None)
    category_name = serializers.CharField(source="category.name_en", read_only=True, default=None)

    # ── Write-only: Insurance (creates VehicleInsurance on save) ──────────────
    insurance_policy_no = serializers.CharField(write_only=True, required=False, allow_blank=True)
    insurance_expiry_date = serializers.DateField(write_only=True, required=False, allow_null=True)

    # ── Write-only: Fitness cert (creates VehicleDocument on save) ────────────
    fitness_cert_no = serializers.CharField(write_only=True, required=False, allow_blank=True)
    fitness_expiry_date = serializers.DateField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = Vehicle
        fields = [
            # identifiers
            "id", "registration_no", "bus_number",
            # ownership
            "owner_name", "owner_phone",
            # basic info
            "vehicle_type", "make", "model", "year", "color",
            # vehicle identification
            "chassis_no", "engine_no",
            # capacity & specs
            "capacity_seated", "capacity_standing", "fuel_type", "engine_capacity_cc",
            # category
            "category", "category_code", "category_name",
            # operational
            "status", "assigned_route_id", "current_driver_id", "current_conductor_id",
            "gps_device_id", "odometer_km",
            # insurance & fitness (write-only)
            "insurance_policy_no", "insurance_expiry_date",
            "fitness_cert_no", "fitness_expiry_date",
            # related
            "documents", "gps_device", "is_available_for_trip",
            # timestamps
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def update(self, instance, validated_data):
        insurance_policy_no = validated_data.pop("insurance_policy_no", "")
        insurance_expiry_date = validated_data.pop("insurance_expiry_date", None)
        fitness_cert_no = validated_data.pop("fitness_cert_no", "")
        fitness_expiry_date = validated_data.pop("fitness_expiry_date", None)

        instance = super().update(instance, validated_data)

        today = timezone.now().date()

        if insurance_policy_no and insurance_expiry_date:
            existing_ins = instance.documents.filter(
                doc_type=VehicleDocument.DocType.INSURANCE, is_deleted=False
            ).first()
            if existing_ins:
                existing_ins.doc_no = insurance_policy_no
                existing_ins.expiry_date = insurance_expiry_date
                existing_ins.save(update_fields=["doc_no", "expiry_date"])
            else:
                VehicleDocument.objects.create(
                    vehicle=instance,
                    doc_type=VehicleDocument.DocType.INSURANCE,
                    doc_no=insurance_policy_no,
                    issued_date=today,
                    expiry_date=insurance_expiry_date,
                )

        if fitness_cert_no and fitness_expiry_date:
            existing_fit = instance.documents.filter(
                doc_type=VehicleDocument.DocType.FITNESS, is_deleted=False
            ).first()
            if existing_fit:
                existing_fit.doc_no = fitness_cert_no
                existing_fit.expiry_date = fitness_expiry_date
                existing_fit.save(update_fields=["doc_no", "expiry_date"])
            else:
                VehicleDocument.objects.create(
                    vehicle=instance,
                    doc_type=VehicleDocument.DocType.FITNESS,
                    doc_no=fitness_cert_no,
                    issued_date=today,
                    expiry_date=fitness_expiry_date,
                )

        return instance

    def create(self, validated_data):
        insurance_policy_no = validated_data.pop("insurance_policy_no", "").strip()
        insurance_expiry_date = validated_data.pop("insurance_expiry_date", None)
        fitness_cert_no = validated_data.pop("fitness_cert_no", "").strip()
        fitness_expiry_date = validated_data.pop("fitness_expiry_date", None)

        vehicle = super().create(validated_data)

        today = timezone.now().date()

        if insurance_policy_no and insurance_expiry_date:
            VehicleInsurance.objects.create(
                vehicle=vehicle,
                provider="",
                policy_no=insurance_policy_no,
                coverage_amount=0,
                premium=0,
                start_date=today,
                end_date=insurance_expiry_date,
                is_active=True,
            )
            VehicleDocument.objects.create(
                vehicle=vehicle,
                doc_type=VehicleDocument.DocType.INSURANCE,
                doc_no=insurance_policy_no,
                issued_date=today,
                expiry_date=insurance_expiry_date,
            )

        if fitness_cert_no and fitness_expiry_date:
            VehicleDocument.objects.create(
                vehicle=vehicle,
                doc_type=VehicleDocument.DocType.FITNESS,
                doc_no=fitness_cert_no,
                issued_date=today,
                expiry_date=fitness_expiry_date,
            )

        return vehicle


class VehicleInsuranceSerializer(serializers.ModelSerializer):
    class Meta:
        model = VehicleInsurance
        fields = [
            "id", "vehicle", "provider", "policy_no", "coverage_amount",
            "premium", "start_date", "end_date", "is_active", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class VehicleExpiryAlertSerializer(serializers.ModelSerializer):
    vehicle_registration = serializers.CharField(source="vehicle.registration_no", read_only=True)
    days_to_expiry = serializers.ReadOnlyField()

    class Meta:
        model = VehicleDocument
        fields = [
            "id", "vehicle", "vehicle_registration", "doc_type",
            "doc_no", "expiry_date", "days_to_expiry",
        ]


class VehicleCategorySerializer(serializers.ModelSerializer):
    vehicle_count = serializers.SerializerMethodField()

    class Meta:
        model = VehicleCategory
        fields = [
            "id", "code", "name_en", "name_ne", "seating_capacity", "body_class",
            "air_conditioned", "fuel_type", "permit_class", "attributes",
            "is_active", "vehicle_count", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_vehicle_count(self, obj):
        return obj.vehicles.filter(is_deleted=False).count()


class GroupMemberVehicleSerializer(serializers.Serializer):
    """Slim read-only vehicle shape nested inside a group's member list --
    a full VehicleSerializer would pull in documents/gps_device for every
    member, which the group screens never need."""
    id = serializers.UUIDField(read_only=True)
    registration_no = serializers.CharField(read_only=True)
    category_code = serializers.CharField(source="category.code", read_only=True, default=None)
    category_name = serializers.CharField(source="category.name_en", read_only=True, default=None)


class GroupMemberSerializer(serializers.ModelSerializer):
    vehicle_detail = GroupMemberVehicleSerializer(source="vehicle", read_only=True)

    class Meta:
        model = GroupMember
        fields = ["id", "group", "vehicle", "vehicle_detail", "valid_from", "valid_to"]
        # group is injected server-side by GroupMemberViewSet.perform_create() from
        # the URL's group_pk, same pattern as VehicleDocumentSerializer.vehicle.
        read_only_fields = ["id", "group", "valid_from", "valid_to"]

    def validate(self, attrs):
        # Run full_clean() here (not just in the view) so DRF's is_valid()
        # surfaces composition-rule violations as a normal field/non-field
        # error instead of the view having to catch a raised ValidationError.
        instance = GroupMember(group=self.context["group"], vehicle=attrs["vehicle"])
        try:
            instance.clean()
        except DjangoValidationError as e:
            raise serializers.ValidationError({"vehicle": e.messages})
        return attrs


class VehicleGroupSerializer(serializers.ModelSerializer):
    members = GroupMemberSerializer(many=True, read_only=True)

    class Meta:
        model = VehicleGroup
        fields = [
            "id", "code", "kind", "composition_mode", "status", "ring_position",
            "home_latitude", "home_longitude",
            "capability_min_seats", "capability_total_seats", "capability_all_ac",
            "capability_ac_count", "capability_categories", "capability_permit_classes",
            "capability_computed_at", "members", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "ring_position", "capability_min_seats", "capability_total_seats", "capability_all_ac",
            "capability_ac_count", "capability_categories", "capability_permit_classes",
            "capability_computed_at", "created_at", "updated_at",
        ]


class GroupDriverAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = GroupDriverAssignment
        fields = ["id", "group", "driver_user_id", "valid_from", "valid_to"]
        # group is injected server-side by GroupDriverAssignmentViewSet.perform_create()
        # from the URL's group_pk, same pattern as GroupMemberSerializer.group.
        read_only_fields = ["id", "group", "valid_from", "valid_to"]

    def validate(self, attrs):
        instance = GroupDriverAssignment(group=self.context["group"], driver_user_id=attrs["driver_user_id"])
        try:
            instance.clean()
        except DjangoValidationError as e:
            raise serializers.ValidationError({"driver_user_id": e.messages})
        return attrs


class GroupCompositionRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = GroupCompositionRule
        fields = [
            "id", "group", "allow_mixed", "group_size", "max_categories_per_group",
            "capacity_spread_limit", "permit_class_match", "required_composition", "spares_allowed",
        ]
        read_only_fields = ["id"]
