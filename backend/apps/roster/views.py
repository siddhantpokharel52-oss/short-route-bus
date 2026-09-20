from collections import defaultdict
from datetime import timedelta

from django.core.exceptions import ValidationError as DjangoValidationError
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


def _seed_history(groups, route_ids, before_date, lookback_days=14):
    """Primes services.solve_day_assignment's running history from
    already-committed Duty rows (any period) before the sequential solve
    starts, so day 1 of a new rotate() already knows a group's most recent
    run of each route -- without this, cooldown/same-weekday could only
    ever be enforced against duties created *during* this same rotate()
    call. `streak` is reconstructed by walking backward from each pair's
    most recent date while consecutive prior days are also present."""
    group_ids = [g.id for g in groups]
    if not group_ids or not route_ids:
        return {"last_run": {}, "streak": {}, "count": {}}

    rows = Duty.objects.filter(
        group_id__in=group_ids, route_id__in=route_ids,
        service_date__lt=before_date, service_date__gte=before_date - timedelta(days=lookback_days),
        roster_period__is_deleted=False,
    ).values("group_id", "route_id", "service_date")

    dates_by_pair = defaultdict(set)
    for r in rows:
        dates_by_pair[(r["group_id"], r["route_id"])].add(r["service_date"])

    last_run, streak = {}, {}
    for key, date_set in dates_by_pair.items():
        last = max(date_set)
        last_run[key] = last
        run_len, cursor = 1, last
        while (cursor - timedelta(days=1)) in date_set:
            cursor -= timedelta(days=1)
            run_len += 1
        streak[key] = run_len

    return {"last_run": last_run, "streak": streak, "count": {}}


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

    # Cross-period double-booking (RG-063): the check above only looks within
    # this period. A group can't hold a duty on the same service_date in any
    # other (non-deleted) period either -- reuses the same
    # roster_period__is_deleted=False / .exclude(roster_period=period) shape
    # _repair_period's cross_history query already uses, re-keyed by
    # (group_id, service_date) instead of (group_id, route_id).
    assigned_dates = {(d.group_id, d.service_date) for d in duties if d.group_id}
    if assigned_dates:
        cross_period_hits = defaultdict(list)
        for r in Duty.objects.filter(
            group_id__in={g for g, _ in assigned_dates},
            service_date__in={dt for _, dt in assigned_dates},
            roster_period__is_deleted=False,
        ).exclude(roster_period=period).values("group_id", "service_date", "route_id"):
            cross_period_hits[(r["group_id"], r["service_date"])].append(r)

        for d in duties:
            if d.group_id and (d.group_id, d.service_date) in cross_period_hits:
                for hit in cross_period_hits[(d.group_id, d.service_date)]:
                    conflicts.append({
                        "duty_id": str(d.id), "severity": "hard",
                        "message": (
                            f"{d.group.code} is also assigned on {d.service_date} in another "
                            f"roster period (route {hit['route_id']})."
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

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.status != RosterPeriod.Status.DRAFT:
            return api_response(
                success=False,
                message=f"Cannot delete a {instance.status.lower()} roster period -- only drafts can be deleted.",
                status_code=400,
            )
        return super().destroy(request, *args, **kwargs)

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
        Doc section 7.1-7.6's full generation pipeline: lay out each
        day_type's slots on a ring (section 7.1), then for each date in
        order solve that day's group<->slot assignment as a genuine
        minimum-cost bipartite match (section 7.4-7.5) -- the ring/shift
        prediction is just one weighted term (`rotation_preference`) in
        that cost, not a separate mechanism, so P1's stable ring positions
        keep doing real work. Same-weekday is enforced as a forbidden
        pairing *during* the sequential solve (by the time day N is
        solved, every earlier day this run and every other period's
        committed duties are known), then a bounded repair pass
        (section 7.6) mops up whatever a single day's view still couldn't
        see. Never touches a locked duty or one a planner already set by
        hand (source MANUAL/OVERRIDE/RESERVE_FILL) -- only unassigned
        duties or ones a previous rotate itself produced (GENERATED).
        """
        period = self.get_object()
        if period.status != RosterPeriod.Status.DRAFT:
            return api_response(
                success=False,
                message="Auto-Rotate can only run on a draft period -- publish freezes the chart.",
                status_code=400,
            )

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
            routes_qs = list(
                Route.objects.filter(is_deleted=False, status=Route.Status.APPROVED)
                .select_related("requirement", "start_stop")
            )
            routes_by_id = {r.id: r for r in routes_qs}
            demand_rows_by_daytype = defaultdict(list)
            for r in routes_qs:
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
        route_ids_in_play = {rid for dt in day_types_touched for rid, _ in demand_rows_by_daytype.get(dt, [])}
        history = _seed_history(rotating_groups, route_ids_in_play, dates[0])

        # P3 crew_hours (doc section 8): precomputed once per rotate() call,
        # same caching shape as ring_cache/route_ids_in_play above, then
        # threaded into solve_day_assignment per date.
        from backend.apps.fleet.models import GroupDriverAssignment, GroupConductorAssignment

        rotating_group_ids = [g.id for g in rotating_groups]
        crewed_group_ids = set(
            GroupDriverAssignment.objects.filter(
                group_id__in=rotating_group_ids, valid_to__isnull=True
            ).values_list("group_id", flat=True)
        ) | set(
            GroupConductorAssignment.objects.filter(
                group_id__in=rotating_group_ids, valid_to__isnull=True
            ).values_list("group_id", flat=True)
        )

        # scheduling.Timetable is a TENANT app model (unlike platform.Route,
        # which lives in the shared "public" schema) -- this query runs
        # directly in the current tenant schema rotate() is already inside,
        # no schema_context("public") wrapper needed or correct here.
        route_hours_by_daytype = {}
        from backend.apps.scheduling.models import Timetable

        timetables = Timetable.objects.filter(
            route_id__in=route_ids_in_play, day_type__in=day_types_touched, is_active=True
        ).prefetch_related("slots")

        def to_minutes(t):
            return t.hour * 60 + t.minute + t.second / 60

        spans = defaultdict(list)
        for tt in timetables:
            for slot in tt.slots.all():
                # arrival <= departure would mean an overnight route (or bad
                # data) -- out of scope, skip rather than let it corrupt the
                # span with a negative/zero duration.
                if slot.arrival_time <= slot.departure_time:
                    continue
                spans[(tt.route_id, tt.day_type)].append((to_minutes(slot.departure_time), to_minutes(slot.arrival_time)))
        for key, pairs in spans.items():
            earliest = min(p[0] for p in pairs)
            latest = max(p[1] for p in pairs)
            route_hours_by_daytype[key] = (latest - earliest) / 60

        updated = 0
        for date in dates:
            day_type = self._day_type_for(date)
            ring = ring_for(day_type)
            if not ring:
                continue
            shift = services.shift_for_date(policy, date)
            day_result = services.solve_day_assignment(
                date, rotating_groups, ring, shift, routes_by_id, history, policy,
                day_type=day_type, crewed_group_ids=crewed_group_ids, route_hours_by_daytype=route_hours_by_daytype,
            )
            for (route_id, slot_index), (group, breakdown) in day_result.items():
                duty = target_by_key.get((date, route_id, slot_index))
                if duty is None:
                    continue
                duty.group = group
                duty.source = Duty.Source.GENERATED
                duty.cost_breakdown = breakdown
                duty.save(update_fields=["group", "source", "cost_breakdown", "updated_at"])
                updated += 1

        repaired = self._repair_period(period, policy)

        return api_response(
            data={"updated": updated, "repaired": repaired, "conflicts": _compute_conflicts(period)},
            message=f"{updated} duty(ies) auto-assigned." + (f" {repaired} conflict(s) repaired." if repaired else ""),
        )

    def _repair_period(self, period, policy):
        """
        Doc section 7.6: matching optimises one day at a time, but a few
        rules span days -- after the daily solve, validate the period as a
        whole and repair what's found via pairwise swaps: find a
        violation, find the swap that removes it, apply it, revalidate.
        The loop ends when no hard violations remain or no improving swap
        exists, "at which point the remaining conflicts are reported to
        the admin rather than hidden." Only ever swaps GENERATED duties
        against each other -- a locked or manually-set duty is exactly as
        the planner left it.

        The search runs entirely in memory against a working copy of
        {duty_id: group_id/route_id/service_date} plus one upfront query
        for cross-period history -- calling the full `_compute_conflicts`
        (cross-schema route lookups, document checks, the works) for every
        candidate swap was measured to make this pathologically slow, since
        a single repair pass can try hundreds of candidate swaps. Same-
        weekday is the rule being fixed; double-booking is the one a swap
        between two *different* dates can just as easily introduce (moving
        a group onto a date it's already got another duty on), so every
        candidate is screened against `by_group_date` before it's even
        tried -- never just measured after the fact. The final conflict
        list returned to the caller still comes from the real, full
        `_compute_conflicts`.
        """
        rows = list(period.duties.filter(group__isnull=False).values("id", "group_id", "route_id", "service_date"))
        if not rows:
            return 0

        lookback_days = policy.same_weekday_lookback_weeks * 7
        earliest = min(r["service_date"] for r in rows) - timedelta(days=lookback_days)
        latest = max(r["service_date"] for r in rows)
        group_ids = {r["group_id"] for r in rows}
        route_ids = {r["route_id"] for r in rows}

        # RG-081: the repair pass must never trade a same-weekday violation for
        # an eligibility one -- preload real objects once so swap_is_safe can
        # re-check eligibility (spec 4.8's "forbidden pairing = infinite cost")
        # on every candidate, not just double-booking.
        from backend.apps.fleet.models import VehicleGroup
        from backend.apps.fleet.services import check_group_route_eligibility
        from django_tenants.utils import schema_context
        from backend.apps.platform.models import Route

        groups_by_id = {g.id: g for g in VehicleGroup.objects.filter(id__in=group_ids)}
        with schema_context("public"):
            routes_by_id = {r.id: r for r in Route.objects.filter(id__in=route_ids).select_related("requirement")}

        cross_history = defaultdict(list)
        for r in Duty.objects.filter(
            group_id__in=group_ids, route_id__in=route_ids,
            service_date__gte=earliest, service_date__lte=latest,
            roster_period__is_deleted=False,
        ).exclude(roster_period=period).values("group_id", "route_id", "service_date"):
            cross_history[(r["group_id"], r["route_id"])].append(r["service_date"])

        assignments = {r["id"]: {"group_id": r["group_id"], "route_id": r["route_id"], "service_date": r["service_date"]} for r in rows}
        generated_ids = set(
            period.duties.filter(source=Duty.Source.GENERATED, group__isnull=False).values_list("id", flat=True)
        )

        def violating_ids():
            by_pair = defaultdict(list)
            for did, a in assignments.items():
                by_pair[(a["group_id"], a["route_id"])].append((a["service_date"], did))
            bad = set()
            for key, entries in by_pair.items():
                other_dates = cross_history.get(key, [])
                all_dates = sorted(other_dates + [e[0] for e in entries])
                for entry_date, did in entries:
                    for other in all_dates:
                        if other == entry_date:
                            continue
                        if abs((entry_date - other).days) <= lookback_days and other.weekday() == entry_date.weekday():
                            bad.add(did)
                            break
            return bad

        by_group_date = defaultdict(set)
        for a in assignments.values():
            by_group_date[a["group_id"]].add(a["service_date"])

        def swap_is_safe(duty_a_id, duty_b_id):
            a, b = assignments[duty_a_id], assignments[duty_b_id]
            if a["service_date"] != b["service_date"]:
                # Double-booking only needs checking across different dates --
                # a same-day permutation can never double-book. Eligibility
                # below still applies either way: even a same-day swap between
                # two different routes can create a new forbidden pairing.
                if a["service_date"] in (by_group_date[b["group_id"]] - {b["service_date"]}):
                    return False
                if b["service_date"] in (by_group_date[a["group_id"]] - {a["service_date"]}):
                    return False

            route_a, route_b = routes_by_id.get(a["route_id"]), routes_by_id.get(b["route_id"])
            group_a, group_b = groups_by_id.get(a["group_id"]), groups_by_id.get(b["group_id"])
            if route_a and group_b and not check_group_route_eligibility(group_b, route_a, allow_reserve=True)[0]:
                return False
            if route_b and group_a and not check_group_route_eligibility(group_a, route_b, allow_reserve=True)[0]:
                return False
            return True

        hard_ids = violating_ids() & generated_ids
        if not hard_ids:
            return 0

        max_iterations = max(len(hard_ids) * 3, 10)
        candidate_window_days = 14
        candidate_cap = 30
        repaired = 0

        for _ in range(max_iterations):
            hard_ids = violating_ids() & generated_ids
            if not hard_ids:
                break

            duty_a_id = next(iter(hard_ids))
            a = assignments[duty_a_id]
            nearby_ids = [
                did for did in generated_ids
                if did != duty_a_id and did in assignments and assignments[did]["group_id"] != a["group_id"]
                and abs((assignments[did]["service_date"] - a["service_date"]).days) <= candidate_window_days
                and swap_is_safe(duty_a_id, did)
            ][:candidate_cap]

            current_count = len(hard_ids)
            best_id, best_count = None, current_count
            for duty_b_id in nearby_ids:
                b = assignments[duty_b_id]
                a["group_id"], b["group_id"] = b["group_id"], a["group_id"]
                trial_count = len(violating_ids() & generated_ids)
                a["group_id"], b["group_id"] = b["group_id"], a["group_id"]  # revert
                if trial_count < best_count:
                    best_id, best_count = duty_b_id, trial_count

            if best_id is None:
                break

            b = assignments[best_id]
            by_group_date[a["group_id"]].discard(a["service_date"])
            by_group_date[b["group_id"]].discard(b["service_date"])
            a["group_id"], b["group_id"] = b["group_id"], a["group_id"]
            by_group_date[a["group_id"]].add(a["service_date"])
            by_group_date[b["group_id"]].add(b["service_date"])
            repaired += 1

        if repaired:
            for did, a in assignments.items():
                Duty.objects.filter(pk=did).update(group_id=a["group_id"])

        return repaired


class DutyViewSet(ModelViewSet):
    serializer_class = DutySerializer
    http_method_names = ["get", "patch", "delete", "head", "options", "post"]
    IMMUTABLE_DUTY_FIELDS = {"service_date", "route_id", "slot_index"}  # RG-057(c)

    def get_permissions(self):
        if self.action in ("list", "retrieve", "explain"):
            return [CanViewVehicles()]
        return [IsOperationsRole()]

    def get_queryset(self):
        return Duty.objects.filter(roster_period_id=self.kwargs["period_pk"]).select_related("group", "roster_period")

    def list(self, request, *args, **kwargs):
        # No pagination -- a period's duty count is inherently bounded (routes x
        # slots x days), and the roster grid needs every duty at once to render
        # one column per date. The global 20/page default silently truncated
        # this and hid entire days (RG-033).
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return api_response(data=serializer.data)

    def create(self, request, *args, **kwargs):
        # Duties only ever come from period generation or the surge action --
        # "post" stays in http_method_names (it gates dispatch for the whole
        # view, custom actions included) so substitute-vehicle/surge work,
        # which leaves the router's default create() route reachable too.
        return api_response(
            success=False, message="Duties are generated with the roster period; use surge to add one.",
            status_code=405,
        )

    def destroy(self, request, *args, **kwargs):
        # RG-071: a normal demand-slot duty must stay visible as unassigned,
        # never disappear -- only a surge-created (mistaken or not) duty is
        # safe to remove outright. Duty has no soft-delete field, so this is
        # a real DELETE (cascades its own DutyOverride audit row too, which
        # is fine -- deleting a mistake taking its own audit trail with it
        # is reasonable, unlike deleting a real published-roster override).
        instance = self.get_object()
        if instance.source != Duty.Source.RESERVE_FILL:
            return api_response(
                success=False,
                message="Only a surge-created duty can be deleted -- a regular demand slot must stay visible as unassigned.",
                status_code=400,
            )
        return super().destroy(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        duty = self.get_object()
        period = duty.roster_period
        if period.status == RosterPeriod.Status.CLOSED:
            return api_response(success=False, message="This roster period is closed.", status_code=400)

        # RG-057(c): these were silently ignored while the response still
        # claimed "Duty updated" -- reject explicitly instead.
        disallowed = self.IMMUTABLE_DUTY_FIELDS & set(request.data.keys())
        if disallowed:
            return api_response(
                success=False, message=f"These fields cannot be changed: {', '.join(sorted(disallowed))}.",
                status_code=400,
            )

        # Locking/unlocking is its own call -- a group reassignment in the
        # same request while locked is refused below rather than silently
        # allowed just because "locked" was also present.
        if "locked" in request.data and "group" not in request.data:
            # RG-057(b): bool("maybe") is True -- any non-empty string was
            # silently coerced with no real type check.
            if not isinstance(request.data["locked"], bool):
                return api_response(success=False, message="locked must be true or false.", status_code=400)
            duty.locked = request.data["locked"]
            duty.save(update_fields=["locked", "updated_at"])
            return api_response(data=DutySerializer(duty).data, message="Duty lock updated.")

        if duty.locked:
            return api_response(
                success=False, message="This duty is locked. Unlock it before reassigning.", status_code=400
            )

        if "group" not in request.data:
            # RG-056: this endpoint isn't a real partial update -- it never
            # runs the payload through DutySerializer(partial=True), so
            # falling through with request.data.get("group") (None on both
            # "absent" and "explicit null") used to unconditionally clear an
            # existing assignment on e.g. PATCH {} or PATCH {"reason": "..."}.
            return api_response(
                success=False, message="No recognized field to update (expected 'group' or 'locked').",
                status_code=400,
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
            except (VehicleGroup.DoesNotExist, DjangoValidationError, ValueError, TypeError):
                # RG-057(a): a malformed (non-UUID) id raised an uncaught
                # ValidationError from Django's UUID parsing before DoesNotExist
                # ever had a chance to fire -- 500 instead of a clean 400.
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

        # RG-058: this record alone is the complete, correct account of "on
        # this specific duty, in_vehicle ran instead of out_vehicle" -- the
        # composition/eligibility checks above already validated a *hypothetical*
        # swap (compute_prospective_capability), not a real membership change,
        # so nothing here should touch the group's actual composition. A
        # substitution is scoped to one duty, not a standing membership edit.
        VehicleSubstitution.objects.create(
            duty=duty, out_vehicle=out_vehicle, in_vehicle=in_vehicle,
            reason=reason, actor_id=request.user.id,
        )

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
            try:
                route = Route.objects.select_related("requirement").filter(pk=route_id).first()
            except (DjangoValidationError, ValueError, TypeError):
                # RG-072: a malformed (non-UUID) route_id raised an uncaught
                # ValidationError from Django's UUID parsing before .first()
                # ever got a chance to return None -- 500 instead of 400.
                route = None
        if route is None:
            return api_response(success=False, message="Route not found.", status_code=400)
        if route.status != Route.Status.APPROVED:
            return api_response(success=False, message="Surge can only target an approved route.", status_code=400)

        from django.utils.dateparse import parse_date  # matches apps.ticketing.views' existing convention

        parsed_date = parse_date(service_date) if isinstance(service_date, str) else None
        if parsed_date is None:
            return api_response(success=False, message="service_date must be a valid ISO date.", status_code=400)
        if not (period.start_date <= parsed_date <= period.end_date):
            return api_response(
                success=False, message="service_date must fall within this roster period.", status_code=400
            )

        next_slot = Duty.objects.filter(
            roster_period=period, service_date=service_date, route_id=route_id
        ).aggregate(Max("slot_index"))["slot_index__max"]
        next_slot = 0 if next_slot is None else next_slot + 1

        # A reserve group already covering something else on this date can't
        # also cover this slot -- one set of buses, one place at a time.
        busy_today = set(
            Duty.objects.filter(service_date=service_date, group__isnull=False).values_list("group_id", flat=True)
        )

        # RG-070: name every candidate's specific blocking reason -- "busy
        # today," "ineligible," and "no reserve groups at all" used to all
        # produce the identical generic message with an empty errors list,
        # since .exclude(id__in=busy_today) removed busy groups from the
        # loop before eligibility was ever checked against them.
        reserve_groups = list(VehicleGroup.objects.filter(is_deleted=False, kind=VehicleGroup.Kind.RESERVE))
        if not reserve_groups:
            return api_response(success=False, message="No reserve groups exist for this operator.", status_code=400)

        candidates = []
        blocking = {}
        for g in reserve_groups:
            if g.id in busy_today:
                blocking[g.code] = "already covering another duty today"
                continue
            ok, reasons = check_group_route_eligibility(g, route, allow_reserve=True)
            if ok:
                last_used = Duty.objects.filter(group=g).aggregate(Max("service_date"))["service_date__max"]
                candidates.append((last_used, g))
            else:
                blocking[g.code] = "; ".join(reasons)

        if not candidates:
            return api_response(
                success=False, message="No reserve group qualifies for this route.",
                errors=[f"{code}: {reason}" for code, reason in sorted(blocking.items())], status_code=400,
            )

        # Least-recently-used first: never-used (None) sorts ahead of any date.
        candidates.sort(key=lambda pair: (pair[0] is not None, pair[0]))
        chosen = candidates[0][1]

        reason = (request.data.get("reason") or "").strip()
        duty = Duty.objects.create(
            roster_period=period, service_date=service_date, route_id=route_id,
            slot_index=next_slot, group=chosen, source=Duty.Source.RESERVE_FILL,
        )
        # RG-070: a surge fill previously created no audit row at all --
        # DutyOverride already shape-fits (previous_group=None, new_group=chosen).
        DutyOverride.objects.create(
            duty=duty, previous_group=None, new_group=chosen,
            reason=reason or "Surge fill", actor_id=request.user.id,
        )
        return api_response(data=DutySerializer(duty).data, message=f"Surge slot filled by {chosen.code}.")

    @action(detail=True, methods=["get"], url_path="explain")
    def explain(self, request, pk=None, **kwargs):
        """
        GET /roster/periods/{period_pk}/duties/{id}/explain/
        Doc section 7.6/15's per-cell explanation: for a duty the auto-
        rotation produced, show which weighted cost terms drove the
        assignment (captured at rotate() time on Duty.cost_breakdown --
        no recomputation, so this always reflects the actual decision made,
        not a fresh guess at it). Anything else was a human's call.
        """
        duty = self.get_object()
        if duty.source != Duty.Source.GENERATED or not duty.cost_breakdown:
            return api_response(data={
                "generated": False,
                "message": "This duty was set manually, not by the auto-rotation.",
            })
        return api_response(data={"generated": True, **duty.cost_breakdown})


class FairShareReportView(views.APIView):
    """
    GET /roster/reports/fair-share/?period_id=<id>
    Doc section 12/15: "the override log plus the fair-share report is the
    evidence that settles an argument about who got the good routes." A
    factual per-group, per-route duty-count table over the period -- the
    doc never defines a "premium route" weighting, so this stays the
    honest, implementable version: raw exposure, not a subjective score.
    """
    permission_classes = [CanViewVehicles]

    def get(self, request):
        period_id = request.query_params.get("period_id")
        if not period_id:
            return api_response(success=False, message="period_id is required.", status_code=400)
        period = get_object_or_404(RosterPeriod, pk=period_id, is_deleted=False)

        from django_tenants.utils import schema_context
        from backend.apps.platform.models import Route

        duties = list(period.duties.filter(group__isnull=False).select_related("group"))
        route_ids = {d.route_id for d in duties}
        with schema_context("public"):
            routes_by_id = {r.id: r for r in Route.objects.filter(id__in=route_ids)}

        counts = defaultdict(lambda: defaultdict(int))
        totals = defaultdict(int)
        for d in duties:
            counts[d.group.code][getattr(routes_by_id.get(d.route_id), "route_code", str(d.route_id))] += 1
            totals[d.group.code] += 1

        rows = [
            {"group_code": code, "total_duties": totals[code], "by_route": dict(routes)}
            for code, routes in sorted(counts.items())
        ]
        return api_response(data=rows)


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
