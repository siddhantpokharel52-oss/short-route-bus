"""
Data access for the /public-api/v1/ master API — almost entirely reads.

This module never imports Django — it talks to the same Postgres database
directly (async SQLAlchemy Core) and reads the tables that
apps.platform / apps.scheduling / apps.ticketing already own. It exists
because most of what the master API needs is either:

  1. Public reference data that lives in the shared ("public") Postgres
     schema (Route, Stop, RouteStop, FareMatrix, TicketType) — a single
     query, no tenant context needed. fetch_routes_near() below is still
     this same category — it's a proximity filter over Stop's stored,
     static latitude/longitude, not a GPS/live-position feature.

  2. Data that lives in a *specific tenant's* Postgres schema (Timetable,
     Ticket) where the master API doesn't know in advance which tenant to
     ask — e.g. a passenger's tickets can come from any operator they've
     ridden with. django-tenants isolates each tenant's TENANT_APPS tables
     in their own Postgres schema, so answering "does this ticket id exist
     anywhere?" means checking each tenant schema in turn. Nothing in the
     existing Django code does this today (every Django view only ever
     sees its own currently-active schema), so this is new, additive logic
     — it does not modify or replace any existing app.

  3. One write, and the one exception to "reads only": store_payment_reference()
     / enrich_payment_references() / _ensure_payment_ref_table() at the bottom
     of this file own a small table, public.public_api_ticket_payment_ref,
     that maps ticket_uid -> an externally-supplied payment/gateway reference
     string. apps.ticketing.Ticket has no such column, and apps.ticketing is
     off-limits to migrate — so rather than lose the field, this API persists
     it in a table it owns outright, in the same shared "public" Postgres
     schema as tenants_tenant/tenants_domain. Chosen over Redis specifically
     because a payment reference is audit/reconciliation data that should
     outlive a ticket's whole lifetime, not something appropriate for a
     cache that can be evicted under memory pressure or lose durability
     depending on how Redis persistence happens to be configured in a given
     environment. The table is created lazily on first use (idempotent
     CREATE TABLE IF NOT EXISTS, not a Django migration) so it self-heals
     regardless of whether a given Postgres volume is fresh or pre-existing.

SQL injection posture (audited — see the review that added this note): every
*value* that flows in from a caller (route_id, ticket_id, passenger_id,
status, route_type, from_stop, to_stop, day_type, schema names compared by
value) is passed as a SQLAlchemy bound parameter (`:name`), never
string-formatted into the query text. The one thing that genuinely cannot be
bound as a parameter is a schema *name used as a table-qualifying
identifier* (`"{schema}".ticketing_ticket`) — Postgres has no bind syntax for
identifiers. Every such spot first runs the schema through _safe_schema(),
which allowlists it against _SCHEMA_RE, and uses the *validated* return value
in the f-string — never the raw input. In practice these schema values are
themselves always sourced from the tenants_tenant table (via
list_tenant_schemas/get_route_operator_schemas), not taken directly from a
request, so _safe_schema is defense-in-depth rather than the only thing
standing between a request and the query — but it's cheap, so it stays.
"""
from __future__ import annotations

import math
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from ..config import settings

PUBLIC_SCHEMA = "public"
# NOTE: `\Z` (true end-of-string), not `$` — Python's `$` also matches just
# before a trailing "\n", so "public\n" would incorrectly pass a `$`-anchored
# pattern. Since this value gets interpolated into a schema-qualified table
# name (see _safe_schema), the anchor has to be exact, not "close enough".
_SCHEMA_RE = re.compile(r"^[a-zA-Z0-9_]+\Z")

_engine: Optional[AsyncEngine] = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True, pool_size=5, max_overflow=5)
    return _engine


def _safe_schema(schema: str) -> str:
    """Guards against SQL injection via schema-qualified table names.

    Postgres has no way to bind an identifier (table/schema name) as a query
    parameter — only values can be bound. Every place below that needs a
    schema-qualified table name (f'"{safe}".ticketing_ticket') calls this
    first and uses the *returned* value, never the raw input, so an
    unexpected schema name raises instead of ever reaching the query string.
    """
    if not schema or not _SCHEMA_RE.match(schema):
        raise ValueError(f"Unsafe or invalid tenant schema name: {schema!r}")
    return schema


def _row_to_dict(row: Any) -> dict:
    return dict(row._mapping)


# ─────────────────────────────────────────────────────────────────────────────
# Tenant / schema directory (shared schema: tenants_tenant, tenants_domain)
# ─────────────────────────────────────────────────────────────────────────────

# Mirrors apps.tenants.models.Tenant (table tenants_tenant) — if a migration
# ever renames `schema_name` or changes what an excluded/system tenant looks
# like (see apps.tenants.views.TenantViewSet's own public-schema exclusion),
# update the filter below to match.
async def list_tenant_schemas() -> list[str]:
    """All real operator schemas (excludes the 'public' system tenant)."""
    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(
            text("SELECT schema_name FROM tenants_tenant WHERE schema_name != :public"),
            {"public": PUBLIC_SCHEMA},
        )
        return [row[0] for row in result.fetchall()]


