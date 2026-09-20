import uuid
from django.db import models
from django.utils import timezone


class Vehicle(models.Model):
    class FuelType(models.TextChoices):
        DIESEL = "DIESEL", "Diesel"
        PETROL = "PETROL", "Petrol"
        CNG = "CNG", "CNG"
        ELECTRIC = "ELECTRIC", "Electric"
        HYBRID = "HYBRID", "Hybrid"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        AVAILABLE = "AVAILABLE", "Available"
        ASSIGNED = "ASSIGNED", "Assigned"
        IN_SERVICE = "IN_SERVICE", "In Service"
        IN_MAINTENANCE = "IN_MAINTENANCE", "In Maintenance"
        INACTIVE = "INACTIVE", "Inactive"
        RETIRED = "RETIRED", "Retired"
        BREAKDOWN = "BREAKDOWN", "Breakdown"
        RESERVE = "RESERVE", "Reserve"

    class VehicleType(models.TextChoices):
        BUS = "BUS", "Bus"
        MICROBUS = "MICROBUS", "Microbus"
        MINIBUS = "MINIBUS", "Minibus"
        TEMPO = "TEMPO", "Tempo"
        ELECTRIC_BUS = "ELECTRIC_BUS", "Electric Bus"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    registration_no = models.CharField(max_length=20, unique=True)
    bus_number = models.CharField(max_length=20, blank=True, help_text="Display bus number (e.g. Bus 1, KV-001)")

    # ── Basic Info ───────────────────────────────────────────────
    vehicle_type = models.CharField(max_length=15, choices=VehicleType.choices, default=VehicleType.BUS)
    make = models.CharField(max_length=100)
    model = models.CharField(max_length=100)
    year = models.PositiveSmallIntegerField()
    color = models.CharField(max_length=50, blank=True)

    # ── Vehicle Identification ───────────────────────────────────
    chassis_no = models.CharField(max_length=50, unique=True)
    engine_no = models.CharField(max_length=50, blank=True)

    # ── Capacity & Specs ─────────────────────────────────────────
    capacity_seated = models.PositiveSmallIntegerField()
    capacity_standing = models.PositiveSmallIntegerField(default=0)
    fuel_type = models.CharField(max_length=10, choices=FuelType.choices, default=FuelType.DIESEL)
    engine_capacity_cc = models.PositiveIntegerField(null=True, blank=True)

    # ── Ownership ────────────────────────────────────────────────
    # owner_name/owner_phone stay as free-text display fallback for existing
    # data; `owner` is the real, structured link -- nullable so existing
    # fleets keep working unassigned until an admin links one, same reasoning
    # `category` below already uses on this exact model.
    owner_name = models.CharField(max_length=255, blank=True)
    owner_phone = models.CharField(max_length=20, blank=True)
    owner = models.ForeignKey(
        "Owner", null=True, blank=True, on_delete=models.SET_NULL, related_name="vehicles"
    )

    # ── Category ─────────────────────────────────────────────────
    # Nullable so existing fleets keep working uncategorised until an admin
    # assigns one -- see VehicleCategory below. A vehicle must have a
    # category before it can join a VehicleGroup (GroupMember.clean()).
    category = models.ForeignKey(
        "VehicleCategory", null=True, blank=True, on_delete=models.PROTECT, related_name="vehicles"
    )

    # ── Operational ──────────────────────────────────────────────
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    assigned_route_id = models.UUIDField(null=True, blank=True)
    current_driver_id = models.UUIDField(null=True, blank=True)
    current_conductor_id = models.UUIDField(null=True, blank=True)
    gps_device_id = models.CharField(max_length=50, blank=True)
    odometer_km = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    # ── System ───────────────────────────────────────────────────
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by_id = models.UUIDField(null=True, blank=True)

    class Meta:
        ordering = ["registration_no"]
        indexes = [
            models.Index(fields=["registration_no"]),
            models.Index(fields=["status"]),
            models.Index(fields=["is_deleted"]),
        ]

    def __str__(self):
        return f"{self.registration_no} - {self.make} {self.model}"

    @property
    def is_available_for_trip(self):
        if self.status not in [self.Status.ACTIVE]:
            return False
        # Check insurance validity
        valid_insurance = self.documents.filter(
            doc_type=VehicleDocument.DocType.INSURANCE,
            expiry_date__gte=timezone.now().date(),
        ).exists()
        if not valid_insurance:
            return False
        from backend.apps.maintenance.models import MaintenanceSchedule

        overdue_maintenance = MaintenanceSchedule.objects.filter(
            vehicle_id=self.id, status=MaintenanceSchedule.Status.OVERDUE
        ).exists()
        return not overdue_maintenance


