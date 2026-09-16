"""Shared, plain-function business logic reused across fleet's own viewset
actions and the roster app's publish/assign validation -- kept here so the
category-eligibility rules (doc section 4.8) live in exactly one place."""
from .models import VehicleGroup


def check_group_route_eligibility(group, route, allow_reserve=False):
    """Doc section 4.8's algorithm: does `group`'s stored capability profile
    satisfy `route`'s RouteRequirement (if any)? Returns (ok, reasons) --
    reasons is empty when ok is True. `route` must already have its
    `requirement` relation available (select_related/prefetch, or the
    OneToOne's default lazy fetch). `allow_reserve` skips the "reserve
    groups don't belong in the regular rotation" reason -- pass True only
    from a context that is itself searching among RESERVE groups on
    purpose (surge fill, or re-checking a duty whose source is already
    RESERVE_FILL), never from the general eligibility/balance views."""
    from backend.apps.platform.models import RouteRequirement

    reasons = []
    req = getattr(route, "requirement", None)

    if group.kind == VehicleGroup.Kind.RESERVE and not allow_reserve:
        reasons.append("Reserve groups only appear on surge slots, not the regular rotation.")

    if req is not None:
        # Permit class is checked regardless of mode -- doc section 4.9-4.11's
        # worked examples test it in both per-vehicle and group-level routes.
        if req.permit_class and group.capability_permit_classes != [req.permit_class]:
            reasons.append(f"Route requires permit class {req.permit_class} on every bus.")

        if req.mode == RouteRequirement.Mode.PER_VEHICLE:
            if req.min_seats and group.capability_min_seats < req.min_seats:
                reasons.append(
                    f"Route requires at least {req.min_seats} seats on every bus; "
                    f"this group's smallest member has {group.capability_min_seats}."
                )
            if req.require_ac and not group.capability_all_ac:
                reasons.append("Route requires every bus to be air conditioned.")
            if req.allowed_categories:
                offending = sorted(set(group.capability_categories) - set(req.allowed_categories))
                if offending:
                    reasons.append(
                        f"Route only allows categories {', '.join(req.allowed_categories)}; "
                        f"this group includes {', '.join(offending)}."
                    )
        else:  # GROUP_LEVEL
            if req.min_total_seats and group.capability_total_seats < req.min_total_seats:
                reasons.append(
                    f"Route requires at least {req.min_total_seats} total seats; "
                    f"this group offers {group.capability_total_seats}."
                )
            if req.min_ac_count and group.capability_ac_count < req.min_ac_count:
                reasons.append(
                    f"Route requires at least {req.min_ac_count} AC buses; "
                    f"this group has {group.capability_ac_count}."
                )
            for code, bounds in (req.category_bounds or {}).items():
                count = group.capability_categories.get(code, 0)
                if bounds.get("max") is not None and count > bounds["max"]:
                    reasons.append(f"Route allows at most {bounds['max']} of {code}; this group has {count}.")
                if bounds.get("min") is not None and count < bounds["min"]:
                    reasons.append(f"Route requires at least {bounds['min']} of {code}; this group has {count}.")

    return (not reasons, reasons)


def check_substitution_composition(group, out_vehicle, in_vehicle):
    """Doc section 4.12/11.2's "composition test" for an in-group vehicle
    swap: would the group, with `in_vehicle` replacing `out_vehicle`, still
    satisfy its own composition rule? Distinct from GroupMember.clean()
    because that method checks *adding* a member, not replacing one -- a
    naive add-only check would count both vehicles at once and reject valid
    like-for-like swaps."""
    from .models import GroupMember, GroupCompositionRule, VehicleGroup

    if in_vehicle.category_id is None:
        return False, ["Incoming vehicle has no category set."]

    existing = list(
        GroupMember.objects.filter(group=group, valid_to__isnull=True)
        .exclude(vehicle=out_vehicle)
        .select_related("vehicle__category")
    )
    prospective_categories = {m.vehicle.category for m in existing if m.vehicle.category_id}
    prospective_categories.add(in_vehicle.category)

    rule = getattr(group, "composition_rule", None) or GroupCompositionRule.objects.filter(group__isnull=True).first()
    if rule is None:
        rule = GroupCompositionRule(group=None)

    reasons = []
    if group.composition_mode == VehicleGroup.CompositionMode.UNIFORM and len(prospective_categories) > 1:
        reasons.append("This group is uniform -- every member must share one category.")
    if not rule.allow_mixed and len(prospective_categories) > 1:
        reasons.append("Mixed-category groups are not allowed by the current composition rule.")
    if len(prospective_categories) > rule.max_categories_per_group:
        reasons.append(
            f"This substitution would bring the group to {len(prospective_categories)} categories, "
            f"more than the max of {rule.max_categories_per_group} allowed."
        )
    seats = [c.seating_capacity for c in prospective_categories]
    if seats:
        spread = max(seats) - min(seats)
        if spread > rule.capacity_spread_limit:
            reasons.append(
                f"This substitution would create a {spread}-seat spread, "
                f"more than the {rule.capacity_spread_limit}-seat limit."
            )
    if rule.permit_class_match:
        permit_classes = {c.permit_class for c in prospective_categories if c.permit_class}
        if len(permit_classes) > 1:
            reasons.append("All members must share a permit class.")

    return (not reasons, reasons)


def compute_prospective_capability(group, out_vehicle, in_vehicle):
    """The capability profile the group *would* have with `in_vehicle`
    replacing `out_vehicle`, without saving anything -- used to run the
    substitution's "eligibility test" (doc section 4.12) against the duty's
    route before committing the swap."""
    from .models import GroupMember

    existing = list(
        GroupMember.objects.filter(group=group, valid_to__isnull=True)
        .exclude(vehicle=out_vehicle)
        .select_related("vehicle__category")
    )
    cats = [m.vehicle.category for m in existing if m.vehicle.category_id]
    if in_vehicle.category_id:
        cats.append(in_vehicle.category)

    categories, permit_classes, seats, ac_count = {}, set(), [], 0
    for cat in cats:
        categories[cat.code] = categories.get(cat.code, 0) + 1
        if cat.permit_class:
            permit_classes.add(cat.permit_class)
        seats.append(cat.seating_capacity)
        if cat.air_conditioned:
            ac_count += 1

    return {
        "kind": group.kind,
        "capability_min_seats": min(seats) if seats else 0,
        "capability_total_seats": sum(seats),
        "capability_all_ac": bool(seats) and ac_count == len(seats),
        "capability_ac_count": ac_count,
        "capability_categories": categories,
        "capability_permit_classes": sorted(permit_classes),
    }