# Mirrors apps.tenants.models.Tenant + Domain (tables tenants_tenant,
# tenants_domain — Domain.tenant is the FK column tenant_id). Keep this SELECT
# in sync if either model's fields (schema_name, domain, is_primary) change.
async def get_domain_for_schema(schema_name: str) -> Optional[str]:
    """The public-facing domain for a tenant schema, used to route an internal proxy call to Django."""
    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(
            text(
                """
                SELECT d.domain FROM tenants_domain d
                JOIN tenants_tenant t ON t.id = d.tenant_id
                WHERE t.schema_name = :schema
                ORDER BY d.is_primary DESC
                LIMIT 1
                """
            ),
            {"schema": schema_name},
        )
        row = result.first()
        return row[0] if row else None


# Mirrors apps.platform.models.RouteAssignment (table platform_routeassignment)
# joined to apps.tenants.models.Tenant. If RouteAssignment's status choices or
# its route_id/tenant_id FK columns change, update the WHERE/JOIN below.
async def get_route_operator_schemas(route_id: str) -> list[str]:
    """Tenant schemas with an ACTIVE RouteAssignment for this route (apps.platform.RouteAssignment)."""
    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(
            text(
                """
                SELECT t.schema_name
                FROM public.platform_routeassignment ra
                JOIN public.tenants_tenant t ON t.id = ra.tenant_id
                WHERE ra.route_id = :route_id AND ra.status = 'ACTIVE'
                """
            ),
            {"route_id": route_id},
        )
        return [row[0] for row in result.fetchall()]


# ─────────────────────────────────────────────────────────────────────────────
# apps.platform reads (shared "public" Postgres schema)
# ─────────────────────────────────────────────────────────────────────────────

# Mirrors apps.platform.models.Route (table platform_route). This SELECT is
# a deliberate allowlist for passenger-facing consumption — it must NOT grow
# to include approved_by, approved_at, geojson_path (see fetch_route below,
# which does need it), created_by, or is_deleted/deleted_at. If Route's
# migrations add/rename a column this list cares about, update it here too.
async def fetch_routes(status: Optional[str] = None, route_type: Optional[str] = None) -> list[dict]:
    query = """
        SELECT id, route_code, name_en, name_ne, start_stop_id, end_stop_id,
               distance_km, route_type, status, created_at, updated_at
        FROM public.platform_route
        WHERE is_deleted = false
    """
    params: dict[str, Any] = {}
    if status:
        query += " AND status = :status"
        params["status"] = status
    if route_type:
        query += " AND route_type = :route_type"
        params["route_type"] = route_type
    query += " ORDER BY route_code"

    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(text(query), params)
        return [_row_to_dict(r) for r in result.fetchall()]


# Mirrors apps.platform.models.Route — same allowlist note as fetch_routes
# above, plus geojson_path (needed for the single-route detail view only).
async def fetch_route(route_id: str) -> Optional[dict]:
    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(
            text(
                """
                SELECT id, route_code, name_en, name_ne, start_stop_id, end_stop_id,
                       distance_km, route_type, status, geojson_path, created_at, updated_at
                FROM public.platform_route
                WHERE id = :route_id AND is_deleted = false
                """
            ),
            {"route_id": route_id},
        )
        row = result.first()
        return _row_to_dict(row) if row else None


