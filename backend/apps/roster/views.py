from collections import defaultdict
from datetime import timedelta

from django.db.models import Max, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import views
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from backend.apps.users.permissions import IsOperationsRole, CanViewVehicles, IsDriver
from . import services
from .models import RosterPeriod, Duty, DutyOverride, VehicleSubstitution, RotationPolicy
from .serializers import (
    RosterPeriodSerializer, DutySerializer, VehicleSubstitutionSerializer, RotationPolicySerializer,
)


def _get_or_create_policy():
    """A single operator-wide RotationPolicy row (doc section 8/9's P1
    parameters) -- created with its field defaults on first use, same
    fetch-or-create convention as fleet.GroupCompositionRule's default row."""
    policy = RotationPolicy.objects.order_by("created_at").first()
    if policy is None:
        policy = RotationPolicy.objects.create()
    return policy


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success,
        "data": data,
        "message": message,
        "errors": errors,
        "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


def _compute_conflicts(period):
    """Doc section 5.7's conflict panel, and section 8's HARD rules narrowed
    to what P0 can actually check without a rotation engine: every duty must
    have a group, that group must be eligible for the route, no group
    double-booked on a service date, no RESERVE group on a non-surge duty,
    and no assigned vehicle with an expired document as of the duty date."""
    from backend.apps.fleet.models import VehicleGroup, VehicleDocument
    from backend.apps.fleet.services import check_group_route_eligibility
    from django_tenants.utils import schema_context
    from backend.apps.platform.models import Route

    duties = list(period.duties.select_related("group").all())
    conflicts = []

    route_ids = {d.route_id for d in duties}
    with schema_context("public"):
        routes_by_id = {
            r.id: r for r in Route.objects.filter(id__in=route_ids).select_related("requirement")
        }

    by_group_date = defaultdict(list)
    for d in duties:
        if d.group_id:
            by_group_date[(d.group_id, d.service_date)].append(d)

    group_members_cache = {}
    all_vehicle_ids = set()
    for d in duties:
        if d.group_id and d.group_id not in group_members_cache:
            members = list(d.group.members.filter(valid_to__isnull=True).select_related("vehicle"))
            group_members_cache[d.group_id] = members
            all_vehicle_ids.update(m.vehicle_id for m in members)

    docs_by_vehicle = defaultdict(list)
    for doc in VehicleDocument.objects.filter(vehicle_id__in=all_vehicle_ids, is_deleted=False):
        docs_by_vehicle[doc.vehicle_id].append(doc)

    for d in duties:
        if d.group_id is None:
            conflicts.append({
                "duty_id": str(d.id), "severity": "hard",
                "message": f"{d.service_date} slot {d.slot_index}: no group assigned.",
            })
            continue

        route = routes_by_id.get(d.route_id)
        if route is not None:
            # allow_reserve=True: a RESERVE group sitting on a non-surge duty
            # is already caught separately below, with a clearer message.
            ok, reasons = check_group_route_eligibility(d.group, route, allow_reserve=True)
            if not ok:
                for r in reasons:
                    conflicts.append({
                        "duty_id": str(d.id), "severity": "hard",
                        "message": f"{d.group.code} on {d.service_date}: {r}",
                    })

        if d.group.kind == VehicleGroup.Kind.RESERVE and d.source != Duty.Source.RESERVE_FILL:
            conflicts.append({
                "duty_id": str(d.id), "severity": "hard",
                "message": f"{d.group.code} is a reserve group and can't be assigned to a regular duty.",
            })

        if len(by_group_date.get((d.group_id, d.service_date), [])) > 1:
            conflicts.append({
                "duty_id": str(d.id), "severity": "hard",
                "message": f"{d.group.code} is assigned to more than one duty on {d.service_date}.",
            })

        for m in group_members_cache.get(d.group_id, []):
            for doc in docs_by_vehicle.get(m.vehicle_id, []):
                if doc.expiry_date < d.service_date:
                    conflicts.append({
                        "duty_id": str(d.id), "severity": "hard",
                        "message": (
                            f"{m.vehicle.registration_no}'s {doc.get_doc_type_display()} expires "
                            f"{doc.expiry_date}, before this duty's {d.service_date}."
                        ),
                    })

    # Doc section 8's two P1 rotation rules -- checked across every period
    # in the tenant, not just this one, since the constraint is about
    # calendar weeks/days, not period boundaries.
    policy = _get_or_create_policy()
    assigned = [d for d in duties if d.group_id]
    if assigned:
        group_ids = {d.group_id for d in assigned}
        route_ids_assigned = {d.route_id for d in assigned}
        lookback_days = max(policy.same_weekday_lookback_weeks * 7, policy.route_cooldown_days)
        lookback_start = min(d.service_date for d in assigned) - timedelta(days=lookback_days)

        history = defaultdict(list)
        for hd in Duty.objects.filter(
            group_id__in=group_ids, route_id__in=route_ids_assigned,
            service_date__gte=lookback_start, roster_period__is_deleted=False,
        ).values("id", "group_id", "route_id", "service_date"):
            history[(hd["group_id"], hd["route_id"])].append((hd["service_date"], hd["id"]))

        for d in assigned:
            route_code = getattr(routes_by_id.get(d.route_id), "route_code", d.route_id)
            for other_date, other_id in history.get((d.group_id, d.route_id), []):
                if other_id == d.id or other_date >= d.service_date:
                    continue
                gap_days = (d.service_date - other_date).days
                if gap_days <= policy.same_weekday_lookback_weeks * 7 and other_date.weekday() == d.service_date.weekday():
                    conflicts.append({
                        "duty_id": str(d.id), "severity": "hard",
                        "message": (
                            f"{d.group.code} already ran {route_code} on {other_date} "
                            f"({other_date.strftime('%A')}), {gap_days} day(s) before this duty -- "
                            f"same weekday within {policy.same_weekday_lookback_weeks} week(s)."
                        ),
                    })
                elif gap_days <= policy.route_cooldown_days:
                    conflicts.append({
                        "duty_id": str(d.id), "severity": "soft",
                        "message": (
                            f"{d.group.code} ran {route_code} on {other_date}, only {gap_days} day(s) "
                            f"before this duty (cooldown is {policy.route_cooldown_days} days)."
                        ),
                    })

    return conflicts


