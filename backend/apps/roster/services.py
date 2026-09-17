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


def haversine_meters(lat1, lon1, lat2, lon2):
    """Distance between two GPS coordinates, in meters. Same formula as the
    existing (dead-code) copy in dispatch/views.py and the live one in
    scheduling/views.py -- kept local here rather than imported from a
    views module, consistent with this file's existing self-contained pure
    math (build_ring/shift_for_date/etc.)."""
    R = 6371000
    phi1, phi2 = math.radians(float(lat1)), math.radians(float(lat2))
    dphi = math.radians(float(lat2) - float(lat1))
    dlambda = math.radians(float(lon2) - float(lon1))
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def depot_proximity_cost(group, route, policy):
    """P3 (doc section 8, default OFF): a soft preference for a group whose
    depot is close to the route's start stop -- every 10km of distance
    costs one weight-unit, so the weight alone tunes how much this matters.
    Never penalizes (returns 0) when the weight is off, the group has no
    depot coordinates set, or the route has no start_stop -- this rule
    must be a true no-op until an operator has actually entered location
    data, same "OFF means off" contract every other rule in this policy
    follows."""
    if not policy.depot_proximity_weight:
        return 0
    if group.home_latitude is None or group.home_longitude is None:
        return 0
    start_stop = getattr(route, "start_stop", None)
    if start_stop is None:
        return 0

    distance_km = haversine_meters(
        group.home_latitude, group.home_longitude, start_stop.latitude, start_stop.longitude
    ) / 1000
    return round(policy.depot_proximity_weight * (distance_km / 10), 2)


def crew_hours_cost(group_id, route_id, day_type, policy, crewed_group_ids, route_hours_by_daytype):
    """P3 (doc section 8, default OFF): a soft penalty for a route whose
    scheduled span would push a crewed group over crew_max_hours for the
    day. Never penalizes (returns 0) when the weight is off, the group has
    no bound driver or conductor (doc: "where crew is bound"), or the
    route/day_type has no timetable data to estimate a span from -- same
    "OFF means off, never block on missing data" contract as
    depot_proximity_cost."""
    if not policy.crew_hours_weight:
        return 0
    if group_id not in crewed_group_ids:
        return 0
    span_hours = route_hours_by_daytype.get((route_id, day_type))
    if span_hours is None:
        return 0
    over = span_hours - policy.crew_max_hours
    if over <= 0:
        return 0
    return round(policy.crew_hours_weight * over, 2)


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


# P2: cost model + matching (doc sections 7.4-7.6)

INFEASIBLE_COST = 10 ** 7  # sentinel, not float('inf'), to keep the solver's arithmetic well-defined