class Owner(models.Model):
    """A bus owner -- Team Implementation Guide §3.7. A tenant's fleet can include
    buses belonging to several different owners; this is what a bus owner's own
    dashboard is scoped by. Deliberately separate from Vehicle.owner_name/
    owner_phone (kept as free-text display fallback) -- this is the real,
    structured link, and the thing an owner's own login is tied to."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    # Links to the shared-schema User who can log in and see this owner's own
    # dashboard -- bare UUID, not FK, matching staff.Driver/Conductor's own
    # established convention for referencing a User from a tenant-scoped model.
    user_id = models.UUIDField(null=True, blank=True, unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by_id = models.UUIDField(null=True, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class VehicleDocument(models.Model):
    class DocType(models.TextChoices):
        BLUEBOOK = "BLUEBOOK", "Bluebook (Nagarik Praman Patra)"
        INSURANCE = "INSURANCE", "Insurance"
        POLLUTION = "POLLUTION", "Pollution Certificate"
        ROUTE_PERMIT = "ROUTE_PERMIT", "Route Permit"
        TAX = "TAX", "Tax Receipt"
        FITNESS = "FITNESS", "Fitness / Inspection Certificate"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE, related_name="documents")
    doc_type = models.CharField(max_length=15, choices=DocType.choices)
    doc_no = models.CharField(max_length=100)
    issued_date = models.DateField()
    expiry_date = models.DateField()
    file = models.FileField(upload_to="vehicle_docs/", null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["vehicle", "doc_type"]),
            models.Index(fields=["expiry_date"]),
        ]

    def __str__(self):
        return f"{self.vehicle.registration_no} - {self.doc_type}"

    @property
    def days_to_expiry(self):
        delta = self.expiry_date - timezone.now().date()
        return delta.days


class VehicleInsurance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE, related_name="insurances")
    provider = models.CharField(max_length=255)
    policy_no = models.CharField(max_length=100)
    coverage_amount = models.DecimalField(max_digits=12, decimal_places=2)
    premium = models.DecimalField(max_digits=10, decimal_places=2)
    start_date = models.DateField()
    end_date = models.DateField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-start_date"]
        indexes = [models.Index(fields=["vehicle", "end_date"])]


class VehicleGPS(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        INACTIVE = "INACTIVE", "Inactive"
        FAULT = "FAULT", "Fault"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle = models.OneToOneField(Vehicle, on_delete=models.CASCADE, related_name="gps_device")
    device_id = models.CharField(max_length=50, unique=True)
    imei = models.CharField(max_length=20, unique=True)
    provider = models.CharField(max_length=100)
    sim_no = models.CharField(max_length=20, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    installed_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"GPS {self.device_id} - {self.vehicle.registration_no}"


class VehicleCategory(models.Model):
    """An operator-defined class of bus (e.g. "Deluxe AC 35-seat"), reused
    across every vehicle and group of that class. Route/Driver -Sha-requirements/
    route-group-rotation-documentation.docx section 4.2 -- the properties here
    decide route eligibility, fare class and capacity planning, so a category
    change is meant to be deliberate, not a casual tag edit."""
    class BodyClass(models.TextChoices):
        MICRO = "MICRO", "Micro"
        MINI = "MINI", "Mini"
        STANDARD = "STANDARD", "Standard"
        DELUXE = "DELUXE", "Deluxe"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=20, unique=True, help_text="Short handle, e.g. DLX-35")
    name_en = models.CharField(max_length=255)
    name_ne = models.CharField(max_length=255, blank=True)
    seating_capacity = models.PositiveSmallIntegerField()
    body_class = models.CharField(max_length=10, choices=BodyClass.choices, default=BodyClass.STANDARD)
    air_conditioned = models.BooleanField(default=False)
    fuel_type = models.CharField(max_length=10, choices=Vehicle.FuelType.choices, default=Vehicle.FuelType.DIESEL)
    permit_class = models.CharField(max_length=50, blank=True)
    attributes = models.JSONField(default=dict, blank=True, help_text="Open extension: low floor, luggage rack, WiFi")
    is_active = models.BooleanField(default=True)
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by_id = models.UUIDField(null=True, blank=True)

    class Meta:
        ordering = ["code"]
        verbose_name_plural = "vehicle categories"
        indexes = [models.Index(fields=["is_deleted"])]

    def __str__(self):
        return f"{self.code} - {self.name_en}"


class VehicleGroup(models.Model):
    """A set of vehicles that move together, usually four -- the unit of
    assignment to a route (Route/Group Rotation doc section 3.3). The
    capability_* fields are a derived profile, never entered by hand -- see
    GroupMember.save()/delete() below, which recompute them on every
    membership change."""
    class Kind(models.TextChoices):
        ROTATING = "ROTATING", "Rotating"
        FIXED = "FIXED", "Fixed"
        RESERVE = "RESERVE", "Reserve"

    class CompositionMode(models.TextChoices):
        UNIFORM = "UNIFORM", "Uniform"
        MIXED = "MIXED", "Mixed"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        INACTIVE = "INACTIVE", "Inactive"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=20, unique=True, help_text="Short handle, e.g. G-03")
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.ROTATING)
    composition_mode = models.CharField(max_length=10, choices=CompositionMode.choices, default=CompositionMode.UNIFORM)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)

    # Stable position on the P1 auto-rotation's slot ring (doc section 7.2),
    # assigned lazily on first rotation and never reassigned afterwards --
    # doc section 16: "Group added or removed mid-cycle -- stable ring
    # positions; the new group takes the vacant position without
    # reshuffling everyone."
    ring_position = models.PositiveIntegerField(null=True, blank=True)

    # P3: this group's home depot, for the rotation engine's optional
    # depot_proximity cost term (doc section 8, default OFF) -- same
    # DecimalField shape as platform.Stop's lat/lng, not a separate Depot
    # model, since the doc talks about "the group's depot" (one coordinate
    # pair per group), not a shared multi-group entity.
    home_latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    home_longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)

    # ── Derived capability profile (section 4.6) -- recomputed by
    # GroupMember, never written directly elsewhere. ──────────────────────
    capability_min_seats = models.PositiveSmallIntegerField(default=0)
    capability_total_seats = models.PositiveIntegerField(default=0)
    capability_all_ac = models.BooleanField(default=False)
    capability_ac_count = models.PositiveSmallIntegerField(default=0)
    capability_categories = models.JSONField(default=dict, blank=True, help_text="{category_code: member_count}")
    capability_permit_classes = models.JSONField(default=list, blank=True)
    capability_computed_at = models.DateTimeField(null=True, blank=True)

    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by_id = models.UUIDField(null=True, blank=True)

    class Meta:
        ordering = ["code"]
        indexes = [models.Index(fields=["is_deleted"]), models.Index(fields=["kind"])]

    def __str__(self):
        return self.code

    def recompute_capability(self):
        """Rebuilds the derived profile from every currently-open membership
        that's actually operational right now. Called by GroupMember.save()/
        delete(), and (RG-052) by VehicleViewSet.perform_update() whenever a
        member vehicle's status changes -- a bus sent to maintenance/retired/
        breakdown doesn't contribute real capacity even though its GroupMember
        row stays open (the membership itself is a separate, longer-lived
        concept from whether the bus can run today)."""
        operational_statuses = (Vehicle.Status.ACTIVE, Vehicle.Status.AVAILABLE)
        if self.kind == VehicleGroup.Kind.RESERVE:
            operational_statuses += (Vehicle.Status.RESERVE,)
        members = self.members.filter(
            valid_to__isnull=True, vehicle__status__in=operational_statuses
        ).select_related("vehicle", "vehicle__category")
        categories = {}
        permit_classes = set()
        seats = []
        ac_count = 0
        for m in members:
            cat = m.vehicle.category
            if cat is None:
                continue
            categories[cat.code] = categories.get(cat.code, 0) + 1
            if cat.permit_class:
                permit_classes.add(cat.permit_class)
            seats.append(cat.seating_capacity)
            if cat.air_conditioned:
                ac_count += 1

        self.capability_min_seats = min(seats) if seats else 0
        self.capability_total_seats = sum(seats)
        self.capability_all_ac = bool(seats) and ac_count == len(seats)
        self.capability_ac_count = ac_count
        self.capability_categories = categories
        self.capability_permit_classes = sorted(permit_classes)
        self.capability_computed_at = timezone.now()
        self.save(update_fields=[
            "capability_min_seats", "capability_total_seats", "capability_all_ac",
            "capability_ac_count", "capability_categories", "capability_permit_classes",
            "capability_computed_at",
        ])


class GroupCompositionRule(models.Model):
    """The rule set a group's membership is checked against, applied at
    group creation and at every membership change (doc section 4.5). A row
    with group=None is the operator-wide default; a row with group set
    overrides it for that one group."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    group = models.OneToOneField(VehicleGroup, null=True, blank=True, on_delete=models.CASCADE, related_name="composition_rule")
    allow_mixed = models.BooleanField(default=True)
    group_size = models.PositiveSmallIntegerField(default=4)
    max_categories_per_group = models.PositiveSmallIntegerField(default=2)
    capacity_spread_limit = models.PositiveSmallIntegerField(default=15, help_text="Largest allowed seat gap between the biggest and smallest member")
    permit_class_match = models.BooleanField(default=True)
    required_composition = models.JSONField(null=True, blank=True, help_text="Optional template, e.g. {'DLX-35': 2, 'STD-40': 2}")
    spares_allowed = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Composition rule for {self.group.code}" if self.group_id else "Operator-wide default"


