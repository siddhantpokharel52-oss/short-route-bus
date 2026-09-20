import re
from rest_framework import serializers
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from .models import (
    Vehicle, VehicleDocument, VehicleInsurance, VehicleGPS,
    VehicleCategory, VehicleGroup, GroupMember, GroupCompositionRule,
    GroupDriverAssignment, GroupConductorAssignment,
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

    def validate(self, attrs):
        # RG-010: required on create -- existing uncategorised vehicles (per
        # Vehicle.category's own null=True comment) keep working untouched.
        # attrs.get() (not validate_category, a required=False field's
        # validate_<field> hook never even runs when the key is omitted)
        # correctly catches both "omitted" and "explicitly null".
        if self.instance is None and attrs.get("category") is None:
            raise serializers.ValidationError({"category": "category is required."})
        return attrs

    def validate_registration_no(self, value):
        # RG-012: case-insensitive uniqueness -- a real plate ("Ba 1 Kha 2155"
        # vs "ba 1 kha 2155") is the same vehicle either way. Uppercasing
        # doesn't corrupt a real plate string, and matches this codebase's
        # own convention of storing handles in a canonical case.
        normalized = value.strip().upper()
        qs = Vehicle.objects.filter(registration_no__iexact=normalized)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(f"'{normalized}' already exists (case-insensitive).")
        return normalized

    def validate_capacity_seated(self, value):
        # RG-016: 0 is accepted by PositiveSmallIntegerField (only excludes
        # negatives) but breaks the min/total-seats maths downstream.
        if value < 1:
            raise serializers.ValidationError("Must be at least 1.")
        return value

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

    def validate_code(self, value):
        # RG-005: case-insensitive uniqueness. RG-048: codes are short ASCII
        # handles by the model's own help_text ("e.g. DLX-35") -- unlike
        # Vehicle.registration_no, which must keep accepting real plate
        # formats, so only this code field gets a character whitelist.
        normalized = value.strip().upper()
        if not re.fullmatch(r"[A-Z0-9\-_]+", normalized):
            raise serializers.ValidationError("Only letters, numbers, hyphens and underscores are allowed.")
        qs = VehicleCategory.objects.filter(code__iexact=normalized)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(f"'{normalized}' already exists (case-insensitive).")
        return normalized

    def validate_seating_capacity(self, value):
        # RG-006: 0 is accepted by PositiveSmallIntegerField (only excludes
        # negatives) but breaks the min/total-seats maths downstream.
        if value < 1:
            raise serializers.ValidationError("Must be at least 1.")
        return value


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

    def validate_code(self, value):
        # RG-018: case-insensitive uniqueness. RG-048: codes are short ASCII
        # handles by the model's own help_text ("e.g. G-03") -- a whitelist
        # keeps HTML/emoji/SQL-looking text out of a string used as a handle
        # across UI and reports.
        normalized = value.strip().upper()
        if not re.fullmatch(r"[A-Z0-9\-_]+", normalized):
            raise serializers.ValidationError("Only letters, numbers, hyphens and underscores are allowed.")
        qs = VehicleGroup.objects.filter(code__iexact=normalized)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(f"'{normalized}' already exists (case-insensitive).")
        return normalized

    def validate(self, attrs):
        # RG-043: switching an existing MIXED group to UNIFORM must not be
        # allowed to bypass the uniform invariant every member-add already
        # enforces (GroupMember.clean()) -- that check only ever sees one
        # incoming member, so a whole-group audit is needed here instead.
        new_mode = attrs.get("composition_mode")
        if new_mode == VehicleGroup.CompositionMode.UNIFORM and self.instance:
            category_count = self.instance.members.filter(
                valid_to__isnull=True
            ).values("vehicle__category").distinct().count()
            if category_count > 1:
                raise serializers.ValidationError(
                    {"composition_mode": "This group has more than one category -- remove members until only one remains first."}
                )

        # RG-049: kind/composition_mode both have model defaults, so DRF
        # would otherwise silently fill in ROTATING/UNIFORM before validate()
        # ever sees a "missing" value -- check the raw payload instead.
        if self.instance is None:
            if "kind" not in self.initial_data:
                raise serializers.ValidationError({"kind": "kind is required."})
            if "composition_mode" not in self.initial_data:
                raise serializers.ValidationError({"composition_mode": "composition_mode is required."})

        # RG-044: a group's code is a handle used across rosters/reports --
        # immutable once it has any duty, published or not.
        if "code" in attrs and self.instance and attrs["code"] != self.instance.code:
            from backend.apps.roster.models import Duty
            if Duty.objects.filter(group=self.instance).exists():
                raise serializers.ValidationError(
                    {"code": "This group's code is immutable once it has duties."}
                )

        # RG-047: depot coordinates -- both or neither, and within real range.
        lat, lon = attrs.get("home_latitude"), attrs.get("home_longitude")
        if (lat is None) != (lon is None):
            raise serializers.ValidationError("Provide both home_latitude and home_longitude, or neither.")
        if lat is not None and not (-90 <= lat <= 90):
            raise serializers.ValidationError({"home_latitude": "Must be between -90 and 90."})
        if lon is not None and not (-180 <= lon <= 180):
            raise serializers.ValidationError({"home_longitude": "Must be between -180 and 180."})

        return attrs


class GroupDriverAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = GroupDriverAssignment
        fields = ["id", "group", "driver_user_id", "valid_from", "valid_to"]
        # group is injected server-side by GroupDriverAssignmentViewSet.perform_create()
        # from the URL's group_pk, same pattern as GroupMemberSerializer.group.
        read_only_fields = ["id", "group", "valid_from", "valid_to"]

    def validate(self, attrs):
        # RG-077: driver_user_id is deliberately a bare UUID, not an FK
        # (User lives in the shared schema) -- with no existence check at
        # all, a nonexistent id fell through to clean()'s duplicate-assignment
        # check and produced a misleading "already assigned" message instead.
        from django_tenants.utils import schema_context
        from backend.apps.users.models import User
        with schema_context("public"):
            if not User.objects.filter(id=attrs["driver_user_id"]).exists():
                raise serializers.ValidationError({"driver_user_id": "No user with this id exists."})

        instance = GroupDriverAssignment(group=self.context["group"], driver_user_id=attrs["driver_user_id"])
        try:
            instance.clean()
        except DjangoValidationError as e:
            raise serializers.ValidationError({"driver_user_id": e.messages})
        return attrs


class GroupConductorAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = GroupConductorAssignment
        fields = ["id", "group", "conductor_user_id", "valid_from", "valid_to"]
        # group is injected server-side by GroupConductorAssignmentViewSet.perform_create()
        # from the URL's group_pk, same pattern as GroupDriverAssignmentSerializer.group.
        read_only_fields = ["id", "group", "valid_from", "valid_to"]

    def validate(self, attrs):
        # RG-077: same gap as GroupDriverAssignmentSerializer -- see there.
        from django_tenants.utils import schema_context
        from backend.apps.users.models import User
        with schema_context("public"):
            if not User.objects.filter(id=attrs["conductor_user_id"]).exists():
                raise serializers.ValidationError({"conductor_user_id": "No user with this id exists."})

        instance = GroupConductorAssignment(group=self.context["group"], conductor_user_id=attrs["conductor_user_id"])
        try:
            instance.clean()
        except DjangoValidationError as e:
            raise serializers.ValidationError({"conductor_user_id": e.messages})
        return attrs


class GroupCompositionRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = GroupCompositionRule
        fields = [
            "id", "group", "allow_mixed", "group_size", "max_categories_per_group",
            "capacity_spread_limit", "permit_class_match", "required_composition", "spares_allowed",
        ]
        read_only_fields = ["id"]