# Mirrors apps.platform.models.RouteStop joined to apps.platform.models.Stop
# (tables platform_routestop, platform_stop). Deliberately excludes Stop's
# capacity/has_shelter/has_digital_signage/zone/created_by/is_deleted — this
# is a passenger-facing stop listing, not the admin Stop record.
async def fetch_route_stops(route_id: str) -> list[dict]:
    """Ordered stops for a route (apps.platform.RouteStop), ordered by sequence_no."""
    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(
            text(
                """
                SELECT rs.id AS route_stop_id, rs.sequence_no, rs.estimated_time_from_start,
                       s.id AS stop_id, s.stop_code, s.name_en, s.name_ne,
                       s.latitude, s.longitude
                FROM public.platform_routestop rs
                JOIN public.platform_stop s ON s.id = rs.stop_id
                WHERE rs.route_id = :route_id
                ORDER BY rs.sequence_no
                """
            ),
            {"route_id": route_id},
        )
        return [_row_to_dict(r) for r in result.fetchall()]


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two fixed lat/lon points, in kilometers.

    Plain static geometry over two coordinate pairs — this has nothing to do
    with GPS or live vehicle position tracking (out of scope for this API).
    It's used only to compare a caller-supplied search point against
    apps.platform.models.Stop's stored, static latitude/longitude.
    """
    R = 6371.0  # Earth radius, km
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


# Mirrors apps.platform.models.Stop (id/latitude/longitude only) joined
# through apps.platform.models.RouteStop to apps.platform.models.Route —
# same tables as fetch_route_stops/fetch_routes above, same allowlist
# concerns (no approved_by/created_by/is_deleted). Distance filtering itself
# happens in Python via _haversine_km rather than in SQL: apps.platform.Stop
# is small (city-scale reference data, not a spatial big-data table), and
# keeping the distance math in one plain, independently testable function is
# easier to keep correct than a trig expression embedded in query text.
async def fetch_routes_near(
    lat: float,
    lon: float,
    radius_km: float,
    status: Optional[str] = None,
    route_type: Optional[str] = None,
) -> list[dict]:
    """Routes with at least one stop within radius_km of (lat, lon).

    Dedupes by route (a route can have several matching stops) and orders by
    the distance to each route's nearest matching stop, closest first.
    """
    engine = get_engine()
    async with engine.connect() as conn:
        stops_result = await conn.execute(text("SELECT id, latitude, longitude FROM public.platform_stop"))
        stop_distance: dict[Any, float] = {}
        for row in stops_result.fetchall():
            if row.latitude is None or row.longitude is None:
                continue
            d = _haversine_km(lat, lon, float(row.latitude), float(row.longitude))
            if d <= radius_km:
                stop_distance[row.id] = d

        if not stop_distance:
            return []

        query = """
            SELECT r.id, r.route_code, r.name_en, r.name_ne, r.start_stop_id, r.end_stop_id,
                   r.distance_km, r.route_type, r.status, r.geojson_path,
                   r.created_at, r.updated_at, rs.stop_id
            FROM public.platform_routestop rs
            JOIN public.platform_route r ON r.id = rs.route_id
            WHERE rs.stop_id = ANY(:stop_ids) AND r.is_deleted = false
        """
        params: dict[str, Any] = {"stop_ids": list(stop_distance.keys())}
        if status:
            query += " AND r.status = :status"
            params["status"] = status
        if route_type:
            query += " AND r.route_type = :route_type"
            params["route_type"] = route_type

        result = await conn.execute(text(query), params)
        rows = [_row_to_dict(r) for r in result.fetchall()]

    nearest: dict[Any, dict] = {}
    for row in rows:
        route_id = row["id"]
        dist = stop_distance[row["stop_id"]]
        if route_id not in nearest or dist < nearest[route_id]["nearest_stop_distance_km"]:
            row = dict(row)
            row["nearest_stop_distance_km"] = dist
            row.pop("stop_id", None)
            nearest[route_id] = row

    return sorted(nearest.values(), key=lambda r: r["nearest_stop_distance_km"])


# Mirrors apps.platform.models.Route joined twice to apps.platform.models.
# RouteStop/Stop (tables platform_route, platform_routestop, platform_stop).
# City-bus journey step 1 ("passenger picks From stop / To stop directly,
# not a route") had no dedicated search before this — the only workaround
# was pulling a route_id out of a GET /fares/?from_stop&to_stop response,
# which wasn't designed for route discovery, it just happened to expose one.
async def fetch_routes_by_stop_pair(from_stop_code: str, to_stop_code: str) -> list[dict]:
    """Routes whose stop list passes through from_stop_code *before* to_stop_code, matched by
    stop_code (same convention as fetch_fares's from_stop/to_stop params) rather than the raw
    stop UUID a client wouldn't have without an extra lookup.

    "In order" is enforced via sequence_no comparison, not just "both stops appear somewhere
    on this route" — a route that passes through both stops in the wrong direction (e.g. only
    serves the reverse leg) does not match, matching the requirement's own wording ("route
    passes through both, in order"). Ordered nearest-pair-first (smallest sequence_no gap),
    the same "most direct option first" spirit as fetch_routes_near's distance ordering."""
    query = """
        SELECT DISTINCT r.id, r.route_code, r.name_en, r.name_ne, r.start_stop_id, r.end_stop_id,
               r.distance_km, r.route_type, r.status, r.geojson_path, r.created_at, r.updated_at,
               rs_from.sequence_no AS from_sequence_no, rs_to.sequence_no AS to_sequence_no,
               (rs_to.sequence_no - rs_from.sequence_no) AS stop_gap
        FROM public.platform_route r
        JOIN public.platform_routestop rs_from ON rs_from.route_id = r.id
        JOIN public.platform_stop s_from ON s_from.id = rs_from.stop_id AND s_from.stop_code = :from_stop
        JOIN public.platform_routestop rs_to ON rs_to.route_id = r.id
        JOIN public.platform_stop s_to ON s_to.id = rs_to.stop_id AND s_to.stop_code = :to_stop
        WHERE rs_from.sequence_no < rs_to.sequence_no AND r.is_deleted = false
        ORDER BY stop_gap ASC, r.route_code
    """
    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(text(query), {"from_stop": from_stop_code, "to_stop": to_stop_code})
        rows = [_row_to_dict(r) for r in result.fetchall()]
        for row in rows:
            row.pop("stop_gap", None)  # only existed to drive ORDER BY under SELECT DISTINCT
        return rows


# Mirrors apps.platform.models.Stop (table platform_stop) — same "single
# shared-schema query, no tenant looping needed" category as
# fetch_routes_near/fetch_routes_by_stop_pair above. Added for the Yatroo
# app's origin/destination typeahead: matches name_en, name_ne, AND
# stop_code so a Nepali-script query still finds the right stop, ordered by
# where the match occurs in the string (an exact prefix match ranks above a
# match buried in the middle of a longer name) — a cheap relevance
# heuristic that needs no extra Postgres extension (no pg_trgm), good
# enough for a first version. Restricted to ACTIVE stops only: no point
# suggesting a stop with no live service.
async def search_stops(query: str, limit: int = 10) -> list[dict]:
    sql = """
        SELECT id, stop_code, name_en, name_ne, latitude, longitude,
               LEAST(
                   NULLIF(position(lower(:q) in lower(name_en)), 0),
                   NULLIF(position(lower(:q) in lower(name_ne)), 0),
                   NULLIF(position(lower(:q) in lower(stop_code)), 0)
               ) AS match_position
        FROM public.platform_stop
        WHERE is_deleted = false AND status = 'ACTIVE'
          AND (name_en ILIKE :contains OR name_ne ILIKE :contains OR stop_code ILIKE :contains)
        ORDER BY match_position ASC NULLS LAST, name_en ASC
        LIMIT :limit
    """
    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(
            text(sql), {"q": query, "contains": f"%{query}%", "limit": limit}
        )
        rows = [_row_to_dict(r) for r in result.fetchall()]
        for row in rows:
            row.pop("match_position", None)  # only existed to drive ORDER BY
        return rows


