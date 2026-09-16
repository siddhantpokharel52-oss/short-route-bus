"""Plain-function ring/shift arithmetic for the P1 auto-rotation (doc
sections 7.1-7.2, 9). No model I/O here beyond what's passed in -- keeps
this testable from a shell without needing the full request/view stack."""
import math

from .models import RotationPolicy


def build_ring(demand_rows):
    """demand_rows: [(route_id, slot_count), ...] for one day_type. Returns
    an ordered list of (route_id, slot_index) pairs, length sum(slot_count),
    with each route's slots spread as evenly across the ring as possible
    (doc section 7.1) -- weighted round-robin by deficit: at each position,
    place whichever route is furthest behind its ideal share so far."""
    total = sum(count for _, count in demand_rows)
    if total == 0:
        return []
    placed = {route_id: 0 for route_id, _ in demand_rows}
    ring = []
    for i in range(1, total + 1):
        route_id, _count = max(
            demand_rows,
            key=lambda r: (r[1] * i / total) - placed[r[0]],
        )
        ring.append((route_id, placed[route_id]))
        placed[route_id] += 1
    return ring


def shift_for_date(policy: RotationPolicy, date):
    """Doc section 9's three week-relation patterns, all anchored to
    policy.epoch_date so shift stays continuous across any number of
    roster periods generated over time rather than resetting per period."""
    days = (date - policy.epoch_date).days
    if policy.week_pattern == RotationPolicy.WeekPattern.REPEAT_WEEK:
        return policy.ring_step * (days % 7)
    if policy.week_pattern == RotationPolicy.WeekPattern.ROTATING_REPEAT:
        return policy.ring_step * (days % 7) + policy.week_step * (days // 7)
    return policy.ring_step * days  # KEEP_ROTATING


def ring_slot_for_position(ring, position):
    """(route_id, slot_index) at a ring position, wrapping around -- lets a
    group's one stable ring_position generalize across day_types whose
    rings have different lengths."""
    if not ring:
        return None
    return ring[position % len(ring)]


def is_coprime_step(step, ring_length):
    return ring_length <= 1 or math.gcd(step, ring_length) == 1


def smallest_coprime_step(ring_length, preferred=1):
    """The smallest step >= 1 that is coprime with ring_length -- offered
    back to the admin when their chosen step would leave some slots
    unreachable (doc section 7.2)."""
    if ring_length <= 1:
        return max(preferred, 1)
    step = max(preferred, 1)
    while math.gcd(step, ring_length) != 1:
        step += 1
    return step
