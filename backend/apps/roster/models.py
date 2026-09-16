import uuid
from datetime import date as date_cls

from django.db import models


class RotationPolicy(models.Model):
    """The parameters driving the P1 auto-rotation (doc section 7.1-7.2, 9,
    16). A single operator-wide row for now -- per-route/per-group scoping
    (doc's policy_scope) and the full weighted rule engine are P2 ("turns
    preferences into configuration rather than code"); P1's two rules stay
    in code with configurable parameters only."""
    class WeekPattern(models.TextChoices):
        KEEP_ROTATING = "KEEP_ROTATING", "Keep rotating"
        REPEAT_WEEK = "REPEAT_WEEK", "Repeat the week"
        ROTATING_REPEAT = "ROTATING_REPEAT", "Rotating repeat"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ring_step = models.PositiveSmallIntegerField(default=1)
    week_pattern = models.CharField(max_length=20, choices=WeekPattern.choices, default=WeekPattern.KEEP_ROTATING)
    week_step = models.PositiveSmallIntegerField(default=1, help_text="Extra shift applied once per week -- ROTATING_REPEAT only")
    epoch_date = models.DateField(default=date_cls.today, help_text="Fixed reference date all shift arithmetic counts from")
    same_weekday_lookback_weeks = models.PositiveSmallIntegerField(default=1, help_text="no_same_route_same_weekday, HARD")
    route_cooldown_days = models.PositiveSmallIntegerField(default=3, help_text="route_cooldown_days, SOFT")

    # P2 (doc section 7.4/8): weighted soft-rule terms feeding the cost
    # model. A weight of 0 turns that rule off -- "there is no separate code
    # path for each operator preference," per the doc.
    rotation_preference_weight = models.PositiveSmallIntegerField(
        default=3, help_text="Cost of deviating from the ring's predicted slot"
    )
    route_cooldown_weight = models.PositiveSmallIntegerField(default=1)
    max_consecutive_days_same_route = models.PositiveSmallIntegerField(default=2)
    consecutive_weight = models.PositiveSmallIntegerField(default=2)
    fair_share_weight = models.PositiveSmallIntegerField(default=1)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Rotation policy (step={self.ring_step}, {self.week_pattern})"


class RosterPeriod(models.Model):
    """A dated range of duties, moving through draft/published/closed (Route/
    Group Rotation doc section 3.7). Published periods are immutable
    snapshots -- changes after publication are recorded as DutyOverride rows
    layered on top, never as edits underneath (doc section 12)."""
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PUBLISHED = "PUBLISHED", "Published"
        CLOSED = "CLOSED", "Closed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    version = models.PositiveSmallIntegerField(default=1)
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by_id = models.UUIDField(null=True, blank=True)

    class Meta:
        ordering = ["-start_date"]
        indexes = [models.Index(fields=["is_deleted"]), models.Index(fields=["status"])]

    def __str__(self):
        return f"{self.start_date} to {self.end_date} ({self.status})"


class Duty(models.Model):
    """One group bound to one slot on one service date -- the atomic
    scheduled unit (doc section 3.6). route_id is a bare UUID since Route
    lives in the shared schema (same convention as RouteRequirement).
    group=None means the slot is still unassigned/open."""
    class Source(models.TextChoices):
        MANUAL = "MANUAL", "Manual"
        GENERATED = "GENERATED", "Generated"
        OVERRIDE = "OVERRIDE", "Override"
        RESERVE_FILL = "RESERVE_FILL", "Reserve Fill"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    roster_period = models.ForeignKey(RosterPeriod, on_delete=models.CASCADE, related_name="duties")
    service_date = models.DateField()
    route_id = models.UUIDField()
    slot_index = models.PositiveSmallIntegerField()
    group = models.ForeignKey(
        "fleet.VehicleGroup", null=True, blank=True, on_delete=models.PROTECT, related_name="duties"
    )
    source = models.CharField(max_length=15, choices=Source.choices, default=Source.MANUAL)
    locked = models.BooleanField(default=False, help_text="Protects this cell from reassignment via the grid")
    cost_breakdown = models.JSONField(
        default=dict, blank=True,
        help_text="P2: the weighted cost components that produced this assignment (GENERATED duties only), for the explain endpoint",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["service_date", "route_id", "slot_index"]
        unique_together = [["roster_period", "service_date", "route_id", "slot_index"]]
        indexes = [
            models.Index(fields=["roster_period", "service_date"]),
            models.Index(fields=["group", "service_date"]),
        ]

    def __str__(self):
        return f"Duty {self.service_date} slot {self.slot_index} -> {self.group_id or 'unassigned'}"


class DutyOverride(models.Model):
    """Append-only audit trail of a group change on an already-published
    duty (doc section 12): effective_roster = published_baseline +
    override_layer. Never created directly by the API -- written
    automatically by DutyViewSet.partial_update() when the parent period is
    already PUBLISHED."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    duty = models.ForeignKey(Duty, on_delete=models.CASCADE, related_name="overrides")
    previous_group = models.ForeignKey(
        "fleet.VehicleGroup", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    new_group = models.ForeignKey(
        "fleet.VehicleGroup", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    reason = models.TextField()
    actor_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Override on duty {self.duty_id} at {self.created_at}"


class VehicleSubstitution(models.Model):
    """An in-group vehicle swap on a duty (doc section 4.12/11.2) -- e.g. a
    bus breaks down and a reserve takes its place inside the group. The
    duty/chart/driver assignment are all untouched."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    duty = models.ForeignKey(Duty, on_delete=models.CASCADE, related_name="substitutions")
    out_vehicle = models.ForeignKey(
        "fleet.Vehicle", on_delete=models.PROTECT, related_name="substitutions_out"
    )
    in_vehicle = models.ForeignKey(
        "fleet.Vehicle", on_delete=models.PROTECT, related_name="substitutions_in"
    )
    reason = models.TextField()
    actor_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Substitution on duty {self.duty_id}: {self.out_vehicle_id} -> {self.in_vehicle_id}"