# Mirrors apps.platform.models.FareMatrix joined to apps.platform.models.
# TicketType (tables platform_farematrix, platform_tickettype). Deliberately
# excludes FareMatrix.updated_by — if a migration adds a new admin-only
# column to either model, it should NOT be added to this SELECT without
# checking whether it's appropriate for passenger-facing consumption.
async def fetch_fares(
    route_id: Optional[str] = None,
    from_stop: Optional[str] = None,
    to_stop: Optional[str] = None,
) -> list[dict]:
    """apps.platform.FareMatrix, optionally narrowed by route and/or a from/to stop_code pair.

    from_stop/to_stop are matched the same way apps.platform.PublicFareInquiryView does it:
    resolved to the stop's zone, then matched against FareMatrix.zone_from/zone_to.
    """
    query = """
        SELECT f.id, f.route_id, f.zone_from, f.zone_to, f.base_fare, f.peak_fare,
               f.student_fare, f.ticket_type_id, tt.code AS ticket_type_code,
               tt.name_en AS ticket_type_name
        FROM public.platform_farematrix f
        JOIN public.platform_tickettype tt ON tt.id = f.ticket_type_id
        WHERE 1=1
    """
    params: dict[str, Any] = {}
    if route_id:
        query += " AND f.route_id = :route_id"
        params["route_id"] = route_id
    if from_stop:
        query += """ AND f.zone_from = (
            SELECT zone FROM public.platform_stop WHERE stop_code = :from_stop LIMIT 1
        )"""
        params["from_stop"] = from_stop
    if to_stop:
        query += """ AND f.zone_to = (
            SELECT zone FROM public.platform_stop WHERE stop_code = :to_stop LIMIT 1
        )"""
        params["to_stop"] = to_stop

    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(text(query), params)
        return [_row_to_dict(r) for r in result.fetchall()]


# ─────────────────────────────────────────────────────────────────────────────
# apps.scheduling.Timetable reads — tenant-scoped, resolved via RouteAssignment
# ─────────────────────────────────────────────────────────────────────────────

# Mirrors apps.scheduling.models.Timetable + TimetableSlot (tables
# scheduling_timetable, scheduling_timetableslot — TimetableSlot.timetable is
# the FK column timetable_id). These are TENANT_APPS tables, so unlike the
# platform_* queries above, this SELECT is repeated per operator schema
# below — keep both the column list AND the schema-qualification logic in
# sync if apps.scheduling's migrations change either table.
#
# Fan-out cost: bounded by get_route_operator_schemas(), which is normally
# 1 schema (exclusive routes) or a handful (shared routes) — not every
# tenant — so this scales fine regardless of total tenant count.
async def fetch_timetable_for_route(route_id: str, day_type: str) -> list[dict]:
    """Scheduled (non-live) timetable slots for a route, across every operator that runs it."""
    schemas = await get_route_operator_schemas(route_id)
    if not schemas:
        return []

    engine = get_engine()
    out: list[dict] = []
    async with engine.connect() as conn:
        for schema in schemas:
            safe = _safe_schema(schema)
            query = text(
                f"""
                SELECT tt.id AS timetable_id, tt.day_type, tt.version, tt.effective_date,
                       s.id AS slot_id, s.departure_time, s.arrival_time, s.frequency_minutes
                FROM "{safe}".scheduling_timetable tt
                JOIN "{safe}".scheduling_timetableslot s ON s.timetable_id = tt.id
                WHERE tt.route_id = :route_id AND tt.day_type = :day_type AND tt.is_active = true
                ORDER BY s.departure_time
                """
            )
            try:
                result = await conn.execute(query, {"route_id": route_id, "day_type": day_type})
            except Exception:
                continue
            for r in result.fetchall():
                d = _row_to_dict(r)
                d["tenant_schema"] = schema
                out.append(d)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# apps.ticketing.Ticket reads — tenant-scoped, cross-schema search
#
# SCALING LIMITATION (documented, not fixed here — see function docstrings):
# find_ticket_by_id() and find_tickets_for_passenger() are O(n) in the number
# of tenant schemas — each issues one query per schema returned by
# list_tenant_schemas(), because Ticket.passenger_id has no cross-tenant
# index to jump to the right schema directly (django-tenants isolates each
# tenant's ticketing_ticket table in its own Postgres schema by design, and
# there is currently no shared/global ticket index anywhere). At today's
# scale (a handful of operators) this is a handful of extra round-trips per
# request and is not worth optimizing. Before onboarding dozens of tenants,
# revisit this — e.g. a shared (public-schema) ticket-to-tenant index table
# maintained on ticket creation, or a documented per-passenger rate limit on
# these two endpoints so worst-case latency stays bounded regardless of
# tenant count. Not fixed here since either option is new scope beyond a
# review/fix pass. The one no-new-scope optimization that *is* already in
# place: find_ticket_by_id() returns as soon as it finds a match instead of
# scanning every remaining schema.
# ─────────────────────────────────────────────────────────────────────────────

# Mirrors apps.ticketing.models.Ticket (table ticketing_ticket). Deliberately
# excludes is_deleted (filtered on, not returned) — Ticket has no
# created_by/approved_by/updated_by fields to worry about, but if a future
# migration adds one, do not add it to this column list without checking
# whether it belongs in a passenger-facing response.
_TICKET_COLUMNS = """
    id, ticket_uid, ticket_type_id, trip_id, passenger_id, passenger_name,
    conductor_id, issued_at, issued_by, valid_until, fare_paid,
    payment_method, qr_code, status, from_stop_id, to_stop_id
"""