class RosterPeriodViewSet(ModelViewSet):
    serializer_class = RosterPeriodSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve", "conflicts"):
            return [CanViewVehicles()]
        return [IsOperationsRole()]

    def get_queryset(self):
        return RosterPeriod.objects.filter(is_deleted=False)

    def _day_type_for(self, date):
        return "SATURDAY" if date.weekday() == 5 else "WEEKDAY"

    def perform_create(self, serializer):
        period = serializer.save(created_by_id=self.request.user.id)
        self._generate_duties(period)

    def _generate_duties(self, period):
        """P0's whole "generate" step (doc section 5.7's stage 1, without the
        rotation engine): one unassigned Duty per route/slot, from Slice 1's
        RouteDemand. No holiday calendar exists, so day_type is inferred as
        SATURDAY/WEEKDAY only -- HOLIDAY stays a manual per-duty call the
        planner can make later."""
        from django_tenants.utils import schema_context
        from backend.apps.platform.models import Route

        with schema_context("public"):
            routes = list(Route.objects.filter(is_deleted=False, status=Route.Status.APPROVED))
            demand_by_route_daytype = {}
            for r in routes:
                for dem in r.demand_profiles.filter(effective_to__isnull=True):
                    demand_by_route_daytype[(r.id, dem.day_type)] = dem.slot_count

        num_days = (period.end_date - period.start_date).days + 1
        duties = []
        for i in range(num_days):
            date = period.start_date + timedelta(days=i)
            day_type = self._day_type_for(date)
            for r in routes:
                slot_count = demand_by_route_daytype.get((r.id, day_type), 0)
                for slot_index in range(slot_count):
                    duties.append(Duty(
                        roster_period=period, service_date=date, route_id=r.id,
                        slot_index=slot_index, group=None, source=Duty.Source.MANUAL,
                    ))
        Duty.objects.bulk_create(duties)

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["is_deleted", "deleted_at"])

    @action(detail=True, methods=["get"], url_path="conflicts")
    def conflicts(self, request, pk=None):
        period = self.get_object()
        return api_response(data=_compute_conflicts(period))

    @action(detail=True, methods=["post"], url_path="publish")
    def publish(self, request, pk=None):
        period = self.get_object()
        if period.status == RosterPeriod.Status.CLOSED:
            return api_response(success=False, message="Closed periods can't be republished.", status_code=400)

        conflicts = _compute_conflicts(period)
        hard = [c for c in conflicts if c["severity"] == "hard"]
        if hard:
            return api_response(
                success=False,
                message=f"{len(hard)} conflict(s) must be resolved before publishing.",
                data={"conflicts": hard},
                status_code=400,
            )

        was_published = period.status == RosterPeriod.Status.PUBLISHED
        period.status = RosterPeriod.Status.PUBLISHED
        if was_published:
            period.version += 1
        period.save(update_fields=["status", "version"])
        return api_response(data=RosterPeriodSerializer(period).data, message="Roster period published.")

    @action(detail=True, methods=["post"], url_path="rotate")
    def rotate(self, request, pk=None):
        """
        POST /roster/periods/{id}/rotate/
        P1's whole "generate" step (doc section 7.1-7.2): lay out each
        day_type's slots on a ring, shift every rotating group's stable
        ring position by the policy's step/week-pattern, and assign
        whichever duty lands on each group's position that day. Never
        touches a locked duty or one a planner already set by hand
        (source MANUAL/OVERRIDE/RESERVE_FILL) -- only unassigned duties or
        ones a previous rotate itself produced (source GENERATED). No
        repair pass: this can and will produce same-weekday/cooldown
        conflicts (doc section 7.3), surfaced via the conflicts action for
        the planner to fix by hand -- P2 is what would fix them automatically.
        """
        period = self.get_object()
        if period.status == RosterPeriod.Status.CLOSED:
            return api_response(success=False, message="Closed periods can't be rotated.", status_code=400)

        from backend.apps.fleet.models import VehicleGroup
        from django_tenants.utils import schema_context
        from backend.apps.platform.models import Route

        policy = _get_or_create_policy()

        editable_duties = list(period.duties.filter(locked=False).filter(
            Q(group__isnull=True) | Q(source=Duty.Source.GENERATED)
        ))
        if not editable_duties:
            return api_response(
                data={"updated": 0, "conflicts": _compute_conflicts(period)},
                message="Nothing to rotate -- every duty is locked or already manually assigned.",
            )

        # Stable ring positions (doc section 16): assign the lowest vacant
        # integer to any ROTATING group that doesn't have one yet; groups
        # that already have one keep it, so a regenerate never reshuffles
        # existing groups when one is added or removed.
        rotating_groups = list(
            VehicleGroup.objects.filter(is_deleted=False, kind=VehicleGroup.Kind.ROTATING).order_by("code")
        )
        if not rotating_groups:
            return api_response(success=False, message="No rotating groups exist yet.", status_code=400)
        taken = {g.ring_position for g in rotating_groups if g.ring_position is not None}
        next_pos = 0
        for g in rotating_groups:
            if g.ring_position is None:
                while next_pos in taken:
                    next_pos += 1
                g.ring_position = next_pos
                taken.add(next_pos)
                g.save(update_fields=["ring_position"])

        with schema_context("public"):
            routes = Route.objects.filter(is_deleted=False, status=Route.Status.APPROVED)
            demand_rows_by_daytype = defaultdict(list)
            for r in routes:
                for dem in r.demand_profiles.filter(effective_to__isnull=True):
                    demand_rows_by_daytype[dem.day_type].append((r.id, dem.slot_count))

        ring_cache = {}

        def ring_for(day_type):
            if day_type not in ring_cache:
                ring_cache[day_type] = services.build_ring(demand_rows_by_daytype.get(day_type, []))
            return ring_cache[day_type]

        dates = sorted({d.service_date for d in editable_duties})
        day_types_touched = {self._day_type_for(date) for date in dates}

        # Coprimality check up front (doc section 7.2) -- reject before
        # touching any duty, naming a valid alternative step.
        for day_type in day_types_touched:
            ring = ring_for(day_type)
            if ring and not services.is_coprime_step(policy.ring_step, len(ring)):
                suggestion = services.smallest_coprime_step(len(ring), policy.ring_step)
                return api_response(
                    success=False,
                    message=(
                        f"Ring step {policy.ring_step} isn't coprime with the {day_type.lower()} ring "
                        f"(length {len(ring)}) -- some slots would never be reached. Try step {suggestion}."
                    ),
                    status_code=400,
                )

        target_by_key = {(d.service_date, d.route_id, d.slot_index): d for d in editable_duties}

        updated = 0
        for date in dates:
            ring = ring_for(self._day_type_for(date))
            if not ring:
                continue
            shift = services.shift_for_date(policy, date)
            for g in rotating_groups:
                slot = services.ring_slot_for_position(ring, g.ring_position + shift)
                duty = target_by_key.get((date, slot[0], slot[1])) if slot else None
                if duty is not None:
                    duty.group = g
                    duty.source = Duty.Source.GENERATED
                    duty.save(update_fields=["group", "source", "updated_at"])
                    updated += 1

        return api_response(
            data={"updated": updated, "conflicts": _compute_conflicts(period)},
            message=f"{updated} duty(ies) auto-assigned.",
        )


