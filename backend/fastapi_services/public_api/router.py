"""
/public-api/v1/ — the single consumer-facing API for the Yatroo mobile app.

This is a thin aggregation layer, not a new source of truth:

  * Reference-data reads (routes, stops, fares, timetable) query the same
    tables apps.platform / apps.scheduling already own (see tenant_db.py) and
    are re-shaped into this API's response envelope. No business logic is
    reimplemented — these models have none; they're plain reference data.

  * Ticket creation and validation have real business logic (ticket_uid /
    QR generation, status transitions, conductor tagging) living in
    apps.ticketing.views. Those two endpoints proxy the actual HTTP request
    to the existing Django views (see _proxy_to_django) so that logic is
    reused verbatim rather than duplicated. The rest of the ticket surface
    (single lookup, "my tickets") has no Django equivalent to reuse — a
    passenger's tickets are scattered across whichever tenant schemas they
    rode with — so that part is new, additive read logic in tenant_db.py.

GET /routes/ additionally accepts optional lat/lon/radius_km for a
stop-proximity search (see tenant_db.fetch_routes_near) — a plain static
distance calculation over Stop's stored coordinates, not GPS/live position
data. GET /routes/{id}/ embeds the route's ordered stop list as `stops`
(same data as the separate GET /routes/{id}/stops/, which stays available on
its own). POST /tickets/ additionally accepts an optional idempotency_key,
cached in Redis per (tenant_schema, idempotency_key) so a retried request
returns the original response instead of issuing a second ticket, and an
optional payment_reference, persisted via tenant_db.store_payment_reference
(see that module's docstring — apps.ticketing.Ticket has no such column and
is off-limits to migrate) and surfaced back out on GET /tickets/{id}/ and
GET /tickets/my/. GET /tickets/my/ additionally accepts an optional `since`
timestamp so a client can poll it cheaply (only newly issued tickets come
back) instead of re-fetching the passenger's whole history every few
seconds — see that endpoint's own docstring; this is a deliberate,
lower-cost alternative to WebSocket push, not an oversight. All of these are
extensions of existing endpoints, not new ones.

Explicitly out of scope (per the task this API was built for): GPS/live
positions, ETA/headway/playback/route-polyline, payment gateway calls, and
SMS/push notifications. Nothing here touches apps.scheduling's ETAView,
HeadwayView, PlaybackView, LivePositionsView, RoutePolylineView, or anything
under fastapi_services/gps/. Redis is used above only as the same
general-purpose cache already used elsewhere in this stack — not
GPS-specific infrastructure.

This file issues no direct SQL itself — every query lives in tenant_db.py
(see that module's docstring for the SQL-injection and schema-mirroring
notes). What belongs here instead: response shaping and authorization.
_serialize_ticket() below is a deliberate field allowlist, not a passthrough
of whatever tenant_db returns — it exists specifically so a future column
added to tenant_db._TICKET_COLUMNS doesn't silently start appearing in the
API response without a decision being made about it.
"""
import asyncio
import json
import logging
import time
import uuid
from datetime import date as date_cls
from datetime import datetime
from typing import Optional

import httpx
import redis.asyncio as aioredis
from fastapi import APIRouter, Body, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from jose import JWTError, jwt as jose_jwt

from ..config import settings
from ..dependencies import bearer_scheme, get_current_user, get_redis
from . import tenant_db

router = APIRouter()
logger = logging.getLogger(__name__)

CONDUCTOR_ROLE = "CONDUCTOR"
PASSENGER_ROLE = "PASSENGER"


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket push for "conductor issues ticket → shows in Yatroo app,
# instantly" (docs/API.md §1.4 previously documented this as deferred —
# polling via GET /tickets/my/?since= only). Same in-memory
# connect/broadcast/disconnect pattern already used by
# fastapi_services/gps/router.py's ConnectionManager — a second,
# independent instance here, scoped to ticket delivery instead of vehicle
# positions.
#
# Auth: WebSocket handshakes can't rely on the same Authorization-header
# bearer_scheme dependency used everywhere else in this router (browsers'
# native WebSocket API can't set arbitrary headers; the standard workaround,
# used here, is a `token` query parameter, decoded by hand with the same
# jose/JWT_SECRET_KEY as get_current_user — not a new auth mechanism).
#
# Scaling caveat, inherited from the existing GPS pattern rather than
# introduced here: connections are held in this process's memory, so
# broadcast only reaches clients connected to the same worker process. Fine
# for this deployment (single uvicorn worker, no --workers flag in
# docker-compose.yml); would need a Redis pub/sub fan-out (or similar) to
# stay correct behind multiple FastAPI replicas.
#
# `GET /tickets/my/?since=` remains the reliable catch-up path — this
# WebSocket is a best-effort, lower-latency addition on top of it, not a
# replacement: a client should still poll (or at least re-fetch once) after
# reconnecting, in case a broadcast was missed while disconnected.
# ─────────────────────────────────────────────────────────────────────────────

class _TicketConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, group: str):
        await websocket.accept()
        self.active_connections.setdefault(group, []).append(websocket)

    def disconnect(self, websocket: WebSocket, group: str):
        if group in self.active_connections:
            try:
                self.active_connections[group].remove(websocket)
            except ValueError:
                pass

    async def broadcast(self, message: dict, group: str):
        if group not in self.active_connections:
            return
        dead = []
        for ws in self.active_connections[group]:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.active_connections[group].remove(ws)


ticket_ws_manager = _TicketConnectionManager()


def _decode_ws_token(token: Optional[str]) -> Optional[dict]:
    if not token:
        return None
    try:
        return jose_jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None


@router.websocket("/ws/tickets/")
async def websocket_my_tickets(websocket: WebSocket):
    """Passenger-only. Holds the connection open; broadcasts `{"event": "ticket_issued",
    "data": {...}}` the moment a ticket is issued for this passenger_id — see the
    broadcast call at the end of issue_ticket() below, which fires for both the
    conductor-direct and passenger-QR-scan issuance paths (anything that results in a
    ticket with a passenger_id attached)."""
    token = websocket.query_params.get("token")
    payload = _decode_ws_token(token)
    if payload is None or payload.get("role") != PASSENGER_ROLE:
        await websocket.close(code=1008)
        return

    passenger_id = payload.get("user_id")
    if not passenger_id:
        await websocket.close(code=1008)
        return

    group = f"passenger_{passenger_id}"
    await ticket_ws_manager.connect(websocket, group)
    try:
        while True:
            # Nothing meaningful ever arrives from the client — this just blocks
            # until the socket closes, exactly like gps/router.py's WS endpoints.
            await websocket.receive_text()
    except WebSocketDisconnect:
        ticket_ws_manager.disconnect(websocket, group)


# ─────────────────────────────────────────────────────────────────────────────
# Response envelope helpers — matches apps/ticketing/views.py's api_response()
# ─────────────────────────────────────────────────────────────────────────────

def _ok(data=None, message: str = "Success"):
    return {"success": True, "data": data, "message": message, "errors": None}


def _error(message: str, status_code: int, errors=None):
    return JSONResponse(
        status_code=status_code,
        content={"success": False, "data": None, "message": message, "errors": errors},
    )