async def find_ticket_by_id(ticket_id: str) -> Optional[tuple[str, dict]]:
    """Searches every tenant schema for a ticket by its UUID id, stopping at the first match
    (see the scaling note above the _TICKET_COLUMNS constant). Returns (schema, row) or None."""
    schemas = await list_tenant_schemas()
    engine = get_engine()
    async with engine.connect() as conn:
        for schema in schemas:
            safe = _safe_schema(schema)
            query = text(
                f'SELECT {_TICKET_COLUMNS} FROM "{safe}".ticketing_ticket '
                'WHERE id = :ticket_id AND is_deleted = false'
            )
            try:
                result = await conn.execute(query, {"ticket_id": ticket_id})
                row = result.first()
            except Exception:
                continue
            if row:
                d = _row_to_dict(row)
                d["tenant_schema"] = schema
                return schema, d
    return None


async def find_tickets_for_passenger(passenger_id: str, since: Optional[datetime] = None) -> list[dict]:
    """Every ticket issued to this passenger, across every operator (Ticket.passenger_id is the
    shared users.User id, so a single passenger's tickets are scattered across tenant schemas).
    Unlike find_ticket_by_id, this must scan every schema — there is no "first match" to stop
    at, since results are legitimately spread across multiple tenants (see scaling note above).

    `since` narrows to tickets issued strictly after it — exists so a client can poll this
    cheaply (e.g. "is my ticket here yet" right after a conductor issues one) without
    re-fetching the passenger's whole ticket history on every poll. See router.py's
    my_tickets() docstring for the polling guidance this exists to support.

    Takes a real datetime, not a string — asyncpg requires an actual datetime.datetime
    instance for a timestamptz comparison bind parameter; a raw ISO string raises
    asyncpg.exceptions.DataError. That error was originally getting silently swallowed by
    the per-schema try/except below (caught, schema skipped, no visible failure), which
    made `since` always return an empty list — router.py's my_tickets() now parses the
    query param into a datetime before calling this, so the type hint here matches what's
    actually required, not just what's convenient to accept."""
    schemas = await list_tenant_schemas()
    engine = get_engine()
    out: list[dict] = []
    async with engine.connect() as conn:
        for schema in schemas:
            safe = _safe_schema(schema)
            query_text = (
                f'SELECT {_TICKET_COLUMNS} FROM "{safe}".ticketing_ticket '
                'WHERE passenger_id = :passenger_id AND is_deleted = false'
            )
            params: dict[str, Any] = {"passenger_id": passenger_id}
            if since:
                query_text += " AND issued_at > :since"
                params["since"] = since
            query_text += " ORDER BY issued_at DESC"
            try:
                result = await conn.execute(text(query_text), params)
            except Exception:
                continue
            for r in result.fetchall():
                d = _row_to_dict(r)
                d["tenant_schema"] = schema
                out.append(d)
    out.sort(key=lambda t: t["issued_at"], reverse=True)
    return out


# Mirrors apps.platform.models.Stop (table platform_stop) — only id/name_en
# are needed here; keep this narrow even if Stop gains more columns later.
async def enrich_stop_names(tickets: list[dict]) -> None:
    """Fills in from_stop_name/to_stop_name in place, resolved from the shared platform_stop table."""
    ids = {t[k] for t in tickets for k in ("from_stop_id", "to_stop_id") if t.get(k)}
    if not ids:
        for t in tickets:
            t["from_stop_name"] = None
            t["to_stop_name"] = None
        return

    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(
            text("SELECT id, name_en FROM public.platform_stop WHERE id = ANY(:ids)"),
            {"ids": list(ids)},
        )
        names = {row.id: row.name_en for row in result.fetchall()}

    for t in tickets:
        t["from_stop_name"] = names.get(t.get("from_stop_id"))
        t["to_stop_name"] = names.get(t.get("to_stop_id"))


# ─────────────────────────────────────────────────────────────────────────────
# Payment reference side-storage — owned entirely by this API, not
# apps.ticketing (see module docstring, item 3, for why this table exists and
# why Postgres over Redis). ticket_uid is the primary key: at most one stored
# reference per ticket, matching "set once at issuance" semantics.
# ─────────────────────────────────────────────────────────────────────────────

_payment_ref_table_ready = False


async def _ensure_payment_ref_table() -> None:
    """Idempotent, lazy bootstrap — no Django migration involved. Safe to call on every
    request; short-circuits after the first successful run in this process. Swallows a
    concurrent-first-request CREATE TABLE race rather than letting it surface as a 500,
    since the only thing that matters is the table existing by the time the caller's own
    query runs immediately after this returns."""
    global _payment_ref_table_ready
    if _payment_ref_table_ready:
        return
    engine = get_engine()
    try:
        async with engine.connect() as conn:
            await conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS public.public_api_ticket_payment_ref (
                        ticket_uid VARCHAR(30) PRIMARY KEY,
                        tenant_schema VARCHAR(100) NOT NULL,
                        payment_reference VARCHAR(255) NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
            )
            await conn.commit()
    except Exception:
        pass
    _payment_ref_table_ready = True