class GroupMember(models.Model):
    """One vehicle's membership in a group, time-ranged (doc section 13) so
    the system can always answer which buses were in a group on a given
    date. valid_to=None means the membership is currently open."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    group = models.ForeignKey(VehicleGroup, on_delete=models.CASCADE, related_name="members")
    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name="group_memberships")
    valid_from = models.DateField(auto_now_add=True)
    valid_to = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["-valid_from"]
        indexes = [models.Index(fields=["group", "valid_to"]), models.Index(fields=["vehicle", "valid_to"])]

    def __str__(self):
        return f"{self.vehicle.registration_no} in {self.group.code}"

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.valid_to is not None:
            return  # closing a membership never needs a composition check

        if GroupMember.objects.filter(vehicle=self.vehicle, valid_to__isnull=True).exclude(pk=self.pk).exists():
            raise ValidationError("This vehicle is already an open member of a group.")

        if self.vehicle.category_id is None:
            raise ValidationError("Vehicle has no category set -- assign one before adding it to a group.")

        allowed_statuses = (Vehicle.Status.ACTIVE, Vehicle.Status.AVAILABLE)
        if self.group.kind == VehicleGroup.Kind.RESERVE:
            allowed_statuses += (Vehicle.Status.RESERVE,)  # a reserve group is exactly where a reserve bus belongs
        if self.vehicle.status not in allowed_statuses:
            raise ValidationError(
                f"Vehicle is {self.vehicle.get_status_display()} -- only active/available vehicles can join a group."
            )

        # Fall back to the doc's own default values (section 4.5's "Default"
        # column) when no operator has configured a rule row yet -- an
        # unconfigured operator should still get the safe defaults, not an
        # unenforced free-for-all.
        rule = getattr(self.group, "composition_rule", None) or GroupCompositionRule.objects.filter(group__isnull=True).first()
        if rule is None:
            rule = GroupCompositionRule(group=None)  # unsaved, doc defaults from the field definitions apply

        existing = list(
            GroupMember.objects.filter(group=self.group, valid_to__isnull=True)
            .exclude(pk=self.pk)
            .select_related("vehicle__category")
        )
        prospective_categories = {m.vehicle.category for m in existing if m.vehicle.category_id}
        prospective_categories.add(self.vehicle.category)

        if self.group.composition_mode == VehicleGroup.CompositionMode.UNIFORM and len(prospective_categories) > 1:
            raise ValidationError("This group is uniform -- every member must share one category.")

        if not rule.allow_mixed and len(prospective_categories) > 1:
            raise ValidationError("Mixed-category groups are not allowed by the current composition rule.")

        if len(prospective_categories) > rule.max_categories_per_group:
            raise ValidationError(
                f"Adding this vehicle would bring the group to {len(prospective_categories)} categories, "
                f"more than the max of {rule.max_categories_per_group} allowed."
            )

        seats = [c.seating_capacity for c in prospective_categories]
        spread = max(seats) - min(seats)
        if spread > rule.capacity_spread_limit:
            raise ValidationError(
                f"Adding this vehicle would create a {spread}-seat spread between the largest and smallest "
                f"member, more than the {rule.capacity_spread_limit}-seat limit."
            )

        if rule.permit_class_match:
            permit_classes = {c.permit_class for c in prospective_categories if c.permit_class}
            if len(permit_classes) > 1:
                raise ValidationError("All members must share a permit class.")

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        self.group.recompute_capability()

    def delete(self, *args, **kwargs):
        group = self.group
        super().delete(*args, **kwargs)
        group.recompute_capability()


class GroupDriverAssignment(models.Model):
    """A driver's standing crew binding to a group (Route/Group Rotation doc
    section 5.3 notes crew binding "shares the same group structure" but
    doesn't name a table for it -- this mirrors GroupMember's time-ranged
    shape since it's the same concept applied to a driver instead of a
    vehicle). Lets the driver view (doc section 15) resolve "this driver's
    group" without depending on any per-day dispatch record. driver_user_id
    is a bare UUID, not an FK, since User lives in the shared schema."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    group = models.ForeignKey(VehicleGroup, on_delete=models.CASCADE, related_name="driver_assignments")
    driver_user_id = models.UUIDField()
    valid_from = models.DateField(auto_now_add=True)
    valid_to = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["-valid_from"]
        indexes = [models.Index(fields=["group", "valid_to"]), models.Index(fields=["driver_user_id", "valid_to"])]

    def __str__(self):
        return f"Driver {self.driver_user_id} in {self.group.code}"

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.valid_to is not None:
            return

        if GroupDriverAssignment.objects.filter(
            driver_user_id=self.driver_user_id, valid_to__isnull=True
        ).exclude(pk=self.pk).exists():
            raise ValidationError("This driver is already assigned to a group.")


class GroupConductorAssignment(models.Model):
    """A conductor's standing crew binding to a group -- same shape as
    GroupDriverAssignment, added for Slice 6 (P3 crew_hours) since the doc's
    "where crew is bound" needs both drivers and conductors covered, and no
    conductor-to-group link existed. conductor_user_id is a bare UUID, not an
    FK, since User lives in the shared schema -- same convention as
    driver_user_id."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    group = models.ForeignKey(VehicleGroup, on_delete=models.CASCADE, related_name="conductor_assignments")
    conductor_user_id = models.UUIDField()
    valid_from = models.DateField(auto_now_add=True)
    valid_to = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["-valid_from"]
        indexes = [
            models.Index(fields=["group", "valid_to"]),
            models.Index(fields=["conductor_user_id", "valid_to"]),
        ]

    def __str__(self):
        return f"Conductor {self.conductor_user_id} in {self.group.code}"

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.valid_to is not None:
            return

        if GroupConductorAssignment.objects.filter(
            conductor_user_id=self.conductor_user_id, valid_to__isnull=True
        ).exclude(pk=self.pk).exists():
            raise ValidationError("This conductor is already assigned to a group.")