class DutyViewSet(ModelViewSet):
    serializer_class = DutySerializer
    http_method_names = ["get", "patch", "head", "options", "post"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [CanViewVehicles()]
        return [IsOperationsRole()]

    def get_queryset(self):
        return Duty.objects.filter(roster_period_id=self.kwargs["period_pk"]).select_related("group", "roster_period")

    def create(self, request, *args, **kwargs):
        # Duties only ever come from period generation or the surge action --
        # "post" stays in http_method_names (it gates dispatch for the whole
        # view, custom actions included) so substitute-vehicle/surge work,
        # which leaves the router's default create() route reachable too.
        return api_response(
            success=False, message="Duties are generated with the roster period; use surge to add one.",
            status_code=405,
        )

    def partial_update(self, request, *args, **kwargs):
        duty = self.get_object()
        period = duty.roster_period
        if period.status == RosterPeriod.Status.CLOSED:
            return api_response(success=False, message="This roster period is closed.", status_code=400)

        # Locking/unlocking is its own call -- a group reassignment in the
        # same request while locked is refused below rather than silently
        # allowed just because "locked" was also present.
        if "locked" in request.data and "group" not in request.data:
            duty.locked = bool(request.data["locked"])
            duty.save(update_fields=["locked", "updated_at"])
            return api_response(data=DutySerializer(duty).data, message="Duty lock updated.")

        if duty.locked:
            return api_response(
                success=False, message="This duty is locked. Unlock it before reassigning.", status_code=400
            )

        from backend.apps.fleet.models import VehicleGroup

        new_group_id = request.data.get("group")
        reason = (request.data.get("reason") or "").strip()
        was_published = period.status == RosterPeriod.Status.PUBLISHED

        if was_published and not reason:
            return api_response(
                success=False, message="A reason is required to change a duty on a published roster.",
                status_code=400,
            )

        new_group = None
        if new_group_id:
            try:
                new_group = VehicleGroup.objects.get(pk=new_group_id, is_deleted=False)
            except VehicleGroup.DoesNotExist:
                return api_response(success=False, message="Group not found.", status_code=400)

            if new_group.kind == VehicleGroup.Kind.RESERVE and duty.source != Duty.Source.RESERVE_FILL:
                return api_response(
                    success=False, message="Reserve groups can only be assigned to surge duties.", status_code=400
                )

            from django_tenants.utils import schema_context
            from backend.apps.platform.models import Route
            from backend.apps.fleet.services import check_group_route_eligibility
            with schema_context("public"):
                route = Route.objects.select_related("requirement").filter(pk=duty.route_id).first()
            if route is not None:
                # allow_reserve=True: the reserve-vs-duty-source rule was
                # already enforced above; this check is purely about route fit.
                ok, reasons = check_group_route_eligibility(new_group, route, allow_reserve=True)
                if not ok:
                    return api_response(
                        success=False, message="This group isn't eligible for this route.",
                        errors=reasons, status_code=400,
                    )

            if Duty.objects.filter(
                roster_period=period, group=new_group, service_date=duty.service_date
            ).exclude(pk=duty.pk).exists():
                return api_response(
                    success=False,
                    message=f"{new_group.code} is already assigned to another duty on {duty.service_date}.",
                    status_code=400,
                )

        previous_group = duty.group
        duty.group = new_group
        # Any human reassignment through this endpoint counts as MANUAL (or
        # OVERRIDE once published) -- never left as GENERATED, or a later
        # rotate() would treat it as fair game and silently overwrite the
        # planner's choice (rotate only touches unassigned/GENERATED duties).
        duty.source = Duty.Source.OVERRIDE if was_published else Duty.Source.MANUAL
        duty.save(update_fields=["group", "source", "updated_at"])

        if was_published:
            DutyOverride.objects.create(
                duty=duty, previous_group=previous_group, new_group=new_group,
                reason=reason, actor_id=request.user.id,
            )

        return api_response(data=DutySerializer(duty).data, message="Duty updated.")

    @action(detail=True, methods=["post"], url_path="substitute-vehicle")
    def substitute_vehicle(self, request, pk=None, **kwargs):
        duty = self.get_object()
        if duty.group_id is None:
            return api_response(success=False, message="This duty has no group assigned yet.", status_code=400)

        out_vehicle_id = request.data.get("out_vehicle")
        in_vehicle_id = request.data.get("in_vehicle")
        reason = (request.data.get("reason") or "").strip()
        if not (out_vehicle_id and in_vehicle_id):
            return api_response(success=False, message="out_vehicle and in_vehicle are required.", status_code=400)
        if not reason:
            return api_response(success=False, message="A reason is required for a vehicle substitution.", status_code=400)

        from backend.apps.fleet.models import Vehicle, GroupMember
        from backend.apps.fleet.services import (
            check_substitution_composition, compute_prospective_capability, check_group_route_eligibility,
        )

        try:
            out_vehicle = Vehicle.objects.get(pk=out_vehicle_id)
            in_vehicle = Vehicle.objects.get(pk=in_vehicle_id)
        except Vehicle.DoesNotExist:
            return api_response(success=False, message="Vehicle not found.", status_code=400)

        if not GroupMember.objects.filter(group=duty.group, vehicle=out_vehicle, valid_to__isnull=True).exists():
            return api_response(
                success=False,
                message=f"{out_vehicle.registration_no} isn't currently a member of {duty.group.code}.",
                status_code=400,
            )

        if GroupMember.objects.filter(vehicle=in_vehicle, valid_to__isnull=True).exists():
            return api_response(
                success=False,
                message=f"{in_vehicle.registration_no} is already an open member of another group.",
                status_code=400,
            )

        ok, reasons = check_substitution_composition(duty.group, out_vehicle, in_vehicle)
        if not ok:
            return api_response(success=False, message="Composition test failed.", errors=reasons, status_code=400)

        from django_tenants.utils import schema_context
        from backend.apps.platform.models import Route
        with schema_context("public"):
            route = Route.objects.select_related("requirement").filter(pk=duty.route_id).first()

        if route is not None:
            cap = compute_prospective_capability(duty.group, out_vehicle, in_vehicle)
            stub_group = type("GroupStub", (), cap)()
            ok, reasons = check_group_route_eligibility(stub_group, route)
            if not ok:
                return api_response(success=False, message="Eligibility test failed.", errors=reasons, status_code=400)

        VehicleSubstitution.objects.create(
            duty=duty, out_vehicle=out_vehicle, in_vehicle=in_vehicle,
            reason=reason, actor_id=request.user.id,
        )
        membership = GroupMember.objects.get(group=duty.group, vehicle=out_vehicle, valid_to__isnull=True)
        membership.valid_to = timezone.now().date()
        membership.save(update_fields=["valid_to"])
        GroupMember.objects.create(group=duty.group, vehicle=in_vehicle)

        return api_response(data=DutySerializer(duty).data, message="Vehicle substituted.")

    @action(detail=False, methods=["post"], url_path="surge")
    def surge(self, request, *args, **kwargs):
        period = get_object_or_404(RosterPeriod, pk=self.kwargs["period_pk"], is_deleted=False)
        service_date = request.data.get("service_date")
        route_id = request.data.get("route_id")
        if not (service_date and route_id):
            return api_response(success=False, message="service_date and route_id are required.", status_code=400)

        from backend.apps.fleet.models import VehicleGroup
        from backend.apps.fleet.services import check_group_route_eligibility
        from django_tenants.utils import schema_context
        from backend.apps.platform.models import Route

        with schema_context("public"):
            route = Route.objects.select_related("requirement").filter(pk=route_id).first()
        if route is None:
            return api_response(success=False, message="Route not found.", status_code=400)

        next_slot = Duty.objects.filter(
            roster_period=period, service_date=service_date, route_id=route_id
        ).aggregate(Max("slot_index"))["slot_index__max"]
        next_slot = 0 if next_slot is None else next_slot + 1

        # A reserve group already covering something else on this date can't
        # also cover this slot -- one set of buses, one place at a time.
        busy_today = set(
            Duty.objects.filter(service_date=service_date, group__isnull=False).values_list("group_id", flat=True)
        )

        candidates = []
        blocking_reasons = set()
        for g in VehicleGroup.objects.filter(is_deleted=False, kind=VehicleGroup.Kind.RESERVE).exclude(id__in=busy_today):
            ok, reasons = check_group_route_eligibility(g, route, allow_reserve=True)
            if ok:
                last_used = Duty.objects.filter(group=g).aggregate(Max("service_date"))["service_date__max"]
                candidates.append((last_used, g))
            else:
                blocking_reasons.update(reasons)

        if not candidates:
            return api_response(
                success=False, message="No reserve group qualifies for this route.",
                errors=sorted(blocking_reasons), status_code=400,
            )

        # Least-recently-used first: never-used (None) sorts ahead of any date.
        candidates.sort(key=lambda pair: (pair[0] is not None, pair[0]))
        chosen = candidates[0][1]

        duty = Duty.objects.create(
            roster_period=period, service_date=service_date, route_id=route_id,
            slot_index=next_slot, group=chosen, source=Duty.Source.RESERVE_FILL,
        )
        return api_response(data=DutySerializer(duty).data, message=f"Surge slot filled by {chosen.code}.")


class MyDutiesView(views.APIView):
    """GET /roster/my-duties/ -- doc section 5.7: "drivers see only their own
    group, never the whole chart." First real use of the existing-but-unused
    IsDriver permission class."""
    permission_classes = [IsDriver]

    def get(self, request):
        from backend.apps.fleet.models import GroupDriverAssignment

        assignment = GroupDriverAssignment.objects.filter(
            driver_user_id=request.user.id, valid_to__isnull=True
        ).select_related("group").first()
        if assignment is None:
            return api_response(data=[], message="You are not currently assigned to a group.")

        today = timezone.now().date()
        duties = Duty.objects.filter(
            group=assignment.group,
            roster_period__status=RosterPeriod.Status.PUBLISHED,
            service_date__range=[today, today + timedelta(days=6)],
        ).select_related("roster_period").order_by("service_date")
        return api_response(data=DutySerializer(duties, many=True).data)


class RotationPolicyView(views.APIView):
    """GET/PUT /roster/policy/ -- the single operator-wide RotationPolicy
    row (doc section 8/9's P1 parameters: ring step, week pattern,
    same-weekday lookback, cooldown days). Not a full ModelViewSet since
    there's exactly one row to manage, same "singleton settings" shape as
    a plain APIView elsewhere in this codebase (e.g. MyDutiesView above)."""

    def get_permissions(self):
        if self.request.method == "GET":
            return [CanViewVehicles()]
        return [IsOperationsRole()]

    def get(self, request):
        return api_response(data=RotationPolicySerializer(_get_or_create_policy()).data)

    def put(self, request):
        policy = _get_or_create_policy()
        serializer = RotationPolicySerializer(policy, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return api_response(data=serializer.data, message="Rotation policy updated.")