def hungarian_min_cost_matching(cost_matrix):
    """Minimum-cost bipartite matching via the classic O(n^3) Hungarian
    algorithm (doc section 7.5: "solved exactly rather than approximated"
    -- no library needed at these sizes, tens of groups/slots per day).
    cost_matrix is rows x cols and needn't be square -- the shorter side is
    padded with zero-cost dummy entries internally so a short side's
    rows/cols are simply left unmatched rather than forced into a real
    pairing. Returns a list the length of the original row count: match[i]
    is the matched column index, or None if row i matched only a padding
    dummy (i.e. went unmatched)."""
    n = len(cost_matrix)
    if n == 0:
        return []
    m = len(cost_matrix[0]) if cost_matrix[0] else 0
    if m == 0:
        return [None] * n

    size = max(n, m)
    INF = float("inf")
    padded = [[cost_matrix[i][j] if i < n and j < m else 0 for j in range(size)] for i in range(size)]

    u = [0] * (size + 1)
    v = [0] * (size + 1)
    p = [0] * (size + 1)  # p[j] = row (1-indexed) matched to column j
    way = [0] * (size + 1)

    for i in range(1, size + 1):
        p[0] = i
        j0 = 0
        minv = [INF] * (size + 1)
        used = [False] * (size + 1)
        while True:
            used[j0] = True
            i0 = p[j0]
            delta = INF
            j1 = -1
            for j in range(1, size + 1):
                if not used[j]:
                    cur = padded[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j] = cur
                        way[j] = j0
                    if minv[j] < delta:
                        delta = minv[j]
                        j1 = j
            for j in range(size + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while j0:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1

    col_for_row = [None] * n
    for j in range(1, size + 1):
        row, col = p[j] - 1, j - 1
        if 0 <= row < n and col < m:
            col_for_row[row] = col
    return col_for_row


def solve_day_assignment(
    date, groups, ring, shift, routes_by_id, history, policy,
    day_type=None, crewed_group_ids=None, route_hours_by_daytype=None,
):
    """
    One day of doc section 7.4-7.5: build the cost matrix (group x ring
    position), solve it exactly, commit the result into `history` (mutated
    in place so the next call in the date sequence sees it), and return
    {(route_id, slot_index): (group, cost_breakdown)} for every ring slot
    that matched.

    `history` holds three dicts, keyed by (group_id, route_id):
    "last_run" -> most recent service_date that pair ran (for cooldown/
    same-weekday), "streak" -> consecutive-day run length ending at
    last_run, and "count" keyed by group_id -> total duties assigned to
    that group so far in this solve (for fair_share). The caller seeds
    this from existing Duty rows before the first date and this function
    updates it after every day, so same-weekday is enforced as a genuine
    forbidden pairing during the sequential solve rather than left to a
    later repair pass.

    `day_type`/`crewed_group_ids`/`route_hours_by_daytype` feed the P3
    crew_hours term (doc section 8) -- optional (default None/empty) since
    they're only needed when crew_hours_weight is on; the caller computes
    day_type once per date and the other two once per rotate() call, same
    precomputed-and-passed-in shape as `ring`/`shift`.
    """
    crewed_group_ids = crewed_group_ids or set()
    route_hours_by_daytype = route_hours_by_daytype or {}
    from backend.apps.fleet.services import check_group_route_eligibility

    if not groups or not ring:
        return {}

    ring_len = len(ring)
    last_run = history.setdefault("last_run", {})
    streak = history.setdefault("streak", {})
    count = history.setdefault("count", {})

    avg_count = sum(count.get(g.id, 0) for g in groups) / len(groups)

    cost_matrix = []
    breakdowns = []
    for group in groups:
        predicted_pos = (group.ring_position + shift) % ring_len
        row_costs, row_breakdowns = [], []
        for pos, (route_id, slot_index) in enumerate(ring):
            route = routes_by_id.get(route_id)
            key = (group.id, route_id)
            last = last_run.get(key)
            gap = (date - last).days if last else None

            infeasible, reasons = False, []
            if route is None:
                infeasible = True
            else:
                ok, elig_reasons = check_group_route_eligibility(group, route, allow_reserve=False)
                if not ok:
                    infeasible, reasons = True, elig_reasons

            if not infeasible and gap is not None and gap <= policy.same_weekday_lookback_weeks * 7 and last.weekday() == date.weekday():
                infeasible = True
                reasons = [f"would repeat this route on the same weekday within {policy.same_weekday_lookback_weeks} week(s)"]

            if infeasible:
                row_costs.append(INFEASIBLE_COST)
                row_breakdowns.append({"infeasible": True, "reasons": reasons})
                continue

            components = {"rotation_preference": 0 if pos == predicted_pos else policy.rotation_preference_weight}

            cooldown_cost = 0
            if policy.route_cooldown_weight and gap is not None and gap < policy.route_cooldown_days:
                cooldown_cost = policy.route_cooldown_weight * (policy.route_cooldown_days - gap)
            components["route_cooldown"] = cooldown_cost

            new_streak = streak.get(key, 0) + 1 if gap == 1 else 1
            consecutive_cost = 0
            if policy.consecutive_weight and new_streak > policy.max_consecutive_days_same_route:
                consecutive_cost = policy.consecutive_weight * (new_streak - policy.max_consecutive_days_same_route)
            components["consecutive_days"] = consecutive_cost

            fair_share_cost = 0
            if policy.fair_share_weight:
                imbalance = count.get(group.id, 0) - avg_count
                if imbalance > 0:
                    fair_share_cost = round(policy.fair_share_weight * imbalance, 2)
            components["fair_share"] = fair_share_cost

            components["depot_proximity"] = depot_proximity_cost(group, route, policy)

            components["crew_hours"] = crew_hours_cost(
                group.id, route_id, day_type, policy, crewed_group_ids, route_hours_by_daytype
            )

            total = sum(components.values())
            row_costs.append(total)
            row_breakdowns.append({"infeasible": False, "components": components, "total": total, "new_streak": new_streak})
        cost_matrix.append(row_costs)
        breakdowns.append(row_breakdowns)

    match = hungarian_min_cost_matching(cost_matrix)

    result = {}
    for gi, pos in enumerate(match):
        if pos is None or cost_matrix[gi][pos] >= INFEASIBLE_COST:
            continue
        group = groups[gi]
        route_id, slot_index = ring[pos]
        bd = breakdowns[gi][pos]
        result[(route_id, slot_index)] = (group, bd)

        key = (group.id, route_id)
        last_run[key] = date
        streak[key] = bd["new_streak"]
        count[group.id] = count.get(group.id, 0) + 1

    return result