# ─────────────────────────────────────────────────────────────────────────────
# Django proxy — used only by the two ticket-mutation endpoints (see module
# docstring). Routes the request to the tenant that issued/owns the ticket by
# setting the Host header to that tenant's real domain (so django-tenants'
# TenantMainMiddleware resolves the correct schema/urlconf) while forwarding
# the caller's own bearer token so Django's own auth + permission classes run
# exactly as they would for a direct call.
# ─────────────────────────────────────────────────────────────────────────────

async def _proxy_to_django(
    method: str,
    path: str,
    schema: str,
    domain: str,
    bearer_token: str,
    json_body: Optional[dict] = None,
):
    url = f"{settings.DJANGO_INTERNAL_BASE_URL}{path}"
    headers = {
        "Host": domain,
        "X-Tenant-Slug": schema,
        "Authorization": f"Bearer {bearer_token}",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        return await client.request(method, url, headers=headers, json=json_body)


# ─────────────────────────────────────────────────────────────────────────────
# Idempotency for POST /tickets/ (brief C5/L3). Redis is the same
# general-purpose cache already used elsewhere in this stack (see
# dependencies.get_redis, used by gps/router.py and live_ops/router.py) —
# this isn't GPS-specific infrastructure, just its connection pool reused.
#
# Keyed on (tenant_schema, idempotency_key) rather than the key alone, so two
# different operators using the same key value (e.g. a client-generated UUID
# that happens to collide, or two conductors reusing a device-local counter)
# can never dedupe against each other.
#
# Concurrency: a plain "GET, then SET after proxying" is a check-then-act
# race — two near-simultaneous requests with the same key can both miss the
# cache before either has written to it, and both issue a ticket. Instead,
# the first thing done with a key is an atomic `SET key IN_PROGRESS NX` —
# only one concurrent request can win that reservation. The loser polls
# briefly for the winner's real response rather than proceeding to a second
# proxy call; if the winner hasn't finished within the poll window, the
# loser gets a 409 telling it to retry, never a duplicate ticket.
#
# The reservation itself has a short TTL, separate from the full dedupe TTL
# that replaces it once the real response is stored — so a request that
# crashes between winning the reservation and storing a result doesn't
# permanently wedge that idempotency_key for 24h.
#
# Only a successful (2xx) response gets the long dedupe TTL. A failure (e.g.
# Django auth rejecting a stale/malformed forwarded token, a momentary DB
# error) releases the reservation instead of caching the failure — caught by
# a real end-to-end smoke test where a transient auth failure got replayed
# for every subsequent call with the same idempotency_key, since the naive
# version cached whatever came back regardless of status_code. A legitimate
# retry with the same key must actually retry, never permanently inherit an
# earlier failure for 24h.
#
# Redis outage: every Redis call in issue_ticket() below is wrapped in
# try/except. On failure this degrades to today's pre-idempotency behavior
# (proceed to issue the ticket normally, no dedupe) rather than a hard
# error — a Redis outage must not take down the conductor-facing ticket
# issuance path.
# ─────────────────────────────────────────────────────────────────────────────

IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24  # 24h — TTL once the real response is stored
IDEMPOTENCY_RESERVATION_TTL_SECONDS = 30  # short TTL for the IN_PROGRESS placeholder
IDEMPOTENCY_POLL_INTERVAL_SECONDS = 0.2
IDEMPOTENCY_POLL_TIMEOUT_SECONDS = 3.0
IDEMPOTENCY_IN_PROGRESS = "IN_PROGRESS"


def _idempotency_cache_key(schema: str, idempotency_key: str) -> str:
    return f"idempotency:tickets:{schema}:{idempotency_key}"


async def _await_idempotent_result(redis: aioredis.Redis, cache_key: str) -> Optional[dict]:
    """Polls briefly for a concurrent request holding the same idempotency_key to finish and
    replace the IN_PROGRESS placeholder with its real response. Returns the parsed
    {"status_code", "body"} dict once available, or None if it's still in progress after the
    poll window — the caller returns 409 rather than guessing at a result or proxying again."""
    elapsed = 0.0
    while elapsed < IDEMPOTENCY_POLL_TIMEOUT_SECONDS:
        await asyncio.sleep(IDEMPOTENCY_POLL_INTERVAL_SECONDS)
        elapsed += IDEMPOTENCY_POLL_INTERVAL_SECONDS
        cached = await redis.get(cache_key)
        if cached is not None and cached != IDEMPOTENCY_IN_PROGRESS:
            return json.loads(cached)
    return None


def _passthrough(resp: httpx.Response) -> JSONResponse:
    try:
        body = resp.json()
    except ValueError:
        body = {
            "success": False,
            "data": None,
            "message": "Malformed response from the ticketing service.",
            "errors": None,
        }
    return JSONResponse(status_code=resp.status_code, content=body)


# ─────────────────────────────────────────────────────────────────────────────
# "Passenger self-books by scanning the conductor's QR" — GET /trips/{id}/qr/
# mints a token identifying a trip; POST /tickets/ accepts that token from a
# PASSENGER-role caller as an alternative to the existing CONDUCTOR-role path.
#
# Both tokens below reuse the exact JWT machinery already used everywhere in
# this stack (jose, settings.JWT_SECRET_KEY/JWT_ALGORITHM — the same secret
# Django's SIMPLE_JWT signs with) — not a second auth mechanism, just two
# more short-lived, narrowly-scoped claim sets signed with the same key:
#
#   trip_qr_token — what the conductor's app displays as a QR. Encodes which
#   trip/tenant/conductor it represents. Minted only for the trip's own
#   assigned conductor (tenant_db.fetch_trip_for_conductor enforces this).
#   Deliberately NOT single-use — many different passengers scanning the
#   same trip's QR to create separate tickets is the whole point, so there's
#   no replay protection beyond the expiry window.
#
#   service conductor token — the real problem this flow has to solve: a
#   passenger has no tenant_schema at all (they're not tied to one
#   operator), so their own JWT can never route a proxied call to a
#   specific tenant's Django — and forwarding it as-is would be rejected
#   outright by Django's own TenantSchemaMiddleware, which checks the JWT's
#   tenant_schema claim against X-Tenant-Slug (that's the cross-tenant
#   security fix from earlier in this project, working exactly as intended).
#   Once a trip_qr_token is decoded and validated, its conductor_id and
#   tenant_schema are already trustworthy (they came from a call that WAS
#   conductor-authenticated, when the QR was minted) — so this mints a
#   fresh, ~60-second, single-purpose token attributing the proxied create
#   call to that same conductor, and forwards THAT to Django instead of the
#   passenger's own token. The resulting ticket is indistinguishable from
#   one the conductor typed in themselves (same conductor_id, same
#   issued_by=CONDUCTOR) — because structurally it is the same operation,
#   just triggered by a passenger's scan instead of conductor data entry.
#   This does not touch or weaken tenant_middleware.py in any way.
# ─────────────────────────────────────────────────────────────────────────────

TRIP_QR_TOKEN_TTL_SECONDS = 60 * 60 * 4  # 4h — generous upper bound on a bus trip's duration
TRIP_QR_TOKEN_PURPOSE = "trip_ticket_scan"
SERVICE_CONDUCTOR_TOKEN_TTL_SECONDS = 60  # only needs to survive one proxy call


def _mint_trip_qr_token(trip_id: str, tenant_schema: str, conductor_id: str) -> str:
    now = int(time.time())
    payload = {
        "purpose": TRIP_QR_TOKEN_PURPOSE,
        "trip_id": trip_id,
        "tenant_schema": tenant_schema,
        "conductor_id": conductor_id,
        "iat": now,
        "exp": now + TRIP_QR_TOKEN_TTL_SECONDS,
    }
    return jose_jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def _decode_trip_qr_token(token: str) -> Optional[dict]:
    """None on anything wrong — expired, forged, malformed, or a differently-purposed
    token (e.g. an ordinary access token) presented here by mistake or misuse."""
    try:
        payload = jose_jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
    if payload.get("purpose") != TRIP_QR_TOKEN_PURPOSE:
        return None
    if not (payload.get("trip_id") and payload.get("tenant_schema") and payload.get("conductor_id")):
        return None
    return payload


def _mint_service_conductor_token(conductor_id: str, tenant_schema: str) -> str:
    """A short-lived token attributing the immediately-following Django proxy call to the
    given conductor — see the module note above this section for why this is necessary
    and why it's safe. Never returned to any client; used only as the Authorization bearer
    on one internal _proxy_to_django() call.

    `token_type: "access"` and `jti` are not decorative — rest_framework_simplejwt's
    AccessToken.verify() hard-requires both (raises "Token has no type" / "Token has no
    id" otherwise) on top of the signature/exp check jose already enforces. Caught via a
    real end-to-end call through the actual running Django container, not a mock — a
    mocked _proxy_to_django call can't fail on a claim Django's own token class demands,
    since the mock never actually decodes anything."""
    now = int(time.time())
    payload = {
        "user_id": conductor_id,
        "role": CONDUCTOR_ROLE,
        "tenant_schema": tenant_schema,
        "token_type": "access",
        "jti": uuid.uuid4().hex,
        "iat": now,
        "exp": now + SERVICE_CONDUCTOR_TOKEN_TTL_SECONDS,
    }
    return jose_jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def _mint_self_service_token(user_id: str, tenant_schema: str) -> str:
    """A short-lived token for the tenant's lazily-created self-service account (see
    tenant_db.get_or_create_self_service_account) — used only as the Authorization bearer
    on one internal _proxy_to_django() call for a passenger self-service ticket purchase.
    Same token_type/jti requirement as _mint_service_conductor_token above."""
    now = int(time.time())
    payload = {
        "user_id": user_id,
        "role": PASSENGER_ROLE,
        "tenant_schema": tenant_schema,
        "token_type": "access",
        "jti": uuid.uuid4().hex,
        "iat": now,
        "exp": now + SERVICE_CONDUCTOR_TOKEN_TTL_SECONDS,
    }
    return jose_jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


# ─────────────────────────────────────────────────────────────────────────────
# Response allowlists for reference-data reads.
#
# tenant_db's SELECT lists are already narrow, but that allowlist lives in a
# different file from the one building the HTTP response. Re-declaring the
# field list here means a future column added to a tenant_db query doesn't
# automatically start appearing in the API response — someone has to
# deliberately add it below too, in the file that actually shapes what a
# passenger-facing client receives.
# ─────────────────────────────────────────────────────────────────────────────

def _serialize_route(r: dict) -> dict:
    return {
        "id": r["id"],
        "route_code": r["route_code"],
        "name_en": r["name_en"],
        "name_ne": r["name_ne"],
        "start_stop_id": r.get("start_stop_id"),
        "end_stop_id": r.get("end_stop_id"),
        "distance_km": r.get("distance_km"),
        "route_type": r.get("route_type"),
        "status": r.get("status"),
        "geojson_path": r.get("geojson_path"),
        "description": r.get("description"),
        "created_at": r.get("created_at"),
        "updated_at": r.get("updated_at"),
        # Only present when GET /routes/ was called with lat/lon — the distance
        # from that search point to this route's nearest matching stop. Named
        # distinctly from the route's own `distance_km` (its total length) so
        # the two are never ambiguous to a client reading the response.
        "nearest_stop_distance_km": r.get("nearest_stop_distance_km"),
        # Only present when GET /routes/ was called with from_stop+to_stop — the
        # matched pair's position in this route's ordered stop list.
        "from_sequence_no": r.get("from_sequence_no"),
        "to_sequence_no": r.get("to_sequence_no"),
    }


def _serialize_route_stop(s: dict) -> dict:
    return {
        "route_stop_id": s["route_stop_id"],
        "sequence_no": s["sequence_no"],
        "estimated_time_from_start": s.get("estimated_time_from_start"),
        "distance_from_start_km": s.get("distance_from_start_km"),
        "stop_id": s["stop_id"],
        "stop_code": s.get("stop_code"),
        "name_en": s.get("name_en"),
        "name_ne": s.get("name_ne"),
        "latitude": s.get("latitude"),
        "longitude": s.get("longitude"),
    }


def _serialize_fare(f: dict) -> dict:
    return {
        "id": f["id"],
        "route_id": f.get("route_id"),
        "zone_from": f.get("zone_from"),
        "zone_to": f.get("zone_to"),
        "base_fare": f.get("base_fare"),
        "peak_fare": f.get("peak_fare"),
        "student_fare": f.get("student_fare"),
        "senior_citizen_fare": f.get("senior_citizen_fare"),
        "ticket_type_id": f.get("ticket_type_id"),
        "ticket_type_code": f.get("ticket_type_code"),
        "ticket_type_name": f.get("ticket_type_name"),
        # Only present when the query included route_id -- a bare zone match
        # (from_stop/to_stop with no route_id) has no single "the" distance,
        # since different routes can connect that zone pair differently.
        "distance_km": f.get("distance_km"),
        "time_minutes": f.get("time_minutes"),
    }


def _serialize_timetable_slot(s: dict) -> dict:
    return {
        "timetable_id": s["timetable_id"],
        "day_type": s.get("day_type"),
        "version": s.get("version"),
        "effective_date": s.get("effective_date"),
        "slot_id": s["slot_id"],
        "departure_time": s.get("departure_time"),
        "arrival_time": s.get("arrival_time"),
        "frequency_minutes": s.get("frequency_minutes"),
        "tenant_schema": s.get("tenant_schema"),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Routes / Stops — apps.platform.RouteViewSet, RouteStop (public reference data)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/routes/")
async def list_routes(
    status: Optional[str] = Query(None, description="Filter by Route.status, e.g. APPROVED"),
    route_type: Optional[str] = Query(None, description="EXCLUSIVE or SHARED"),
    lat: Optional[float] = Query(None, description="Search-point latitude for a nearby-route search"),
    lon: Optional[float] = Query(None, description="Search-point longitude for a nearby-route search"),
    radius_km: float = Query(5.0, gt=0, description="Search radius in km — only used together with lat/lon"),
    from_stop: Optional[str] = Query(None, description="Origin stop_code — routes serving from_stop→to_stop, in order"),
    to_stop: Optional[str] = Query(None, description="Destination stop_code — used together with from_stop"),
    stop: Optional[str] = Query(None, description="A single stop_code — routes serving this stop, any position/direction"),
):
    """List routes, optionally filtered by `status`/`route_type`.

    Pass `from_stop` + `to_stop` (stop codes) to instead find routes serving that pair,
    in that direction — each result includes `from_sequence_no`/`to_sequence_no`.

    Pass `lat` + `lon` to instead find nearby routes within `radius_km` — each result
    includes `nearest_stop_distance_km`, ordered closest first.

    Pass `stop` alone to find every route serving that one stop, regardless of position
    or direction — e.g. after a passenger picks a single destination (no origin yet) from
    `GET /stops/autocomplete/`.

    Each of these three modes requires exactly its own param(s) (`400` if only one of a
    required pair is given). If a caller somehow combines more than one mode, precedence
    is deterministic rather than an error: `from_stop`/`to_stop` wins over `lat`/`lon`,
    which wins over `stop` — not a scenario a real client should construct, but resolved
    consistently rather than rejected outright. See docs/API.md §1.4 for full details.
    """
    if (lat is None) != (lon is None):
        return _error("Both lat and lon are required for a nearby-route search.", 400)
    if (from_stop is None) != (to_stop is None):
        return _error("Both from_stop and to_stop are required for a stop-pair route search.", 400)

    if from_stop is not None and to_stop is not None:
        routes = await tenant_db.fetch_routes_by_stop_pair(from_stop, to_stop)
    elif lat is not None and lon is not None:
        routes = await tenant_db.fetch_routes_near(
            lat=lat, lon=lon, radius_km=radius_km, status=status, route_type=route_type,
        )
    elif stop is not None:
        routes = await tenant_db.fetch_routes_by_single_stop(stop)
    else:
        routes = await tenant_db.fetch_routes(status=status, route_type=route_type)
    return _ok(data=[_serialize_route(r) for r in routes])


@router.get("/routes/{route_id}/")
async def get_route(route_id: str):
    """Single route detail, with its ordered stop list embedded as `stops` and route
    geometry as `geojson_path`. Also bundles the summary fields a route-detail screen
    needs in one call (Yatroo's route-detail spec) rather than requiring a separate
    `GET /routes/{id}/timetable/` round trip: `total_stops`, `estimated_duration_minutes`
    (the last stop's `estimated_time_from_start` — the whole route's own duration
    estimate), `first_bus`/`last_bus`/`frequency_minutes_min`/`frequency_minutes_max`
    (from today's scheduled timetable, all `null` if none is published yet), and
    `total_buses` (vehicles currently assigned to this route, across every operator
    running it). `404` if the route doesn't exist."""
    route = await tenant_db.fetch_route(route_id)
    if not route:
        return _error("Route not found.", 404)
    # Deliberately not folded into _serialize_route() itself: that function is also used
    # by list_routes(), where fetching+embedding every route's full stop list would turn
    # a single request into N extra queries for however many routes are in the list.
    stops = await tenant_db.fetch_route_stops(route_id)
    day_type = _resolve_day_type(None, None)
    slots, total_buses = await asyncio.gather(
        tenant_db.fetch_timetable_for_route(route_id, day_type),
        tenant_db.count_operating_buses_for_route(route_id),
    )

    data = _serialize_route(route)
    data["stops"] = [_serialize_route_stop(s) for s in stops]
    data["total_stops"] = len(stops)
    data["estimated_duration_minutes"] = max(
        (s.get("estimated_time_from_start") or 0 for s in stops), default=None
    )
    departures = sorted(s["departure_time"] for s in slots)
    frequencies = sorted(s["frequency_minutes"] for s in slots if s.get("frequency_minutes") is not None)
    data["first_bus"] = departures[0] if departures else None
    data["last_bus"] = departures[-1] if departures else None
    data["frequency_minutes_min"] = frequencies[0] if frequencies else None
    data["frequency_minutes_max"] = frequencies[-1] if frequencies else None
    data["total_buses"] = total_buses
    return _ok(data=data)


@router.get("/routes/{route_id}/stops/")
async def get_route_stops(route_id: str):
    """Ordered stop list for a route. `404` if the route doesn't exist."""
    route = await tenant_db.fetch_route(route_id)
    if not route:
        return _error("Route not found.", 404)
    stops = await tenant_db.fetch_route_stops(route_id)
    return _ok(data=[_serialize_route_stop(s) for s in stops])


def _serialize_stop(s: dict) -> dict:
    data = {
        "id": s["id"],
        "stop_code": s.get("stop_code"),
        "name_en": s.get("name_en"),
        "name_ne": s.get("name_ne"),
        "latitude": s.get("latitude"),
        "longitude": s.get("longitude"),
    }
    # Only present when the search itself was location-aware (autocomplete_stops
    # called with lat/lon) -- absent, not null, otherwise: a null would read as
    # "we don't know the distance" rather than "distance wasn't requested".
    if "distance_km" in s:
        data["distance_km"] = s["distance_km"]
    return data


@router.get("/stops/autocomplete/")
async def autocomplete_stops(
    q: str = Query(..., min_length=1, description="Partial stop name (English or Nepali) or stop code"),
    limit: int = Query(10, gt=0, le=20, description="Max results to return"),
    lat: Optional[float] = Query(None, description="Passenger's latitude — when given (with lon), results are ordered by walking distance instead of match quality"),
    lon: Optional[float] = Query(None, description="Passenger's longitude — required together with lat"),
):
    """Typeahead search for a stop-picker UI — e.g. Yatroo's origin/destination field.
    Matches `q` against a stop's English name, Nepali name, or stop_code. Ranked by where
    the match occurs (an earlier/prefix match ranks first) by default; ranked by distance
    from (lat, lon) instead when both are given. Only ACTIVE stops. Not a replacement for
    `GET /routes/{id}/stops/` — this searches every stop platform-wide, independent of any
    one route."""
    if (lat is None) != (lon is None):
        return _error("Both lat and lon are required together.", 400)
    stops = await tenant_db.search_stops(q.strip(), limit=limit, lat=lat, lon=lon)
    return _ok(data=[_serialize_stop(s) for s in stops])


# ─────────────────────────────────────────────────────────────────────────────
# Fares — apps.platform.FareMatrix (public reference data)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/fares/")
async def get_fares(
    route_id: Optional[str] = Query(None),
    from_stop: Optional[str] = Query(None, description="Stop code, e.g. KV0A1B2C"),
    to_stop: Optional[str] = Query(None, description="Stop code, e.g. KV0D3E4F"),
):
    """Fare for a specific route + boarding/dropping stop pair. `route_id`, `from_stop`,
    and `to_stop` are all required (`400` if any is missing) — stage fares, priced by
    zone band rather than distance. See docs/API.md §1.4 for how zone precision works."""
    if not (route_id and from_stop and to_stop):
        return _error("route_id, from_stop, and to_stop are all required.", 400)
    fares = await tenant_db.fetch_fares(route_id=route_id, from_stop=from_stop, to_stop=to_stop)
    return _ok(data=[_serialize_fare(f) for f in fares])


# ─────────────────────────────────────────────────────────────────────────────
# Timetable — apps.scheduling.Timetable (scheduled times only — NOT live)
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_day_type(explicit: Optional[str], on_date: Optional[str]) -> str:
    if explicit:
        return explicit.upper()
    d = date_cls.fromisoformat(on_date) if on_date else date_cls.today()
    weekday = d.weekday()  # Monday=0 ... Sunday=6
    if weekday == 5:
        return "SATURDAY"
    if weekday == 6:
        return "SUNDAY"
    return "WEEKDAY"


@router.get("/routes/{route_id}/timetable/")
async def get_route_timetable(
    route_id: str,
    date: Optional[str] = Query(None, description="ISO date; defaults to today"),
    day_type: Optional[str] = Query(None, description="Override: WEEKDAY, SATURDAY, SUNDAY, or HOLIDAY"),
):
    """Scheduled departure/arrival slots for a route (not live positions). Covers every
    operator serving the route. `day_type` defaults from `date` if not given. `404` if
    the route doesn't exist; an empty `slots` list if it has no published timetable yet."""
    route = await tenant_db.fetch_route(route_id)
    if not route:
        return _error("Route not found.", 404)

    resolved_day_type = _resolve_day_type(day_type, date)
    slots = await tenant_db.fetch_timetable_for_route(route_id, resolved_day_type)
    return _ok(
        data={"day_type": resolved_day_type, "slots": [_serialize_timetable_slot(s) for s in slots]},
        message=(
            "Scheduled timetable (not live — for real-time position use a live-tracking endpoint)."
            if slots
            else "No published timetable for this route/day type yet."
        ),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Tickets
# ─────────────────────────────────────────────────────────────────────────────

def _serialize_ticket(t: dict) -> dict:
    return {
        "id": t["id"],
        "ticket_uid": t["ticket_uid"],
        # Base64-encoded QR PNG (apps.ticketing.TicketSerializer.create() generates it at
        # issuance time). Without this, a passenger's app can only see the QR on the
        # direct POST /tickets/ response — it would vanish on every later lookup.
        "qr_code": t.get("qr_code"),
        "operator_schema": t["tenant_schema"],
        "ticket_type_id": t.get("ticket_type_id"),
        "trip_id": t.get("trip_id"),
        "passenger_id": t.get("passenger_id"),
        "passenger_name": t.get("passenger_name"),
        # Same side-store pattern as payment_reference just below — apps.ticketing.Ticket
        # has no phone/document-id column. None if nothing was ever stored.
        "passenger_phone": t.get("passenger_phone"),
        "document_id": t.get("document_id"),
        "conductor_id": t.get("conductor_id"),
        "issued_at": t.get("issued_at"),
        "issued_by": t.get("issued_by"),
        "valid_until": t.get("valid_until"),
        "fare_paid": t.get("fare_paid"),
        "payment_method": t.get("payment_method"),
        # External gateway/payment reference, if the issuing call supplied one — stored
        # by this API itself (tenant_db.store_payment_reference), not part of
        # apps.ticketing.Ticket. None if nothing was ever stored for this ticket_uid.
        "payment_reference": t.get("payment_reference"),
        "status": t.get("status"),
        "from_stop_id": t.get("from_stop_id"),
        "to_stop_id": t.get("to_stop_id"),
        "from_stop_name": t.get("from_stop_name"),
        "to_stop_name": t.get("to_stop_name"),
    }


@router.get("/trips/{trip_id}/qr/")
async def get_trip_qr(trip_id: str, user: dict = Depends(get_current_user)):
    """Conductor-only. Mints a short-lived token to render as a QR code for this trip —
    a passenger scans it and passes it as `trip_qr_token` to `POST /tickets/` to
    self-book. `403` if not a conductor; `404` if the trip doesn't exist or isn't theirs."""
    if user.get("role") != CONDUCTOR_ROLE:
        raise HTTPException(status_code=403, detail="Only a conductor can generate a trip QR.")

    schema = user.get("tenant_schema")
    conductor_id = user.get("user_id")
    if not schema or not conductor_id:
        raise HTTPException(status_code=400, detail="This conductor account has no tenant assigned.")

    trip = await tenant_db.fetch_trip_for_conductor(schema, trip_id, conductor_id)
    if not trip:
        return _error("Trip not found.", 404)

    token = _mint_trip_qr_token(trip_id, schema, conductor_id)
    return _ok(
        data={
            "trip_qr_token": token,
            "expires_in": TRIP_QR_TOKEN_TTL_SECONDS,
            "trip_id": trip_id,
            "trip_code": trip.get("trip_code"),
        }
    )


@router.post("/tickets/")
async def issue_ticket(
    payload: dict,
    user: dict = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Issue a ticket. Three ways to call this, based on role and payload:

    - **Conductor** (`role=CONDUCTOR`): issues directly, cash-on-board.
    - **Passenger, scan-to-book**: include `trip_qr_token` (from
      `GET /trips/{trip_id}/qr/`) to book by scanning a conductor's QR. `403` if the
      token is invalid, expired, or missing.
    - **Passenger, self-service**: include `route_id` (no QR needed) plus a
      **required** `payment_reference`. If the route has more than one operator, also
      include `tenant_schema` — otherwise `400` with the valid choices. Optionally
      include `ticket_type` (e.g. `ADULT`/`STUDENT`, matching a `GET /fares/` result's
      `ticket_type_code`) — `400` if it doesn't match a known ticket type.

    Optional on any path: `idempotency_key` (retried requests with the same key return
    the original result instead of duplicating) and `from_stop_id`/`to_stop_id` (also
    accepted as `boardingStopId`/`droppingStopId`), plus `passenger_phone`/`document_id`
    (also accepted as `passengerPhone`/`documentId`). See docs/API.md §1.4 for details."""
    # Accept the brief's camelCase field names as aliases for our own snake_case ones —
    # never the reverse, and the snake_case key always wins if a caller somehow sends
    # both. This is a normalization shim, not a second schema: from here on, only
    # from_stop_id/to_stop_id/passenger_phone/document_id exist.
    for camel, snake in (
        ("boardingStopId", "from_stop_id"),
        ("droppingStopId", "to_stop_id"),
        ("passengerPhone", "passenger_phone"),
        ("documentId", "document_id"),
    ):
        if camel in payload and snake not in payload:
            payload[snake] = payload.pop(camel)
        else:
            payload.pop(camel, None)

    role = user.get("role")
    bearer_token = credentials.credentials
    trip_id_override = None
    issued_by_override = None
    passenger_id = None

    if role == CONDUCTOR_ROLE:
        schema = user.get("tenant_schema")
        if not schema:
            raise HTTPException(status_code=400, detail="This conductor account has no tenant assigned.")
    elif role == PASSENGER_ROLE:
        trip_qr_token = payload.get("trip_qr_token")
        route_id = payload.get("route_id")

        if isinstance(trip_qr_token, str) and trip_qr_token.strip():
            decoded = _decode_trip_qr_token(trip_qr_token.strip())
            if decoded is None:
                raise HTTPException(status_code=403, detail="This QR code is invalid or has expired.")
            passenger_id = user.get("user_id")
            if not passenger_id:
                return _error("Invalid token.", 401)
            schema = decoded["tenant_schema"]
            trip_id_override = decoded["trip_id"]
            bearer_token = _mint_service_conductor_token(decoded["conductor_id"], schema)
        elif isinstance(route_id, str) and route_id.strip():
            # Self-service purchase — city-bus journey step 4 ("Ticket (optional,
            # self-service)... paid via gateway"). No conductor or QR involved at all;
            # the passenger picks a route themselves, ahead of boarding.
            passenger_id = user.get("user_id")
            if not passenger_id:
                return _error("Invalid token.", 401)

            payment_reference_value = payload.get("payment_reference")
            if not isinstance(payment_reference_value, str) or not payment_reference_value.strip():
                return _error(
                    "payment_reference is required for a self-service ticket purchase — there is "
                    "no conductor present to collect cash for this flow.",
                    400,
                )

            operator_schemas = await tenant_db.get_route_operator_schemas(route_id)
            if not operator_schemas:
                return _error("Route not found or not currently served by any operator.", 404)
            if len(operator_schemas) == 1:
                schema = operator_schemas[0]
            else:
                requested_schema = payload.get("tenant_schema")
                if not isinstance(requested_schema, str) or requested_schema not in operator_schemas:
                    return _error(
                        "This route is served by more than one operator — specify which one via "
                        "`tenant_schema`.",
                        400,
                        errors={"operators": operator_schemas},
                    )
                schema = requested_schema

            ticket_type_code = payload.get("ticket_type")
            ticket_type_id_override = None
            if isinstance(ticket_type_code, str) and ticket_type_code.strip():
                ticket_type_id_override = await tenant_db.resolve_ticket_type_id(ticket_type_code.strip().upper())
                if ticket_type_id_override is None:
                    return _error(f"Unknown ticket_type: {ticket_type_code!r}.", 400)

            account_id = await tenant_db.get_or_create_self_service_account(schema)
            bearer_token = _mint_self_service_token(account_id, schema)
            issued_by_override = "MOBILE"
        else:
            raise HTTPException(status_code=403, detail="Only a conductor token can issue tickets.")
    else:
        raise HTTPException(status_code=403, detail="Only a conductor token can issue tickets.")

    idempotency_key = payload.get("idempotency_key")
    cache_key = None
    owns_reservation = False
    if isinstance(idempotency_key, str) and idempotency_key.strip():
        cache_key = _idempotency_cache_key(schema, idempotency_key)
        try:
            owns_reservation = bool(
                await redis.set(cache_key, IDEMPOTENCY_IN_PROGRESS, nx=True, ex=IDEMPOTENCY_RESERVATION_TTL_SECONDS)
            )
            if not owns_reservation:
                # Someone else (a concurrent request, or an earlier completed one) already
                # holds this key. Never proceed to our own proxy call in this branch — that's
                # exactly the double-issue this reservation exists to prevent.
                existing = await redis.get(cache_key)
                if existing is not None and existing != IDEMPOTENCY_IN_PROGRESS:
                    stored = json.loads(existing)
                    return JSONResponse(status_code=stored["status_code"], content=stored["body"])
                stored = await _await_idempotent_result(redis, cache_key)
                if stored is not None:
                    return JSONResponse(status_code=stored["status_code"], content=stored["body"])
                return _error(
                    "A request with this idempotency_key is already being processed. Please retry.",
                    409,
                )
        except Exception:
            logger.warning(
                "Redis unavailable for idempotency check (tenant=%s) — issuing ticket without dedupe protection.",
                schema,
                exc_info=True,
            )
            cache_key = None
            owns_reservation = False

    domain = await tenant_db.get_domain_for_schema(schema)
    if not domain:
        raise HTTPException(status_code=500, detail=f"No domain configured for tenant '{schema}'.")

    # idempotency_key, payment_reference, trip_qr_token, passenger_phone, and document_id
    # are public-api control/side-storage fields, not part of the Ticket data model —
    # don't forward them into the payload Django's TicketSerializer sees.
    django_payload = {
        k: v
        for k, v in payload.items()
        if k not in ("idempotency_key", "payment_reference", "trip_qr_token", "passenger_phone", "document_id", "ticket_type")
    }
    if trip_id_override is not None:
        # Scan-to-book: trip_id/passenger_id come from the validated QR token and the
        # caller's own identity, never trusted from the passenger-supplied payload.
        django_payload["trip_id"] = trip_id_override
        django_payload["passenger_id"] = passenger_id
    if issued_by_override is not None:
        # Self-service purchase: passenger_id is the caller's own identity, never trusted
        # from the payload; issued_by is forced to MOBILE regardless of what (if anything)
        # the caller sent for it. route_id/tenant_schema were this endpoint's own routing
        # inputs (used above to resolve `schema`), not Ticket fields — Django's serializer
        # would silently ignore them anyway (no such fields on Ticket), but drop them here
        # too rather than send noise. ticket_type (a code like "ADULT") isn't a real Ticket
        # field either — Ticket stores ticket_type_id (a FK), resolved above.
        django_payload["passenger_id"] = passenger_id
        django_payload["issued_by"] = issued_by_override
        django_payload.pop("route_id", None)
        django_payload.pop("tenant_schema", None)
        if ticket_type_id_override is not None:
            django_payload["ticket_type_id"] = ticket_type_id_override

    resp = await _proxy_to_django(
        "POST", "/api/v1/ticketing/tickets/", schema, domain, bearer_token, json_body=django_payload,
    )

    try:
        body = resp.json()
    except ValueError:
        body = None

    payment_reference = payload.get("payment_reference")
    if (
        body is not None
        and 200 <= resp.status_code < 300
        and isinstance(body, dict)
        and isinstance(payment_reference, str)
        and payment_reference.strip()
    ):
        ticket_uid = (body.get("data") or {}).get("ticket_uid")
        if ticket_uid:
            try:
                await tenant_db.store_payment_reference(ticket_uid, schema, payment_reference.strip())
            except Exception:
                logger.warning(
                    "Failed to store payment_reference for ticket %s (tenant=%s) — the ticket was "
                    "issued successfully, but its payment_reference won't be retrievable.",
                    ticket_uid,
                    schema,
                    exc_info=True,
                )

    passenger_phone = payload.get("passenger_phone")
    document_id = payload.get("document_id")
    if (
        body is not None
        and 200 <= resp.status_code < 300
        and isinstance(body, dict)
        and (passenger_phone or document_id)
    ):
        ticket_uid = (body.get("data") or {}).get("ticket_uid")
        if ticket_uid:
            try:
                await tenant_db.store_passenger_details(
                    ticket_uid,
                    schema,
                    passenger_phone.strip() if isinstance(passenger_phone, str) else None,
                    document_id.strip() if isinstance(document_id, str) else None,
                )
            except Exception:
                logger.warning(
                    "Failed to store passenger_phone/document_id for ticket %s (tenant=%s) — the "
                    "ticket was issued successfully, but these fields won't be retrievable.",
                    ticket_uid,
                    schema,
                    exc_info=True,
                )

    if body is not None and 200 <= resp.status_code < 300 and isinstance(body, dict):
        ticket_passenger_id = (body.get("data") or {}).get("passenger_id")
        if ticket_passenger_id:
            try:
                await ticket_ws_manager.broadcast(
                    {"event": "ticket_issued", "data": body.get("data")},
                    group=f"passenger_{ticket_passenger_id}",
                )
            except Exception:
                # A WebSocket broadcast failure must never fail ticket issuance — the
                # ticket already exists in Django; GET /tickets/my/?since= still finds
                # it on the next poll regardless of what happens here.
                logger.warning(
                    "Failed to broadcast ticket_issued over WebSocket for passenger %s.",
                    ticket_passenger_id,
                    exc_info=True,
                )

    if cache_key is not None and owns_reservation and body is not None:
        if 200 <= resp.status_code < 300:
            try:
                await redis.set(
                    cache_key,
                    json.dumps({"status_code": resp.status_code, "body": body}),
                    ex=IDEMPOTENCY_TTL_SECONDS,
                )
            except Exception:
                logger.warning(
                    "Redis unavailable while storing idempotency result (tenant=%s) — "
                    "ticket was issued, but a retry with this key won't be deduped.",
                    schema,
                    exc_info=True,
                )
        else:
            # Never cache a failed attempt as if it were the completed result — a
            # transient failure (auth hiccup, momentary DB issue, Django restart)
            # must not get replayed for IDEMPOTENCY_TTL_SECONDS (24h) on every
            # legitimate retry with this same key. Release the IN_PROGRESS
            # reservation immediately instead, so a retry actually retries rather
            # than either replaying a stale failure or waiting out the shorter
            # reservation TTL for no reason.
            try:
                await redis.delete(cache_key)
            except Exception:
                logger.warning(
                    "Redis unavailable while releasing a failed idempotency reservation "
                    "(tenant=%s) — a retry with this key will wait out the %ss reservation "
                    "TTL instead of retrying immediately.",
                    schema,
                    IDEMPOTENCY_RESERVATION_TTL_SECONDS,
                    exc_info=True,
                )

    return _passthrough(resp)


@router.get("/tickets/my/")
async def my_tickets(
    user: dict = Depends(get_current_user),
    since: Optional[str] = Query(
        None, description="ISO 8601 timestamp — only tickets issued strictly after this"
    ),
):
    """The calling passenger's own tickets, searched across every operator. Pass `since`
    (ISO 8601) to only get tickets issued after that time, for efficient polling —
    `400` if it isn't a valid timestamp. For real-time delivery instead of polling, see
    `WS /ws/tickets/`."""
    passenger_id = user.get("user_id")
    if not passenger_id:
        return _error("Invalid token.", 401)

    since_dt = None
    if since is not None:
        try:
            # tenant_db.find_tickets_for_passenger needs a real datetime — asyncpg
            # rejects a raw string against a timestamptz bind parameter outright.
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            return _error("`since` must be a valid ISO 8601 timestamp.", 400)

    tickets = await tenant_db.find_tickets_for_passenger(passenger_id, since=since_dt)
    await tenant_db.enrich_stop_names(tickets)
    await tenant_db.enrich_payment_references(tickets)
    await tenant_db.enrich_passenger_details(tickets)
    return _ok(data=[_serialize_ticket(t) for t in tickets])


def _media_url(path: Optional[str], domain: Optional[str]) -> Optional[str]:
    if not path or not domain:
        return None
    return f"https://{domain}/media/{path}"


def _serialize_crew(
    driver: Optional[dict],
    conductor: Optional[dict],
    vehicle: Optional[dict],
    domain: Optional[str],
) -> dict:
    return {
        "vehicle_no": vehicle.get("registration_no") if vehicle else None,
        "driver_name": driver.get("full_name_en") if driver else None,
        "conductor_name": conductor.get("full_name_en") if conductor else None,
        "owner_name": (vehicle.get("owner_name") or None) if vehicle else None,
    }


def _serialize_eticket(
    ticket: dict,
    company: Optional[dict],
    domain: Optional[str],
    crew: Optional[dict] = None,
) -> dict:
    return {
        **_serialize_ticket(ticket),
        "operator": {
            "schema": ticket.get("tenant_schema"),
            "domain": domain,
            "company_name": company.get("company_name") if company else None,
            "logo_url": _media_url(company.get("logo") if company else None, domain),
        },
        "crew": crew or {"driver": None, "conductor": None, "vehicle": None},
    }


async def _eticket_response(ticket_id: str, user: dict, by_uid: bool = False):
    """Shared logic for the two e-ticket lookup variants (by UUID / by ticket_uid)."""
    if by_uid:
        found = await tenant_db.find_ticket_by_uid(ticket_id)
    else:
        found = await tenant_db.find_ticket_by_id(ticket_id)
    if not found:
        return _error("Ticket not found.", 404)
    schema, ticket = found

    is_owner = str(ticket.get("passenger_id")) == str(user.get("user_id"))
    is_issuing_tenant_staff = user.get("tenant_schema") == schema
    if not (is_owner or is_issuing_tenant_staff):
        return _error("You are not authorized to view this ticket.", 403)

    await tenant_db.enrich_stop_names([ticket])
    await tenant_db.enrich_payment_references([ticket])
    await tenant_db.enrich_passenger_details([ticket])

    company, domain = await asyncio.gather(
        tenant_db.fetch_company_info(schema),
        tenant_db.get_domain_for_schema(schema),
    )

    # ── Crew: driver + conductor (staff profiles) + vehicle ──────────────────
    driver = conductor = vehicle = None
    trip_id = ticket.get("trip_id")

    async def _none() -> None:
        return None

    if trip_id:
        trip = await tenant_db.fetch_trip_details(schema, str(trip_id))
        if trip:
            driver, conductor, vehicle = await asyncio.gather(
                tenant_db.fetch_driver_for_eticket(schema, str(trip["driver_id"])) if trip.get("driver_id") else _none(),
                tenant_db.fetch_conductor_for_eticket(schema, str(trip["conductor_id"])) if trip.get("conductor_id") else _none(),
                tenant_db.fetch_vehicle_for_eticket(schema, str(trip["vehicle_id"])) if trip.get("vehicle_id") else _none(),
            )
    else:
        # POS ticket without a trip — look up conductor by user_id fallback
        ticket_conductor_user_id = ticket.get("conductor_id")
        if ticket_conductor_user_id:
            conductor = await tenant_db.fetch_conductor_by_user_id(schema, str(ticket_conductor_user_id))

    crew = _serialize_crew(driver, conductor, vehicle, domain)
    return _ok(data=_serialize_eticket(ticket, company, domain, crew))


@router.get("/tickets/uid/{ticket_uid}/eticket/")
async def get_eticket_by_uid(ticket_uid: str, user: dict = Depends(get_current_user)):
    """E-ticket for a ticket looked up by its human-readable **ticket_uid** (e.g.
    `KV-XXXXXXXX`) instead of the internal UUID. Useful when the mobile app only
    has the printed UID. Returns ticket data + operator company name and logo URL.
    `403` if the caller is neither the ticket's passenger nor staff of the issuing
    operator; `404` if not found."""
    return await _eticket_response(ticket_uid, user, by_uid=True)


@router.get("/tickets/{ticket_id}/")
async def get_ticket(ticket_id: str, user: dict = Depends(get_current_user)):
    """Single ticket lookup by ID — for support/dispute handling. Restricted to the
    ticket's own passenger or staff of the issuing operator; `403`/`404` otherwise."""
    found = await tenant_db.find_ticket_by_id(ticket_id)
    if not found:
        return _error("Ticket not found.", 404)
    schema, ticket = found

    is_owner = str(ticket.get("passenger_id")) == str(user.get("user_id"))
    is_issuing_tenant_staff = user.get("tenant_schema") == schema
    if not (is_owner or is_issuing_tenant_staff):
        return _error("You are not authorized to view this ticket.", 403)

    await tenant_db.enrich_stop_names([ticket])
    await tenant_db.enrich_payment_references([ticket])
    await tenant_db.enrich_passenger_details([ticket])
    return _ok(data=_serialize_ticket(ticket))


@router.post("/tickets/{ticket_id}/cancel/")
async def cancel_ticket(
    ticket_id: str,
    user: dict = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    """Voids a ticket — for a passenger-initiated cancellation, or for an integrator
    (e.g. Yatroo) reporting a refund it already processed on its own payment gateway
    (brief §8: "the corresponding void/cancel is posted to your platform"). Same
    access rule as `GET /tickets/{id}/`: the ticket's own passenger or staff of the
    issuing operator; `403`/`404` otherwise. A ticket already `USED` (boarded) or
    `EXPIRED` cannot be cancelled; cancelling an already-`CANCELLED` ticket is
    idempotent, not an error."""
    found = await tenant_db.find_ticket_by_id(ticket_id)
    if not found:
        return _error("Ticket not found.", 404)
    schema, ticket = found

    is_owner = str(ticket.get("passenger_id")) == str(user.get("user_id"))
    is_issuing_tenant_staff = user.get("tenant_schema") == schema
    if not (is_owner or is_issuing_tenant_staff):
        return _error("You are not authorized to cancel this ticket.", 403)

    domain = await tenant_db.get_domain_for_schema(schema)
    if not domain:
        return _error(f"No domain configured for tenant '{schema}'.", 500)

    # A passenger's own DB row has tenant_schema="" (correct -- passengers
    # aren't tied to one operator), which TenantSchemaMiddleware's
    # X-Tenant-Slug check rejects as a mismatch against the ticket's operator
    # schema -- and putting a different tenant_schema in the JWT payload
    # doesn't help, since that middleware reads the *authenticated user's own
    # DB row*, not the JWT claim. issue_ticket()'s self-service purchase path
    # already works around exactly this by authenticating the proxied call as
    # the tenant's own lazily-created self-service system account (whose DB
    # row genuinely has tenant_schema=schema) rather than the real passenger
    # -- same fix needed here, for the same reason. Staff cancelling a ticket
    # issued by their own tenant already has a matching tenant_schema, so
    # their own token is used unchanged.
    if is_issuing_tenant_staff:
        bearer_token = credentials.credentials
    else:
        account_id = await tenant_db.get_or_create_self_service_account(schema)
        bearer_token = _mint_self_service_token(account_id, schema)

    resp = await _proxy_to_django(
        "POST",
        f"/api/v1/ticketing/tickets/{ticket['ticket_uid']}/cancel/",
        schema,
        domain,
        bearer_token,
    )

    try:
        body = resp.json()
    except ValueError:
        body = None
    if isinstance(body, dict) and 200 <= resp.status_code < 300:
        ticket_passenger_id = (body.get("data") or {}).get("passenger_id")
        if ticket_passenger_id:
            try:
                await ticket_ws_manager.broadcast(
                    {"event": "ticket_cancelled", "data": body.get("data")},
                    group=f"passenger_{ticket_passenger_id}",
                )
            except Exception:
                # Same rule as issue_ticket()'s broadcast: a WS failure must never
                # fail the cancellation itself — the ticket is already voided in
                # Django by the time this runs.
                logger.warning(
                    "Failed to broadcast ticket_cancelled over WebSocket for passenger %s.",
                    ticket_passenger_id,
                    exc_info=True,
                )
    return _passthrough(resp)


@router.get("/tickets/{ticket_id}/eticket/")
async def get_eticket(ticket_id: str, user: dict = Depends(get_current_user)):
    """E-ticket view for a ticket by its internal **UUID**. Returns all ticket fields
    from `GET /tickets/{ticket_id}/` plus an `operator` object containing the issuing
    bus company's `company_name` and `logo_url` — the minimum a mobile app needs to
    render a branded e-ticket without a second request. Same access rules as the plain
    ticket lookup: restricted to the ticket's own passenger or staff of the issuing
    operator; `403`/`404` otherwise."""
    return await _eticket_response(ticket_id, user)


@router.post("/tickets/{ticket_id}/validate/")
async def validate_ticket(
    ticket_id: str,
    payload: dict = Body(default_factory=dict),
    user: dict = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    """Conductor QR scan — marks a ticket as boarded. Conductor-only.

    Optional `boarding_stop_id` in the body: if given, must match the ticket's own
    boarding stop — `403` on a mismatch, and the ticket is left untouched (not marked
    used). Omit it to keep the previous exists/unused/unexpired-only check."""
    if user.get("role") != CONDUCTOR_ROLE:
        raise HTTPException(status_code=403, detail="Only a conductor token can validate tickets.")

    found = await tenant_db.find_ticket_by_id(ticket_id)
    if not found:
        return _error("Ticket not found.", 404)
    schema, ticket = found

    # find_ticket_by_id() searches every tenant schema, so `schema` here is
    # whichever tenant actually issued the ticket — not necessarily this
    # conductor's own tenant. Django's TenantSchemaMiddleware independently
    # rejects an X-Tenant-Slug that doesn't match the caller's own
    # tenant_schema claim, so a cross-tenant attempt would already come back
    # as a 403 from the proxied call below — but this endpoint shouldn't
    # depend on that unrelated middleware to stay safe. Reject it here too,
    # explicitly, so this check doesn't quietly rely on a different file's
    # behavior to be correct.
    if schema != user.get("tenant_schema"):
        return _error("This ticket was not issued by your tenant.", 403)

    boarding_stop_id = payload.get("boarding_stop_id")
    if isinstance(boarding_stop_id, str) and boarding_stop_id.strip():
        expected_stop_id = str(ticket.get("from_stop_id") or "")
        if boarding_stop_id.strip() != expected_stop_id:
            return _error(
                "This ticket was purchased for a different boarding stop.",
                403,
                # ticket["from_stop_id"] comes back from asyncpg as a real uuid.UUID, not a
                # str — JSONResponse can't serialize that directly (caught live: this raised
                # a 500 TypeError before expected_stop_id was stringified above and reused
                # here, rather than re-reading the raw UUID a second time).
                errors={"expected_boarding_stop_id": expected_stop_id},
            )

    domain = await tenant_db.get_domain_for_schema(schema)
    if not domain:
        return _error(f"No domain configured for tenant '{schema}'.", 500)

    resp = await _proxy_to_django(
        "GET",
        f"/api/v1/ticketing/tickets/{ticket['ticket_uid']}/verify/",
        schema,
        domain,
        credentials.credentials,
    )
    return _passthrough(resp)