async def store_payment_reference(ticket_uid: str, tenant_schema: str, payment_reference: str) -> None:
    """Stores a caller-supplied external payment/gateway reference against a ticket_uid.
    Upserts (ON CONFLICT DO UPDATE) so a retried call with the same ticket_uid overwrites
    rather than errors — mirrors the idempotent-write style used elsewhere in this stack
    (e.g. the Redis idempotency SET in router.py)."""
    await _ensure_payment_ref_table()
    engine = get_engine()
    async with engine.connect() as conn:
        await conn.execute(
            text(
                """
                INSERT INTO public.public_api_ticket_payment_ref (ticket_uid, tenant_schema, payment_reference)
                VALUES (:ticket_uid, :tenant_schema, :payment_reference)
                ON CONFLICT (ticket_uid) DO UPDATE SET payment_reference = EXCLUDED.payment_reference
                """
            ),
            {"ticket_uid": ticket_uid, "tenant_schema": tenant_schema, "payment_reference": payment_reference},
        )
        await conn.commit()


async def enrich_payment_references(tickets: list[dict]) -> None:
    """Fills in payment_reference in place, from this API's own side-store — None if
    nothing was ever stored for that ticket_uid. Same call shape as enrich_stop_names:
    pass a single-element list for one ticket, or the full list for a bulk lookup."""
    await _ensure_payment_ref_table()
    uids = {t["ticket_uid"] for t in tickets if t.get("ticket_uid")}
    if not uids:
        for t in tickets:
            t["payment_reference"] = None
        return

    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT ticket_uid, payment_reference FROM public.public_api_ticket_payment_ref "
                "WHERE ticket_uid = ANY(:uids)"
            ),
            {"uids": list(uids)},
        )
        refs = {row.ticket_uid: row.payment_reference for row in result.fetchall()}

    for t in tickets:
        t["payment_reference"] = refs.get(t.get("ticket_uid"))


# ─────────────────────────────────────────────────────────────────────────────
# Passenger phone / document ID — same side-store pattern as the payment
# reference table just above, for the same reason: apps.ticketing.Ticket has
# no phone or document-id column, and that app is off-limits to migrate.
# "Integrator-supplied passenger details" (C5) is only partially satisfied by
# the model's existing passenger_name field — phone and document ID needed
# somewhere to live, so this owns them the same way payment_reference owns
# its own field.
# ─────────────────────────────────────────────────────────────────────────────

_passenger_details_table_ready = False


async def _ensure_passenger_details_table() -> None:
    """Idempotent, lazy bootstrap — same reasoning as _ensure_payment_ref_table above."""
    global _passenger_details_table_ready
    if _passenger_details_table_ready:
        return
    engine = get_engine()
    try:
        async with engine.connect() as conn:
            await conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS public.public_api_ticket_passenger_details (
                        ticket_uid VARCHAR(30) PRIMARY KEY,
                        tenant_schema VARCHAR(100) NOT NULL,
                        passenger_phone VARCHAR(20),
                        document_id VARCHAR(100),
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
            )
            await conn.commit()
    except Exception:
        pass
    _passenger_details_table_ready = True


async def store_passenger_details(
    ticket_uid: str, tenant_schema: str, passenger_phone: Optional[str], document_id: Optional[str]
) -> None:
    """Stores caller-supplied passenger_phone/document_id against a ticket_uid. No-op if both
    are empty — never writes a row with nothing in it. Upserts, same as store_payment_reference."""
    if not passenger_phone and not document_id:
        return
    await _ensure_passenger_details_table()
    engine = get_engine()
    async with engine.connect() as conn:
        await conn.execute(
            text(
                """
                INSERT INTO public.public_api_ticket_passenger_details
                    (ticket_uid, tenant_schema, passenger_phone, document_id)
                VALUES (:ticket_uid, :tenant_schema, :passenger_phone, :document_id)
                ON CONFLICT (ticket_uid) DO UPDATE SET
                    passenger_phone = EXCLUDED.passenger_phone,
                    document_id = EXCLUDED.document_id
                """
            ),
            {
                "ticket_uid": ticket_uid,
                "tenant_schema": tenant_schema,
                "passenger_phone": passenger_phone,
                "document_id": document_id,
            },
        )
        await conn.commit()


async def enrich_passenger_details(tickets: list[dict]) -> None:
    """Fills in passenger_phone/document_id in place — None for both if nothing was ever
    stored for that ticket_uid. Same call shape as enrich_payment_references."""
    await _ensure_passenger_details_table()
    uids = {t["ticket_uid"] for t in tickets if t.get("ticket_uid")}
    if not uids:
        for t in tickets:
            t["passenger_phone"] = None
            t["document_id"] = None
        return

    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT ticket_uid, passenger_phone, document_id "
                "FROM public.public_api_ticket_passenger_details WHERE ticket_uid = ANY(:uids)"
            ),
            {"uids": list(uids)},
        )
        details = {row.ticket_uid: (row.passenger_phone, row.document_id) for row in result.fetchall()}

    for t in tickets:
        phone, doc = details.get(t.get("ticket_uid"), (None, None))
        t["passenger_phone"] = phone
        t["document_id"] = doc


# ─────────────────────────────────────────────────────────────────────────────
# apps.scheduling.Trip reads — tenant-scoped, used for the trip-QR flow
# ("passenger self-books by scanning the conductor's QR" — see router.py's
# GET /trips/{trip_id}/qr/ and the trip_qr_token handling in issue_ticket()).
# Unlike ticket lookups, this never needs a cross-schema search: the caller
# is always an authenticated conductor who already knows their own
# tenant_schema from their JWT.
# ─────────────────────────────────────────────────────────────────────────────

# Mirrors apps.scheduling.models.Trip (table scheduling_trip). Deliberately
# excludes cancellation_reason/delay_reason/delay_minutes/actual_departure/
# actual_arrival/is_deleted — this is a conductor-facing "is this my active
# trip" check and a small metadata payload for their QR screen, not the full
# admin Trip record.
async def fetch_trip_for_conductor(schema: str, trip_id: str, conductor_id: str) -> Optional[dict]:
    """The trip, only if it exists in `schema`, isn't deleted, and is assigned to exactly
    this conductor_id — a conductor can only ever generate a QR for their own trip, never
    someone else's. Returns None (not partial data) on any mismatch, so the router can't
    accidentally leak "this trip exists but belongs to someone else" via a different error
    shape."""
    safe = _safe_schema(schema)
    engine = get_engine()
    async with engine.connect() as conn:
        try:
            result = await conn.execute(
                text(
                    f"""
                    SELECT id, trip_code, route_id, conductor_id, vehicle_id, date,
                           scheduled_departure_time, scheduled_arrival_time, status
                    FROM "{safe}".scheduling_trip
                    WHERE id = :trip_id AND conductor_id = :conductor_id AND is_deleted = false
                    """
                ),
                {"trip_id": trip_id, "conductor_id": conductor_id},
            )
        except Exception:
            return None
        row = result.first()
        return _row_to_dict(row) if row else None


# ─────────────────────────────────────────────────────────────────────────────
# Self-service (no-conductor) ticket purchase — city-bus journey step 4
# ("Ticket (optional, self-service)... paid via gateway; the conductor scans
# it to validate boarding"). Proxying to Django's TicketViewSet still needs
# an authenticated Django identity to route the call (TenantSchemaMiddleware
# checks the JWT's tenant_schema against X-Tenant-Slug) — but unlike the
# trip-QR flow, there's no real conductor to borrow an identity from here;
# no staff member has done anything yet. Rather than duplicate Django's
# ticket-creation logic (ticket_uid generation, QR rendering) in this file —
# the same "don't duplicate business logic" principle used for the two
# ticket-mutation endpoints — this lazily creates one persistent, non-human
# "service account" row per tenant in the SAME shared users_user table
# real staff/conductor accounts live in (no new table, unlike
# payment_ref — this identity just needs to already exist so
# JWTAuthentication.get_user() can find it).
#
# role="PASSENGER" (the model's own default) is deliberate, not incidental:
# apps.ticketing.views.TicketViewSet.create() auto-tags
# conductor_id/issued_by="CONDUCTOR" only when request.user.role is
# literally "CONDUCTOR" — this account must never trigger that, or a
# self-service ticket would misrepresent itself as conductor-issued. With
# role="PASSENGER", that branch never fires, issued_by stays whatever
# issue_ticket() explicitly sends ("MOBILE"), and conductor_id stays null —
# correct, since no conductor is involved until someone validates the QR.
# is_active=True so authentication succeeds; the password is unusable — this
# row is never used to log in, only ever as a JWT subject.
# ─────────────────────────────────────────────────────────────────────────────


def _self_service_account_email(schema: str) -> str:
    safe = _safe_schema(schema)
    return f"self-service-ticketing+{safe}@internal.kvbms"


# ─────────────────────────────────────────────────────────────────────────────
# apps.staff.BusCompany reads — tenant-scoped, for e-ticket operator branding
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# E-ticket crew lookups — driver, conductor, vehicle; all tenant-scoped
#
# Relationship map (no FK columns — all UUIDFields joined by value):
#   ticketing_ticket.trip_id        → scheduling_trip.id
#   scheduling_trip.driver_id       → staff_driver.id      (staff profile)
#   scheduling_trip.conductor_id    → staff_conductor.id   (staff profile)
#   scheduling_trip.vehicle_id      → fleet_vehicle.id
#   ticketing_ticket.conductor_id   → users_user.id        (set to request.user.id
#                                                            at issuance time)
#   staff_conductor.user_id         → users_user.id        (optional link back)
#
# Tickets issued via POS without a trip assignment have trip_id=NULL but still
# carry conductor_id (the user_id of whoever pressed "Issue"). In that case we
# fall back to find_conductor_by_user_id so the e-ticket still shows conductor
# info even without a full trip record. Driver and vehicle are omitted when
# there is no trip (no trip = no assigned driver/vehicle to show).
# ─────────────────────────────────────────────────────────────────────────────

async def fetch_trip_details(schema: str, trip_id: str) -> Optional[dict]:
    """driver_id / conductor_id / vehicle_id from the trip (all staff profile IDs)."""
    safe = _safe_schema(schema)
    engine = get_engine()
    async with engine.connect() as conn:
        try:
            result = await conn.execute(
                text(
                    f"""
                    SELECT id, trip_code, driver_id, conductor_id, vehicle_id
                    FROM "{safe}".scheduling_trip
                    WHERE id = :trip_id AND is_deleted = false
                    """
                ),
                {"trip_id": trip_id},
            )
            row = result.first()
            return _row_to_dict(row) if row else None
        except Exception:
            return None


async def fetch_driver_for_eticket(schema: str, driver_id: str) -> Optional[dict]:
    """Staff driver profile by staff_driver.id (from scheduling_trip.driver_id)."""
    safe = _safe_schema(schema)
    engine = get_engine()
    async with engine.connect() as conn:
        try:
            result = await conn.execute(
                text(
                    f"""
                    SELECT full_name_en
                    FROM "{safe}".staff_driver
                    WHERE id = :driver_id
                    """
                ),
                {"driver_id": driver_id},
            )
            row = result.first()
            return _row_to_dict(row) if row else None
        except Exception:
            return None


async def fetch_conductor_for_eticket(schema: str, conductor_id: str) -> Optional[dict]:
    """Staff conductor profile by staff_conductor.id (from scheduling_trip.conductor_id)."""
    safe = _safe_schema(schema)
    engine = get_engine()
    async with engine.connect() as conn:
        try:
            result = await conn.execute(
                text(
                    f"""
                    SELECT full_name_en
                    FROM "{safe}".staff_conductor
                    WHERE id = :conductor_id
                    """
                ),
                {"conductor_id": conductor_id},
            )
            row = result.first()
            return _row_to_dict(row) if row else None
        except Exception:
            return None


async def fetch_conductor_by_user_id(schema: str, user_id: str) -> Optional[dict]:
    """Staff conductor profile by user_id (fallback for POS tickets with no trip —
    ticketing_ticket.conductor_id is request.user.id, not staff_conductor.id)."""
    safe = _safe_schema(schema)
    engine = get_engine()
    async with engine.connect() as conn:
        try:
            result = await conn.execute(
                text(
                    f"""
                    SELECT full_name_en
                    FROM "{safe}".staff_conductor
                    WHERE user_id = :user_id
                    LIMIT 1
                    """
                ),
                {"user_id": user_id},
            )
            row = result.first()
            return _row_to_dict(row) if row else None
        except Exception:
            return None


async def fetch_vehicle_for_eticket(schema: str, vehicle_id: str) -> Optional[dict]:
    """Vehicle display info (registration, bus number, make/model/year) for e-ticket."""
    safe = _safe_schema(schema)
    engine = get_engine()
    async with engine.connect() as conn:
        try:
            result = await conn.execute(
                text(
                    f"""
                    SELECT registration_no, owner_name
                    FROM "{safe}".fleet_vehicle
                    WHERE id = :vehicle_id
                    """
                ),
                {"vehicle_id": vehicle_id},
            )
            row = result.first()
            return _row_to_dict(row) if row else None
        except Exception:
            return None


async def fetch_company_info(schema: str) -> Optional[dict]:
    """Company name and logo path from this tenant's BusCompany record.
    Mirrors apps.staff.models.BusCompany (table staff_buscompany). Returns only
    the fields needed for a passenger-facing e-ticket; excludes registration/
    contact details. Returns None if no company record exists yet."""
    safe = _safe_schema(schema)
    engine = get_engine()
    async with engine.connect() as conn:
        try:
            result = await conn.execute(
                text(f'SELECT company_name, logo FROM "{safe}".staff_buscompany LIMIT 1')
            )
            row = result.first()
            return _row_to_dict(row) if row else None
        except Exception:
            return None


async def find_ticket_by_uid(ticket_uid: str) -> Optional[tuple[str, dict]]:
    """Cross-schema lookup by the human-readable ticket_uid (e.g. KV-XXXXXXXX),
    not the internal UUID. Same O(n) fan-out as find_ticket_by_id — see that
    function's scaling note. Returns (schema, row) or None."""
    schemas = await list_tenant_schemas()
    engine = get_engine()
    async with engine.connect() as conn:
        for schema in schemas:
            safe = _safe_schema(schema)
            query = text(
                f'SELECT {_TICKET_COLUMNS} FROM "{safe}".ticketing_ticket '
                'WHERE ticket_uid = :ticket_uid AND is_deleted = false'
            )
            try:
                result = await conn.execute(query, {"ticket_uid": ticket_uid})
                row = result.first()
            except Exception:
                continue
            if row:
                d = _row_to_dict(row)
                d["tenant_schema"] = schema
                return schema, d
    return None


async def get_or_create_self_service_account(schema: str) -> str:
    """Returns this tenant's self-service account user_id, creating it on first use.
    Idempotent (INSERT ... ON CONFLICT DO NOTHING on the unique email, then re-SELECT)
    — safe if two concurrent first-ever calls for the same tenant race each other."""
    email = _self_service_account_email(schema)
    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT id FROM public.users_user WHERE email = :email"), {"email": email})
        row = result.first()
        if row:
            return str(row[0])

        now = datetime.now(timezone.utc)
        await conn.execute(
            text(
                """
                INSERT INTO public.users_user (
                    id, email, password, full_name_en, full_name_ne, phone, role,
                    language_preference, is_active, is_staff, is_superuser, is_2fa_enabled,
                    failed_login_attempts, tenant_schema, created_at, updated_at
                ) VALUES (
                    :id, :email, '!unusable', :full_name_en, '', '', 'PASSENGER',
                    'en', true, false, false, false,
                    0, :tenant_schema, :now, :now
                )
                ON CONFLICT (email) DO NOTHING
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "email": email,
                "full_name_en": f"Self-Service Ticketing ({schema})",
                "tenant_schema": schema,
                "now": now,
            },
        )
        await conn.commit()

        # Re-select rather than trust the id generated above — a concurrent request
        # may have won the ON CONFLICT DO NOTHING race and inserted first.
        result = await conn.execute(text("SELECT id FROM public.users_user WHERE email = :email"), {"email": email})
        row = result.first()
        return str(row[0])
