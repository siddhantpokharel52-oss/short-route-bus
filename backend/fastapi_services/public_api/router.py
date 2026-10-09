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
from fastapi.responses import JSONResponse, RedirectResponse
from jose import JWTError, jwt as jose_jwt
from pydantic import BaseModel, ConfigDict, Field

from ..config import settings
from ..dependencies import bearer_scheme, get_current_user, get_redis
from . import tenant_db

router = APIRouter()
logger = logging.getLogger(__name__)

CONDUCTOR_ROLE = "CONDUCTOR"
PASSENGER_ROLE = "PASSENGER"


# ─────────────────────────────────────────────────────────────────────────────
# Request body models — documentation only, not new enforcement.
#
# Every field below is Optional, even ones a given endpoint actually requires,
# on purpose: which fields are required depends on the caller's role or which
# of several modes is being used (see each endpoint's own docstring), and the
# handlers already have their own descriptive `_error(...)` checks for that —
# checks that give a much more specific message than Pydantic's generic 422
# would. Making a field required here would just replace a helpful "route_id
# is required" with a generic validation error, for no benefit. These models
# exist solely so Swagger shows the real field names instead of an empty `{}`
# (previously every one of these endpoints took a bare `payload: dict`, which
# carries no schema FastAPI can introspect).
#
# `extra="allow"` on every model is a safety net, not a feature: issue_ticket()
# below forwards a filtered-but-otherwise-arbitrary payload straight through to
# Django's TicketSerializer (conductor cash-sale fields like fare_paid aren't
# even read by name in this file), so a strict model would silently drop any
# field not listed here. Every handler converts its model straight back to a
# plain dict via `.model_dump(exclude_none=True)` as its very first line —
# exclude_none so an omitted field is simply absent from the dict, exactly like
# it would be from a raw JSON body, not present with value None (which would
# break the boardingStopId/etc. camelCase-alias `in payload` checks below).
# ─────────────────────────────────────────────────────────────────────────────

class CollectorLoginRequest(BaseModel):
    # Pydantic v2 renders Optional[str] as `anyOf: [string, null]` in the JSON
    # schema -- Swagger UI's auto-example generator doesn't fill placeholders
    # for that shape and falls back to a bare `{}`, even though the real field
    # names are still visible on the Schema tab. json_schema_extra's "example"
    # is what actually populates the Example Value tab; every model below
    # needs one for the same reason.
    model_config = ConfigDict(extra="allow", json_schema_extra={"example": {
        "tenant_schema": "mayurbus", "phone": "9800000000", "password": "CorrectHorseBattery1!",
    }})
    tenant_schema: Optional[str] = Field(None, description="Required — which bus company's collector is logging in. Unlike every other call in this API, there is no JWT yet to carry it.")
    phone: Optional[str] = Field(None, description="The collector's own phone, as set by their tenant. Required.")
    email: Optional[str] = Field(None, description="Optional -- not used by this endpoint's own checks, only forwarded to Django's login serializer.")
    password: Optional[str] = Field(None, description="Required.")


class PassengerEntry(BaseModel):
    model_config = ConfigDict(extra="allow", json_schema_extra={"example": {
        "to_stop_id": "503626a1-bd20-42a1-be55-4b1518e4eaaa", "fare_paid": "30.00", "passenger_name": "Hari Prasad", "ticket_type": "ADULT",
    }})
    to_stop_id: Optional[str] = Field(None, description="This passenger's destination — origin is shared by the whole purchase.")
    fare_paid: Optional[str] = None
    passenger_name: Optional[str] = ""
    ticket_type: Optional[str] = Field(None, description="e.g. ADULT/STUDENT/SENIOR — matches a GET /fares/ result's ticket_type_code.")


class IssueTicketRequest(BaseModel):
    model_config = ConfigDict(extra="allow", json_schema_extra={"example": {
        "route_id": "134e0299-e705-4008-910e-edae38c3c312",
        "from_stop_id": "d1c11c52-4923-49d7-8c5b-f8d1dd59d8e2",
        "to_stop_id": "503626a1-bd20-42a1-be55-4b1518e4eaaa",
        "payment_reference": "yatroo-txn-8f3a1b2c",
        "fare_paid": "30.00",
    }})
    route_id: Optional[str] = Field(None, description="Passenger self-service: picks a route with no conductor/QR involved.")
    from_stop_id: Optional[str] = None
    to_stop_id: Optional[str] = None
    boardingStopId: Optional[str] = Field(None, description="Alias for from_stop_id.")
    droppingStopId: Optional[str] = Field(None, description="Alias for to_stop_id.")
    trip_qr_token: Optional[str] = Field(None, description="Passenger scan-to-book: token from GET /trips/{trip_id}/qr/.")
    payment_reference: Optional[str] = Field(None, description="Required for a passenger self-service purchase — there is no conductor present to collect cash for this flow.")
    tenant_schema: Optional[str] = Field(None, description="Required only if route_id is served by more than one operator.")
    ticket_type: Optional[str] = Field(None, description="e.g. ADULT/STUDENT — matches a GET /fares/ result's ticket_type_code.")
    passenger_phone: Optional[str] = None
    passengerPhone: Optional[str] = Field(None, description="Alias for passenger_phone.")
    document_id: Optional[str] = None
    documentId: Optional[str] = Field(None, description="Alias for document_id.")
    idempotency_key: Optional[str] = Field(None, description="Retried requests with the same key return the original result instead of duplicating.")
    fare_paid: Optional[str] = Field(None, description="Conductor cash sale: the fare actually collected.")
    payment_method: Optional[str] = Field(None, description="Conductor cash sale: defaults to CASH.")
    vehicle_id: Optional[str] = Field(None, description="Conductor cash sale: defaults to the conductor's own active bus if omitted.")
    passenger_name: Optional[str] = None


class IssueGroupTicketsRequest(BaseModel):
    model_config = ConfigDict(extra="allow", json_schema_extra={"example": {
        "route_id": "134e0299-e705-4008-910e-edae38c3c312",
        "from_stop_id": "d1c11c52-4923-49d7-8c5b-f8d1dd59d8e2",
        "payment_reference": "yatroo-txn-8f3a1b2c",
        "passengers": [
            {"to_stop_id": "503626a1-bd20-42a1-be55-4b1518e4eaaa", "fare_paid": "30.00", "passenger_name": "Hari Prasad", "ticket_type": "ADULT"},
            {"to_stop_id": "503626a1-bd20-42a1-be55-4b1518e4eaaa", "fare_paid": "15.00", "passenger_name": "Sita Kumari", "ticket_type": "STUDENT"},
        ],
    }})
    route_id: Optional[str] = Field(None, description="Required.")
    payment_reference: Optional[str] = Field(None, description="Required — there is no conductor present to collect cash for this flow.")
    passengers: Optional[list[PassengerEntry]] = Field(None, description="Required, 1-20 passengers sharing one purchase.")
    tenant_schema: Optional[str] = Field(None, description="Required only if route_id is served by more than one operator.")
    from_stop_id: Optional[str] = None
    payment_method: Optional[str] = Field(None, description="Defaults to CASH.")
    idempotency_key: Optional[str] = None


class StartNamastePayCheckoutRequest(BaseModel):
    model_config = ConfigDict(extra="allow", json_schema_extra={"example": {
        "route_id": "134e0299-e705-4008-910e-edae38c3c312",
        "from_stop_id": "d1c11c52-4923-49d7-8c5b-f8d1dd59d8e2",
        "return_to": "https://yatroo.app/payment/return",
        "passengers": [{"to_stop_id": "503626a1-bd20-42a1-be55-4b1518e4eaaa", "fare_paid": "30.00", "passenger_name": "Hari Prasad", "ticket_type": "ADULT"}],
    }})
    route_id: Optional[str] = Field(None, description="Required for a passenger's own self-service checkout; not used for a conductor's walk-in checkout.")
    from_stop_id: Optional[str] = None
    vehicle_id: Optional[str] = Field(None, description="Conductor walk-in checkout only — auto-filled from their active allocation if omitted.")
    return_to: Optional[str] = Field(None, description="Required for a passenger self-service checkout (where the app lands once payment is confirmed); meaningless for a conductor's own device.")
    tenant_schema: Optional[str] = Field(None, description="Required only if route_id is served by more than one operator.")
    passengers: Optional[list[PassengerEntry]] = Field(None, description="Required, 1-20 passengers sharing one payment.")


class ReserveTicketRequest(BaseModel):
    model_config = ConfigDict(extra="allow", json_schema_extra={"example": {
        "route_id": "134e0299-e705-4008-910e-edae38c3c312",
        "from_stop_id": "d1c11c52-4923-49d7-8c5b-f8d1dd59d8e2",
        "vehicle_id": "8924bdb4-6953-4e8a-bdce-b7c7e8c7e8dc",
        "passengers": [{"to_stop_id": "503626a1-bd20-42a1-be55-4b1518e4eaaa", "fare_paid": "30.00", "passenger_name": "Hari Prasad", "ticket_type": "ADULT"}],
    }})
    route_id: Optional[str] = Field(None, description="Required.")
    from_stop_id: Optional[str] = None
    vehicle_id: Optional[str] = Field(None, description="Which specific bus, from GET /routes/{route_id}/buses/. Optional for a passenger (resolved at boarding); auto-filled from a conductor's own active allocation when they create their own reservation and omit it.")
    tenant_schema: Optional[str] = Field(None, description="Required only if route_id is served by more than one operator.")
    passengers: Optional[list[PassengerEntry]] = Field(None, description="Required, 1-20 passengers sharing one reservation.")


class EditReservationRequest(BaseModel):
    model_config = ConfigDict(extra="allow", json_schema_extra={"example": {
        "vehicle_id": "8924bdb4-6953-4e8a-bdce-b7c7e8c7e8dc",
        "passengers": [{"to_stop_id": "503626a1-bd20-42a1-be55-4b1518e4eaaa", "fare_paid": "30.00", "passenger_name": "Hari Prasad", "ticket_type": "ADULT"}],
    }})
    route_id: Optional[str] = None
    from_stop_id: Optional[str] = None
    vehicle_id: Optional[str] = None
    passengers: Optional[list[PassengerEntry]] = Field(None, description="If given, replaces the whole passenger list (1-20) and the reservation's amount is recomputed from it.")


class ValidateReservationRequest(BaseModel):
    model_config = ConfigDict(extra="allow", json_schema_extra={"example": {"decision": "valid"}})
    decision: Optional[str] = Field(None, description="'valid' (pay via NamastePay), 'cash' (settle immediately, conductor has the fare in hand), or 'invalid' (reject/delete, no payment attempted). Required.")


class ValidateTicketRequest(BaseModel):
    model_config = ConfigDict(extra="allow", json_schema_extra={"example": {"boarding_stop_id": "d1c11c52-4923-49d7-8c5b-f8d1dd59d8e2"}})
    boarding_stop_id: Optional[str] = Field(None, description="If given, must match the ticket's own boarding stop — 403 on a mismatch, ticket left untouched. Omit to skip this check.")


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
    bearer_token: Optional[str],
    json_body: Optional[dict] = None,
):
    """bearer_token is Optional only for the login proxy below -- there is no
    token yet at that point, that's the whole call's purpose. Every other
    caller still passes a real one."""
    url = f"{settings.DJANGO_INTERNAL_BASE_URL}{path}"
    headers = {"Host": domain, "X-Tenant-Slug": schema}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    async with httpx.AsyncClient(timeout=10.0) as client:
        return await client.request(method, url, headers=headers, json=json_body)


@router.get(
    "/companies/",
    tags=["Public API — Auth"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": [
            {"schema_name": "mayurbus", "name": "Mayur Yatayat"},
            {"schema_name": "sajha", "name": "Sajha Yatayat"},
        ],
        "message": "Success",
        "errors": None,
    }}}}},
)
async def list_companies():
    """The bus-company picker for `POST /auth/login/` below -- a collector's
    phone number is only guaranteed unique within their own tenant, not
    globally, so the login screen needs this list to let the user say which
    company they're signing in to before `tenant_schema` can be sent.
    Unauthenticated by design, same as login itself (there's no JWT yet).
    Only ACTIVE tenants -- a PENDING/SUSPENDED one has no real conductors to
    log in as yet."""
    companies = await tenant_db.list_active_bus_companies()
    return _ok(data=companies)


@router.post(
    "/auth/login/",
    tags=["Public API — Auth"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "access": "eyJhbGciOiJIUzI1NiIs...",
            "refresh": "eyJhbGciOiJIUzI1NiIs...",
            "role": "CONDUCTOR",
            "tenant_schema": "mayurbus",
            "full_name": "Hari Prasad",
            "user_id": "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
            "must_change_password": False,
        },
        "message": "Login successful.",
        "errors": None,
        "meta": {"timestamp": "2026-09-21T08:00:00.000000+00:00"},
    }}}}},
)
async def collector_login(payload: CollectorLoginRequest = Body(default_factory=CollectorLoginRequest)):
    """Direct phone+password login for a Collector app -- the credentials a
    bus company sets for their own conductor via
    `POST /operator/conductors/{id}/create-login/` (tenant-portal only, not
    reachable from this consumer API). This is deliberately NOT the
    federated-login/HMAC exchange the rest of this API uses for Yatroo's
    passenger identity: a collector's login is issued directly by the
    tenant, not by Yatroo vouching for one of its own users.

    This is a thin, unauthenticated-by-design proxy to Django's own login
    endpoint (`/api/v1/auth/login/`), which is not otherwise reachable from
    the outside — only `/public-api/v1/` is exposed publicly (see the
    production nginx config), so every externally-reachable capability,
    including this one, has to live under this router.

    `tenant_schema` is required in the body: unlike every other call in this
    API, there is no JWT yet to carry it, and phone numbers are only
    guaranteed unique within one tenant, not globally — so the caller must
    say which bus company's collector is logging in. `phone` is required
    too (not just preferred) -- this endpoint exists for the Collector
    sign-in screen specifically, which only ever collects a phone number.
    `email` is still accepted in the body and still forwarded to Django's
    own login serializer (which does support email+password for other
    roles), but it's never required here."""
    payload = payload.model_dump(exclude_none=True)
    tenant_schema = (payload.get("tenant_schema") or "").strip()
    if not tenant_schema:
        return _error("tenant_schema is required.", 400)
    # phone is the only identifier the real Collector sign-in screen ever
    # collects (see its own UI: Bus company / Phone number / Password, no
    # email field) -- required here, not just "preferred", so a malformed
    # request fails with a clear "phone is required" instead of silently
    # falling through to Django's own ambiguous "Invalid credentials."
    if not payload.get("phone"):
        return _error("phone is required.", 400)
    if not payload.get("password"):
        return _error("password is required.", 400)

    domain = await tenant_db.get_domain_for_schema(tenant_schema)
    if not domain:
        return _error(f"No domain configured for tenant '{tenant_schema}'.", 500)

    resp = await _proxy_to_django(
        "POST", "/api/v1/auth/login/", tenant_schema, domain, None, json_body=payload,
    )
    return _passthrough(resp)


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
        "child_fare": f.get("child_fare"),
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

@router.get(
    "/routes/",
    tags=["Public API — Routes & Fares"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": [{
            "id": "826b8836-8621-44a0-82f2-96aaee86f728",
            "route_code": "6767",
            "name_en": "Balkhu — Kamal Pokhari",
            "name_ne": "बल्खु — कमल पोखरी",
            "start_stop_id": "484d042d-f919-4a7d-8595-2371f3557ef5",
            "end_stop_id": "87caeef9-fbb9-48d9-a66e-5674ccbf16bf",
            "distance_km": "11.13",
            "route_type": "EXCLUSIVE",
            "status": "APPROVED",
            "geojson_path": "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":[[85.216,27.692]]}}",
            "description": "Runs via Kalimati and Tripureshwor",
            "created_at": "2026-09-03T07:26:02.372892Z",
            "updated_at": "2026-09-03T07:26:10.821895Z",
            "nearest_stop_distance_km": None,
            "from_sequence_no": None,
            "to_sequence_no": None,
        }],
        "message": "Success",
        "errors": None,
    }}}}},
)
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


@router.get(
    "/routes/{route_id}/",
    tags=["Public API — Routes & Fares"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "id": "826b8836-8621-44a0-82f2-96aaee86f728",
            "route_code": "6767",
            "name_en": "Balkhu — Kamal Pokhari",
            "name_ne": "बल्खु — कमल पोखरी",
            "start_stop_id": "484d042d-f919-4a7d-8595-2371f3557ef5",
            "end_stop_id": "87caeef9-fbb9-48d9-a66e-5674ccbf16bf",
            "distance_km": "11.13",
            "route_type": "EXCLUSIVE",
            "status": "APPROVED",
            "geojson_path": "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":[[85.216,27.692]]}}",
            "description": "Runs via Kalimati and Tripureshwor",
            "created_at": "2026-09-03T07:26:02.372892Z",
            "updated_at": "2026-09-03T07:26:10.821895Z",
            "nearest_stop_distance_km": None,
            "from_sequence_no": None,
            "to_sequence_no": None,
            "stops": [{
                "route_stop_id": "32095b98-208a-4599-857b-4cd3eafdd987",
                "sequence_no": 1,
                "estimated_time_from_start": 0,
                "distance_from_start_km": 0.0,
                "stop_id": "484d042d-f919-4a7d-8595-2371f3557ef5",
                "stop_code": "KV0F7874",
                "name_en": "Balkhu",
                "name_ne": "बल्खु",
                "latitude": "27.6928572",
                "longitude": "85.2158935",
            }],
            "total_stops": 6,
            "estimated_duration_minutes": 35,
            "first_bus": "06:00:00",
            "last_bus": "20:30:00",
            "frequency_minutes_min": 10,
            "frequency_minutes_max": 20,
            "total_buses": 4,
        },
        "message": "Success",
        "errors": None,
    }}}}},
)
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


@router.get(
    "/routes/{route_id}/buses/",
    tags=["Public API — Routes & Fares"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": [{
            "id": "8924bdb4-6953-4e8a-bdce-b7c7e8c7e8dc",
            "bus_number": "Bus 26",
            "registration_no": "BA 1 KHA 2155",
            "capacity_seated": 32,
            "capacity_standing": 10,
        }],
        "message": "Success",
        "errors": None,
    }}}}},
)
async def list_route_buses(
    route_id: str,
    tenant_schema: Optional[str] = Query(None, description="Required only if route_id is served by more than one operator."),
):
    """The actual buses a passenger or conductor can pick from when generating a
    ticket for this route (`POST /tickets/reserve/`'s `vehicle_id`) — not just a
    count like `total_buses` on the route-detail endpoint above. Same
    "serves this route" definition as that count (`fleet.Vehicle.assigned_route_id`,
    excluding retired/inactive/breakdown buses)."""
    operator_schemas = await tenant_db.get_route_operator_schemas(route_id)
    if not operator_schemas:
        return _error("Route not found or not currently served by any operator.", 404)
    if len(operator_schemas) == 1:
        schema = operator_schemas[0]
    elif tenant_schema and tenant_schema in operator_schemas:
        schema = tenant_schema
    else:
        return _error(
            "This route is served by more than one operator — specify which one via "
            "`tenant_schema`.",
            400,
            errors={"operators": operator_schemas},
        )
    buses = await tenant_db.list_operating_buses_for_route(route_id, schema)
    return _ok(data=buses)


@router.get(
    "/routes/{route_id}/stops/",
    tags=["Public API — Routes & Fares"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": [{
            "route_stop_id": "32095b98-208a-4599-857b-4cd3eafdd987",
            "sequence_no": 1,
            "estimated_time_from_start": 0,
            "distance_from_start_km": 0.0,
            "stop_id": "484d042d-f919-4a7d-8595-2371f3557ef5",
            "stop_code": "KV0F7874",
            "name_en": "Balkhu",
            "name_ne": "बल्खु",
            "latitude": "27.6928572",
            "longitude": "85.2158935",
        }],
        "message": "Success",
        "errors": None,
    }}}}},
)
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


@router.get(
    "/stops/autocomplete/",
    tags=["Public API — Routes & Fares"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": [{
            "id": "484d042d-f919-4a7d-8595-2371f3557ef5",
            "stop_code": "KV0F7874",
            "name_en": "Balkhu",
            "name_ne": "बल्खु",
            "latitude": "27.6928572",
            "longitude": "85.2158935",
            "distance_km": 0.42,
        }],
        "message": "Success",
        "errors": None,
    }}}}},
)
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

@router.get(
    "/fares/",
    tags=["Public API — Routes & Fares"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": [{
            "id": "3f1b2c4d-5678-90ab-cdef-1234567890ab",
            "route_id": "826b8836-8621-44a0-82f2-96aaee86f728",
            "zone_from": "Balkhu",
            "zone_to": "Kalimati",
            "base_fare": "25.00",
            "peak_fare": "30.00",
            "student_fare": "15.00",
            "senior_citizen_fare": "15.00",
            "child_fare": "10.00",
            "ticket_type_id": "14e05061-78fe-4ed8-af60-bb02e78d139f",
            "ticket_type_code": "ADULT",
            "ticket_type_name": "Adult",
            "distance_km": 3.2,
            "time_minutes": 12,
        }],
        "message": "Success",
        "errors": None,
    }}}}},
)
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


@router.get(
    "/routes/{route_id}/timetable/",
    tags=["Public API — Routes & Fares"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "day_type": "WEEKDAY",
            "slots": [{
                "timetable_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                "day_type": "WEEKDAY",
                "version": 1,
                "effective_date": "2026-01-01",
                "slot_id": "f1e2d3c4-b5a6-9876-5432-10fedcba9876",
                "departure_time": "06:00:00",
                "arrival_time": "06:35:00",
                "frequency_minutes": 15,
                "tenant_schema": "mayurbus",
            }],
        },
        "message": "Scheduled timetable (not live — for real-time position use a live-tracking endpoint).",
        "errors": None,
    }}}}},
)
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

def _serialize_reservation(r: dict) -> dict:
    """Mirrors apps.ticketing.NamastePayCheckoutSerializer's field set, for a
    conductor's pre-payment reservation scan — see get_reservation() below."""
    return {
        "reference_id": r["reference_id"],
        "checkout_id": r.get("checkout_id"),
        "route_id": str(r["route_id"]) if r.get("route_id") else None,
        "from_stop_id": str(r["from_stop_id"]) if r.get("from_stop_id") else None,
        "amount": str(r["amount"]),
        "status": r["status"],
        "passengers": r.get("passengers") or [],
    }


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
        # Which purchase this ticket belongs to (CB2 group bookings) -- null for a
        # single ticket issued on its own. A client can already group tickets that
        # share a booking_id without this endpoint needing to nest the response.
        "booking_id": t.get("booking_id"),
        "vehicle_id": t.get("vehicle_id"),
        # bus_number/route_id/route_code/route_name are resolved by
        # tenant_db.enrich_booking_and_vehicle()/enrich_route_names() -- not
        # columns on Ticket itself (route_id especially: recovered via Booking or
        # scheduling_trip, or left None when a ticket genuinely has neither).
        "bus_number": t.get("bus_number"),
        "route_id": t.get("route_id"),
        "route_code": t.get("route_code"),
        "route_name": t.get("route_name"),
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


def _serialize_trip(t: dict) -> dict:
    return {
        "id": t["id"],
        "trip_code": t.get("trip_code"),
        "route_id": t.get("route_id"),
        "vehicle_id": t.get("vehicle_id"),
        "date": t.get("date"),
        "scheduled_departure_time": t.get("scheduled_departure_time"),
        "scheduled_arrival_time": t.get("scheduled_arrival_time"),
        "status": t.get("status"),
    }


@router.get(
    "/trips/mine/",
    tags=["Public API — Trips"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": [{
            "id": "0de95bbd-9a1f-4921-8037-c41d39c6a6a8",
            "trip_code": "TRIP-A1B2C3",
            "route_id": "826b8836-8621-44a0-82f2-96aaee86f728",
            "vehicle_id": "b57cd49f-03cb-49ee-b69b-0b86c1b0d702",
            "date": "2026-09-24",
            "scheduled_departure_time": "06:00:00",
            "scheduled_arrival_time": "06:35:00",
            "status": "SCHEDULED",
        }],
        "message": "Success",
        "errors": None,
    }}}}},
)
async def my_trips(user: dict = Depends(get_current_user)):
    """Conductor-only. Today's trip(s) assigned to the caller. This is the missing
    piece that made GET /trips/{trip_id}/qr/ practically unreachable for anyone but
    our own dispatchers: every trip-listing action on apps.scheduling.TripViewSet is
    Operations-role only (internal Django API our own tenant-portal calls), so a
    conductor -- ours, or a future Yatroo conductor-mode session -- had no path to
    discover their own trip_id at all. Same ownership guarantee as GET
    /trips/{trip_id}/qr/ itself (tenant_db.fetch_trips_for_conductor_today uses the
    identical conductor_id filter) -- can never return someone else's trip. `403` if
    not a conductor; empty list (not an error) if nothing's assigned today."""
    if user.get("role") != CONDUCTOR_ROLE:
        raise HTTPException(status_code=403, detail="Only a conductor can list their own trips.")
    schema = user.get("tenant_schema")
    conductor_id = user.get("user_id")
    if not schema or not conductor_id:
        raise HTTPException(status_code=400, detail="This conductor account has no tenant assigned.")
    trips = await tenant_db.fetch_trips_for_conductor_today(schema, conductor_id)
    return _ok(data=[_serialize_trip(t) for t in trips])


@router.get(
    "/trips/{trip_id}/qr/",
    tags=["Public API — Trips"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "trip_qr_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0cmlwX2lkIjoiNmIyYzNkNGUifQ.abc123",
            "expires_in": 300,
            "trip_id": "6b2c3d4e-5f60-7890-abcd-ef1234567890",
            "trip_code": "TRIP-A1B2C3",
        },
        "message": "Success",
        "errors": None,
    }}}}},
)
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


@router.post(
    "/tickets/",
    tags=["Public API — Tickets"],
    responses={201: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "id": "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
            "ticket_uid": "TKT-A1B2C3D4E5F6",
            "ticket_type_id": "14e05061-78fe-4ed8-af60-bb02e78d139f",
            "trip_id": None,
            "vehicle_id": None,
            "passenger_id": "11111111-2222-3333-4444-555555555555",
            "passenger_name": "",
            "conductor_id": None,
            "issued_at": "2026-09-21T08:00:00Z",
            "paid_at": "2026-09-21T08:00:00Z",
            "issued_by": "MOBILE",
            "valid_until": "2026-09-21T23:59:59Z",
            "fare_paid": "25.00",
            "payment_method": "ESEWA",
            "payment_reference": "yatroo-txn-8f3a1b2c",
            "qr_code": "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAAAAAB...",
            "status": "VALID",
            "from_stop_id": "484d042d-f919-4a7d-8595-2371f3557ef5",
            "to_stop_id": "87caeef9-fbb9-48d9-a66e-5674ccbf16bf",
            "from_stop_name": None,
            "to_stop_name": None,
            "vehicle_bus_number": None,
        },
        "message": "Ticket issued successfully.",
        "errors": None,
        "meta": {"timestamp": "2026-09-21T08:00:00.000000+00:00"},
    }}}}},
)
async def issue_ticket(
    payload: IssueTicketRequest,
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
    payload = payload.model_dump(exclude_none=True)
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
        # The trip's vehicle is known server-side the moment the trip is -- resolve it
        # here so the created ticket carries which bus it was actually issued on.
        trip_details = await tenant_db.fetch_trip_details(schema, trip_id_override)
        if trip_details and trip_details.get("vehicle_id"):
            # asyncpg returns a uuid column as a real uuid.UUID, not a str --
            # httpx's json= encoder can't serialize that (same class of bug
            # already caught and fixed for validate_ticket()'s from_stop_id
            # below). Caught live via a real scan-to-book call through this
            # exact path, not a mock -- a mocked _proxy_to_django call never
            # actually JSON-encodes anything.
            django_payload["vehicle_id"] = str(trip_details["vehicle_id"])
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
                body["data"]["payment_reference"] = payment_reference.strip()
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

    if body is not None:
        return JSONResponse(status_code=resp.status_code, content=body)
    return _passthrough(resp)


@router.post(
    "/tickets/group/",
    tags=["Public API — Tickets"],
    responses={201: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "id": "5c4b3a29-1807-4665-9524-13f0e2d1c0b9",
            "passenger_id": "11111111-2222-3333-4444-555555555555",
            "route_id": "826b8836-8621-44a0-82f2-96aaee86f728",
            "from_stop_id": "484d042d-f919-4a7d-8595-2371f3557ef5",
            "total_fare": "65.00",
            "payment_method": "ESEWA",
            "booked_at": "2026-09-21T08:00:00Z",
            "status": "VALID",
            "tickets": [
                {
                    "id": "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
                    "ticket_uid": "TKT-A1B2C3D4E5F6",
                    "ticket_type_id": "14e05061-78fe-4ed8-af60-bb02e78d139f",
                    "trip_id": None,
                    "vehicle_id": None,
                    "passenger_id": "11111111-2222-3333-4444-555555555555",
                    "passenger_name": "Hari Prasad",
                    "conductor_id": None,
                    "issued_at": "2026-09-21T08:00:00Z",
                    "paid_at": "2026-09-21T08:00:00Z",
                    "issued_by": "MOBILE",
                    "valid_until": "2026-09-21T23:59:59Z",
                    "fare_paid": "25.00",
                    "payment_method": "ESEWA",
                    "payment_reference": "yatroo-txn-8f3a1b2c",
                    "qr_code": "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAAAAAB...",
                    "status": "VALID",
                    "from_stop_id": "484d042d-f919-4a7d-8595-2371f3557ef5",
                    "to_stop_id": "87caeef9-fbb9-48d9-a66e-5674ccbf16bf",
                    "from_stop_name": None,
                    "to_stop_name": None,
                    "vehicle_bus_number": None,
                },
                {
                    "id": "1a2b3c4d-5e6f-7890-abcd-ef1234567890",
                    "ticket_uid": "TKT-B2C3D4E5F6A1",
                    "ticket_type_id": "23f16172-89gf-5fe1-cb71-cc13f89f240g",
                    "trip_id": None,
                    "vehicle_id": None,
                    "passenger_id": "11111111-2222-3333-4444-555555555555",
                    "passenger_name": "Sita Kumari",
                    "conductor_id": None,
                    "issued_at": "2026-09-21T08:00:00Z",
                    "paid_at": "2026-09-21T08:00:00Z",
                    "issued_by": "MOBILE",
                    "valid_until": "2026-09-21T23:59:59Z",
                    "fare_paid": "40.00",
                    "payment_method": "ESEWA",
                    "payment_reference": "yatroo-txn-8f3a1b2c",
                    "qr_code": "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAAAAAC...",
                    "status": "VALID",
                    "from_stop_id": "484d042d-f919-4a7d-8595-2371f3557ef5",
                    "to_stop_id": "f7e77517-eeff-4054-b4a8-1179cebc6291",
                    "from_stop_name": None,
                    "to_stop_name": None,
                    "vehicle_bus_number": None,
                },
            ],
        },
        "message": "Success",
        "errors": None,
        "meta": {"timestamp": "2026-09-21T08:00:00.000000+00:00"},
    }}}}},
)
async def issue_group_tickets(
    payload: IssueGroupTicketsRequest,
    user: dict = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Group booking (CB2) — a family buying several tickets together as one purchase.
    Passenger self-service only, same journey step as the single-ticket self-service
    path in issue_ticket() above (no conductor/QR involved), just for N passengers at
    once instead of one. `route_id` + a **required** `payment_reference`, plus
    `passengers`: a list of 1-20 `{ticket_type?, passenger_name?, fare_paid}` — a family
    can mix adult/student/senior in one booking. All tickets are issued together or not
    at all (Django's BookingCreateSerializer wraps the whole group in one transaction).

    This deliberately duplicates rather than shares issue_ticket()'s self-service
    schema-resolution block: that function already juggles three intertwined role
    branches and an idempotency reservation lifecycle, and refactoring it to share ~25
    lines with this one new caller would be a riskier change than the duplication it
    would save."""
    payload = payload.model_dump(exclude_none=True)
    if user.get("role") != PASSENGER_ROLE:
        raise HTTPException(status_code=403, detail="Only a passenger token can book a group of tickets.")

    passenger_id = user.get("user_id")
    if not passenger_id:
        return _error("Invalid token.", 401)

    route_id = payload.get("route_id")
    if not isinstance(route_id, str) or not route_id.strip():
        return _error("route_id is required.", 400)

    payment_reference = payload.get("payment_reference")
    if not isinstance(payment_reference, str) or not payment_reference.strip():
        return _error(
            "payment_reference is required for a group ticket purchase — there is no "
            "conductor present to collect cash for this flow.",
            400,
        )

    passengers = payload.get("passengers")
    if not isinstance(passengers, list) or not passengers:
        return _error("passengers must be a non-empty list.", 400)

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

    resolved_passengers = []
    for passenger in passengers:
        entry = {
            "fare_paid": passenger.get("fare_paid"),
            "passenger_name": passenger.get("passenger_name", ""),
            # Destination is per passenger, origin (from_stop_id, below) is
            # shared by the whole booking — Team Implementation Guide §3.2.
            "to_stop_id": passenger.get("to_stop_id"),
        }
        ticket_type_code = passenger.get("ticket_type")
        if isinstance(ticket_type_code, str) and ticket_type_code.strip():
            ticket_type_id = await tenant_db.resolve_ticket_type_id(ticket_type_code.strip().upper())
            if ticket_type_id is None:
                return _error(f"Unknown ticket_type: {ticket_type_code!r}.", 400)
            entry["ticket_type_id"] = ticket_type_id
        resolved_passengers.append(entry)

    account_id = await tenant_db.get_or_create_self_service_account(schema)
    bearer_token = _mint_self_service_token(account_id, schema)

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
                "Redis unavailable for idempotency check (tenant=%s) — issuing group tickets without "
                "dedupe protection.",
                schema,
                exc_info=True,
            )
            cache_key = None
            owns_reservation = False

    domain = await tenant_db.get_domain_for_schema(schema)
    if not domain:
        return _error(f"No domain configured for tenant '{schema}'.", 500)

    django_payload = {
        "route_id": route_id,
        "from_stop_id": payload.get("from_stop_id"),
        "payment_method": payload.get("payment_method", "CASH"),
        "passenger_id": passenger_id,
        "issued_by": "MOBILE",
        "passengers": resolved_passengers,
    }
    resp = await _proxy_to_django(
        "POST", "/api/v1/ticketing/bookings/", schema, domain, bearer_token, json_body=django_payload,
    )

    try:
        body = resp.json()
    except ValueError:
        body = None

    if body is not None and 200 <= resp.status_code < 300 and isinstance(body, dict):
        tickets = ((body.get("data") or {}).get("tickets")) or []
        for ticket in tickets:
            ticket_uid = ticket.get("ticket_uid")
            if not ticket_uid:
                continue
            try:
                await tenant_db.store_payment_reference(ticket_uid, schema, payment_reference.strip())
                ticket["payment_reference"] = payment_reference.strip()
            except Exception:
                logger.warning(
                    "Failed to store payment_reference for ticket %s in group booking (tenant=%s) — "
                    "the ticket was issued successfully, but its payment_reference won't be retrievable.",
                    ticket_uid,
                    schema,
                    exc_info=True,
                )
            try:
                await ticket_ws_manager.broadcast(
                    {"event": "ticket_issued", "data": ticket}, group=f"passenger_{passenger_id}",
                )
            except Exception:
                logger.warning(
                    "Failed to broadcast ticket_issued over WebSocket for passenger %s (group booking).",
                    passenger_id,
                    exc_info=True,
                )

    if cache_key is not None and owns_reservation and body is not None:
        if 200 <= resp.status_code < 300:
            try:
                await redis.set(
                    cache_key, json.dumps({"status_code": resp.status_code, "body": body}), ex=IDEMPOTENCY_TTL_SECONDS,
                )
            except Exception:
                logger.warning(
                    "Redis unavailable while storing idempotency result (tenant=%s) — a group-booking "
                    "retry with this key won't be deduped.",
                    schema,
                    exc_info=True,
                )
        else:
            try:
                await redis.delete(cache_key)
            except Exception:
                logger.warning(
                    "Redis unavailable while releasing a failed idempotency reservation (tenant=%s).",
                    schema,
                    exc_info=True,
                )

    if body is not None:
        return JSONResponse(status_code=resp.status_code, content=body)
    return _passthrough(resp)


@router.post(
    "/tickets/namastepay/checkout/",
    tags=["Public API — NamastePay Payments"],
    responses={201: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "checkout_id": "npc_8f3a1b2c9d4e5f60",
            "payment_url": "https://checkout.namastepay.com/pay/npc_8f3a1b2c9d4e5f60",
            "expires_at": "2026-09-21T08:15:00Z",
        },
        "message": "Success",
        "errors": None,
        "meta": {"timestamp": "2026-09-21T08:00:00.000000+00:00"},
    }}}}},
)
async def start_namastepay_checkout(
    payload: StartNamastePayCheckoutRequest,
    user: dict = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    """Starts a NamastePay hosted checkout (CB9/CB4) — either passenger self-service
    or a conductor creating one for a walk-in passenger (CB4/C2's "dynamic QR" case:
    the conductor's device renders the returned `payment_url` as a QR locally — no
    separate QR-generation API is needed). Same schema-resolution/per-passenger
    `ticket_type` handling as issue_group_tickets() above, duplicated for the same
    reason stated there. Nothing is issued here — only `namastepay_return()` below
    (passenger path) or CB4's own lookup+confirm (conductor path) actually creates a
    Ticket, and only once the payment is independently confirmed server-side.

    `return_to` is where the passenger's app wants to land once payment is confirmed
    (or fails) — required for the passenger path; meaningless for a conductor's own
    device, which is never redirected anywhere, so it's optional there."""
    payload = payload.model_dump(exclude_none=True)
    role = user.get("role")
    passenger_id = None
    route_id = payload.get("route_id")

    if role == CONDUCTOR_ROLE:
        schema = user.get("tenant_schema")
        if not schema:
            raise HTTPException(status_code=400, detail="This conductor account has no tenant assigned.")
        return_to = payload.get("return_to") or None
        bearer_token = credentials.credentials
    elif role == PASSENGER_ROLE:
        passenger_id = user.get("user_id")
        if not passenger_id:
            return _error("Invalid token.", 401)

        if not isinstance(route_id, str) or not route_id.strip():
            return _error("route_id is required.", 400)

        return_to = payload.get("return_to")
        if not isinstance(return_to, str) or not return_to.strip():
            return _error("return_to is required.", 400)

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

        account_id = await tenant_db.get_or_create_self_service_account(schema)
        bearer_token = _mint_self_service_token(account_id, schema)
    else:
        raise HTTPException(status_code=403, detail="Only a passenger or conductor token can start a checkout.")

    passengers = payload.get("passengers")
    if not isinstance(passengers, list) or not passengers:
        return _error("passengers must be a non-empty list.", 400)

    resolved_passengers = []
    for passenger in passengers:
        entry = {
            "fare_paid": passenger.get("fare_paid"),
            "passenger_name": passenger.get("passenger_name", ""),
            # Destination is per passenger, origin (from_stop_id, below) is
            # shared by the whole checkout — Team Implementation Guide §3.2.
            "to_stop_id": passenger.get("to_stop_id"),
        }
        ticket_type_code = passenger.get("ticket_type")
        if isinstance(ticket_type_code, str) and ticket_type_code.strip():
            ticket_type_id = await tenant_db.resolve_ticket_type_id(ticket_type_code.strip().upper())
            if ticket_type_id is None:
                return _error(f"Unknown ticket_type: {ticket_type_code!r}.", 400)
            entry["ticket_type_id"] = ticket_type_id
        resolved_passengers.append(entry)

    domain = await tenant_db.get_domain_for_schema(schema)
    if not domain:
        return _error(f"No domain configured for tenant '{schema}'.", 500)

    django_payload = {
        "route_id": route_id,
        "from_stop_id": payload.get("from_stop_id"),
        "vehicle_id": payload.get("vehicle_id"),
        "return_to": return_to,
        "passenger_id": passenger_id,
        "passengers": resolved_passengers,
    }
    resp = await _proxy_to_django(
        "POST", "/api/v1/ticketing/payment-gateway/checkout/", schema, domain, bearer_token, json_body=django_payload,
    )
    return _passthrough(resp)


@router.get(
    "/tickets/namastepay/return/",
    tags=["Public API — NamastePay Payments"],
    responses={
        302: {"description": "Normal case: redirects to the checkout's own `return_to` with `?status=confirmed|failed&booking_id=...` appended, once Django has independently re-verified payment with NamastePay."},
        200: {"content": {"application/json": {"example": {
            "success": True,
            "data": {"id": "9f8e7d6c-5b4a-3210-fedc-ba9876543210", "checkout_id": "npc_8f3a1b2c9d4e5f60", "status": "CONFIRMED"},
            "message": "Success", "errors": None,
        }}}, "description": "Only if the checkout had no `return_to` to redirect to — surfaces the confirmation result directly instead."},
    },
)
async def namastepay_return(checkout_id: str, tenant_schema: str):
    """The fixed redirect target NamastePay sends the passenger's browser back to
    (registered once per tenant in their merchant portal, expected to include
    `?tenant_schema=<this tenant>` baked into the registered URL itself — NamastePay's
    callback carries no tenant-identifying field of its own). Everything else in the
    query string NamastePay appended (`status`, `transaction_id`, etc.) is read by
    nobody here — only `checkout_id`/`tenant_schema` are used, to route the server-side
    confirmation call; the actual status the passenger is redirected onward with comes
    from Django's own re-check with NamastePay, never from these raw query params."""
    domain = await tenant_db.get_domain_for_schema(tenant_schema)
    if not domain:
        return _error(f"No domain configured for tenant '{tenant_schema}'.", 500)

    schema = tenant_schema
    account_id = await tenant_db.get_or_create_self_service_account(schema)
    bearer_token = _mint_self_service_token(account_id, schema)

    resp = await _proxy_to_django(
        "GET",
        f"/api/v1/ticketing/payment-gateway/checkout/{checkout_id}/confirm/",
        schema,
        domain,
        bearer_token,
    )
    try:
        body = resp.json()
    except ValueError:
        body = None

    data = (body or {}).get("data") or {}
    return_to = None
    status_value = "error"
    booking_id = None
    if 200 <= resp.status_code < 300 and data:
        status_value = data.get("status", "error").lower()
        booking = data.get("booking")
        booking_id = booking.get("id") if booking else None
    return_to = data.get("return_to")
    if not return_to:
        # No usable redirect target -- surface the confirmation result directly
        # rather than send the passenger's browser nowhere.
        return _passthrough(resp)

    separator = "&" if "?" in return_to else "?"
    redirect_url = f"{return_to}{separator}status={status_value}"
    if booking_id:
        redirect_url += f"&booking_id={booking_id}"
    return RedirectResponse(url=redirect_url, status_code=302)


@router.get(
    "/tickets/namastepay/checkout/{checkout_id}/confirm/",
    tags=["Public API — NamastePay Payments"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "id": "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
            "checkout_id": "npc_8f3a1b2c9d4e5f60",
            "reference_id": "CB-8F3A1B2C9D4E5F60",
            "status": "CONFIRMED",
            "booking": {"id": "1a2b3c4d-5e6f-7890-abcd-ef1234567890", "tickets": []},
            "confirmed_at": "2026-09-21T08:05:00Z",
        },
        "message": "Success",
        "errors": None,
        "meta": {"timestamp": "2026-09-21T08:05:00.000000+00:00"},
    }}}}},
)
async def confirm_namastepay_checkout(
    checkout_id: str,
    user: dict = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    """Lets a conductor's own device poll the status of a walk-in NamastePay
    checkout they started (CB4/C2 — no `return_to`, since the rider pays by
    scanning the QR with their own wallet app, there's no browser redirect
    to trigger confirmation the way `namastepay_return()` does for the
    self-service/passenger path). Without this, nothing ever calls Django's
    confirm view for a walk-in checkout, so the ticket for a paid walk-in
    fare would never actually be created — this closes that gap, not just a
    missing status popup.

    Same Django view as the passenger path (`NamastePayCheckoutConfirmView`)
    — idempotent, always re-verifies with NamastePay server-side, only
    creates the ticket the first time `status` comes back CONFIRMED — just
    called with the conductor's own real token instead of a throwaway
    self-service one. `status` in the response is one of `PENDING` (keep
    polling), `CONFIRMED` (render green, ticket now exists in `booking`), or
    `FAILED` (render red)."""
    if user.get("role") != CONDUCTOR_ROLE:
        raise HTTPException(status_code=403, detail="Only a conductor token can confirm a checkout.")
    schema = user.get("tenant_schema")
    if not schema:
        raise HTTPException(status_code=400, detail="This conductor account has no tenant assigned.")

    domain = await tenant_db.get_domain_for_schema(schema)
    if not domain:
        return _error(f"No domain configured for tenant '{schema}'.", 500)

    resp = await _proxy_to_django(
        "GET",
        f"/api/v1/ticketing/payment-gateway/checkout/{checkout_id}/confirm/",
        schema,
        domain,
        credentials.credentials,
    )
    return _passthrough(resp)


@router.post(
    "/tickets/reserve/",
    tags=["Public API — Reservations"],
    responses={201: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "reference_id": "CB-D26E1AC50012472E",
            "internal_id": "09b3ebaf-d9db-424d-8173-e798223d0c35",
            "amount": "30.00",
            "qr_code": "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAAAAAB...",
        },
        "message": "Reservation created -- show this to the conductor to validate and pay.",
        "errors": None,
        "meta": {"timestamp": "2026-09-30T08:00:00.000000+00:00"},
    }}}}},
)
async def reserve_ticket(
    payload: ReserveTicketRequest,
    user: dict = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    """Step 1 of the validate-then-pay flow: picks a route/fare/bus and gets back a
    `reference_id` + QR to show the conductor — *before* any money moves. Nothing is
    charged and no Ticket exists yet; a conductor must close it (POST
    /tickets/reservations/{reference_id}/validate/ below) before payment is even
    attempted. Works for a passenger reserving for themselves *or* a conductor
    generating their own walk-in ticket the same way (then closing it themselves,
    same as one they scanned from a passenger) — a conductor's own reservation has
    no passenger_id, and vehicle_id auto-resolves from their active allocation when
    not given explicitly."""
    payload = payload.model_dump(exclude_none=True)
    role = user.get("role")
    if role not in (PASSENGER_ROLE, CONDUCTOR_ROLE):
        raise HTTPException(status_code=403, detail="Only a passenger or conductor token can create a reservation.")

    route_id = payload.get("route_id")
    if not isinstance(route_id, str) or not route_id.strip():
        return _error("route_id is required.", 400)

    passengers = payload.get("passengers")
    if not isinstance(passengers, list) or not passengers:
        return _error("passengers must be a non-empty list.", 400)

    if role == CONDUCTOR_ROLE:
        passenger_id = None
        schema = user.get("tenant_schema")
        if not schema:
            return _error("This conductor account has no tenant assigned.", 400)
        operator_schemas = await tenant_db.get_route_operator_schemas(route_id)
        if schema not in operator_schemas:
            return _error("This route isn't served by your tenant.", 404)
        vehicle_id = payload.get("vehicle_id")
        if not vehicle_id:
            vehicle_id = await tenant_db.fetch_conductor_active_vehicle_id(schema, user.get("user_id"))
    else:
        passenger_id = user.get("user_id")
        if not passenger_id:
            return _error("Invalid token.", 401)
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
        vehicle_id = payload.get("vehicle_id")

    if vehicle_id:
        buses = await tenant_db.list_operating_buses_for_route(route_id, schema)
        if not any(str(b.get("id")) == str(vehicle_id) for b in buses):
            return _error(
                "vehicle_id isn't one of the buses currently serving this route.",
                400,
                # _error builds a raw JSONResponse (no FastAPI/Pydantic encoder in
                # front of it, unlike a plain dict return), so UUID/Decimal values
                # from an asyncpg row have to be stringified by hand here or
                # json.dumps blows up with a 500 instead of the intended 400.
                errors={"buses": [{k: str(v) if v is not None else v for k, v in b.items()} for b in buses]},
            )

    resolved_passengers = []
    for passenger in passengers:
        entry = {
            "fare_paid": passenger.get("fare_paid"),
            "passenger_name": passenger.get("passenger_name", ""),
            "to_stop_id": passenger.get("to_stop_id"),
        }
        ticket_type_code = passenger.get("ticket_type")
        if isinstance(ticket_type_code, str) and ticket_type_code.strip():
            ticket_type_id = await tenant_db.resolve_ticket_type_id(ticket_type_code.strip().upper())
            if ticket_type_id is None:
                return _error(f"Unknown ticket_type: {ticket_type_code!r}.", 400)
            entry["ticket_type_id"] = ticket_type_id
        resolved_passengers.append(entry)

    domain = await tenant_db.get_domain_for_schema(schema)
    if not domain:
        return _error(f"No domain configured for tenant '{schema}'.", 500)

    if role == CONDUCTOR_ROLE:
        bearer_token = credentials.credentials
    else:
        account_id = await tenant_db.get_or_create_self_service_account(schema)
        bearer_token = _mint_self_service_token(account_id, schema)

    django_payload = {
        "route_id": route_id,
        "from_stop_id": payload.get("from_stop_id"),
        "vehicle_id": vehicle_id,
        "passenger_id": passenger_id,
        "passengers": resolved_passengers,
    }
    resp = await _proxy_to_django(
        "POST", "/api/v1/ticketing/reservations/", schema, domain, bearer_token, json_body=django_payload,
    )
    return _passthrough(resp)


@router.get(
    "/tickets/reservations/mine/",
    tags=["Public API — Reservations"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": [{
            "reference_id": "CB-D26E1AC50012472E",
            "checkout_id": None,
            "route_id": "134e0299-e705-4008-910e-edae38c3c312",
            "from_stop_id": "d1c11c52-4923-49d7-8c5b-f8d1dd59d8e2",
            "amount": "30.00",
            "status": "PENDING",
            "passengers": [
                {"fare_paid": "30.00", "to_stop_id": "503626a1-bd20-42a1-be55-4b1518e4eaaa", "passenger_name": "", "ticket_type_id": None},
            ],
        }],
        "message": "Success",
        "errors": None,
    }}}}},
)
async def my_reservations(user: dict = Depends(get_current_user)):
    """The calling passenger's own pending/past reservations, across every operator --
    the reservation equivalent of GET /tickets/my/, since a reservation is a
    NamastePayCheckout row (see reserve_ticket() above), not a Ticket, so it never
    shows up there. Registered above GET /tickets/reservations/{reference_id}/ (not
    below it) so "mine" is matched as this static route, not as a reference_id value
    -- FastAPI/Starlette matches path routes in registration order, not
    static-before-dynamic automatically."""
    passenger_id = user.get("user_id")
    if not passenger_id:
        return _error("Invalid token.", 401)
    reservations = await tenant_db.find_namastepay_checkouts_for_passenger(passenger_id)
    return _ok(data=[_serialize_reservation(r) for r in reservations])


@router.get(
    "/tickets/reservations/{reference_id}/",
    tags=["Public API — Reservations"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "reference_id": "CB-D26E1AC50012472E",
            "checkout_id": None,
            "route_id": "134e0299-e705-4008-910e-edae38c3c312",
            "from_stop_id": "d1c11c52-4923-49d7-8c5b-f8d1dd59d8e2",
            "amount": "30.00",
            "status": "PENDING",
            "passengers": [
                {"fare_paid": "30.00", "to_stop_id": "503626a1-bd20-42a1-be55-4b1518e4eaaa", "passenger_name": "", "ticket_type_id": None},
            ],
        },
        "message": "Success",
        "errors": None,
    }}}}},
)
async def get_reservation(reference_id: str, user: dict = Depends(get_current_user)):
    """Conductor-only: scans/types the passenger's reservation code and sees what
    it's for — route, fare, passenger count, and its current status (PENDING/
    REJECTED/CONFIRMED/FAILED) — before deciding whether to validate it. A
    passenger checking their own reservation's status uses GET
    /tickets/reservations/mine/ above instead, not this one by reference_id. Read
    directly from tenant_db (same cross-schema lookup CB4's pay-by-ID screen
    already uses) rather than round-tripping to Django, since nothing needs to be
    mutated here."""
    if user.get("role") != CONDUCTOR_ROLE:
        raise HTTPException(status_code=403, detail="Only a conductor token can look up a reservation.")

    found = await tenant_db.find_namastepay_checkout_by_reference(reference_id)
    if not found:
        return _error("Reservation not found.", 404)
    schema, reservation = found
    if schema != user.get("tenant_schema"):
        return _error("This reservation was not created for your tenant.", 403)

    return _ok(data=_serialize_reservation(reservation))


@router.post(
    "/tickets/reservations/{reference_id}/validate/",
    tags=["Public API — Reservations"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "checkout_id": "npc_8f3a1b2c9d4e5f60",
            "payment_url": "https://pay.namastepay.com/checkout/npc_8f3a1b2c9d4e5f60",
            "expires_at": "2026-09-30T08:15:00Z",
            "reference_id": "CB-D26E1AC50012472E",
            "internal_id": "09b3ebaf-d9db-424d-8173-e798223d0c35",
        },
        "message": "Reservation accepted -- show this payment QR to the passenger.",
        "errors": None,
        "meta": {"timestamp": "2026-09-30T08:00:00.000000+00:00"},
    }}}}},
)
async def validate_reservation(
    reference_id: str,
    payload: ValidateReservationRequest = Body(default_factory=ValidateReservationRequest),
    user: dict = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    """Step 2 ("close the ticket"): conductor settles, rejects, or starts payment on
    a reservation — their own, just generated, or scanned from a passenger, same
    action either way. `{"decision": "valid"}` — starts the real NamastePay checkout
    for this fare; the response's `payment_url` is what the conductor's app renders
    as the merchant QR for the passenger to pay. `{"decision": "cash"}` — settles it
    immediately, no gateway call, for when the conductor already has the fare in
    hand. `{"decision": "invalid"}` — rejects/deletes it outright, no payment ever
    attempted, can't be re-validated. Proxies to Django with the conductor's own
    real token so the same role-based conductor_id tagging applies. For "valid",
    the conductor's own app is expected to poll
    GET /tickets/namastepay/checkout/{checkout_id}/confirm/ (above) with the
    `checkout_id` this call returns; "cash" settles synchronously, right here."""
    payload = payload.model_dump(exclude_none=True)
    if user.get("role") != CONDUCTOR_ROLE:
        raise HTTPException(status_code=403, detail="Only a conductor token can validate a reservation.")
    schema = user.get("tenant_schema")
    if not schema:
        raise HTTPException(status_code=400, detail="This conductor account has no tenant assigned.")

    found = await tenant_db.find_namastepay_checkout_by_reference(reference_id)
    if not found:
        return _error("Reservation not found.", 404)
    reservation_schema, _ = found
    if reservation_schema != schema:
        return _error("This reservation was not created for your tenant.", 403)

    domain = await tenant_db.get_domain_for_schema(schema)
    if not domain:
        return _error(f"No domain configured for tenant '{schema}'.", 500)

    resp = await _proxy_to_django(
        "POST",
        f"/api/v1/ticketing/reservations/{reference_id}/validate/",
        schema,
        domain,
        credentials.credentials,
        json_body={"decision": payload.get("decision")},
    )
    return _passthrough(resp)


@router.patch(
    "/tickets/reservations/{reference_id}/",
    tags=["Public API — Reservations"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "reference_id": "CB-D26E1AC50012472E",
            "checkout_id": None,
            "route_id": "134e0299-e705-4008-910e-edae38c3c312",
            "from_stop_id": "d1c11c52-4923-49d7-8c5b-f8d1dd59d8e2",
            "amount": "30.00",
            "status": "PENDING",
            "passengers": [
                {"fare_paid": "30.00", "to_stop_id": "503626a1-bd20-42a1-be55-4b1518e4eaaa", "passenger_name": "", "ticket_type_id": None},
            ],
        },
        "message": "Reservation updated.",
        "errors": None,
    }}}}},
)
async def edit_reservation(
    reference_id: str,
    payload: EditReservationRequest,
    user: dict = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    """The "edit" half of the conductor's close action — fix a mistake (wrong stop,
    wrong fare, wrong bus) in a still-unsettled reservation before choosing how to
    close it. Only works while the reservation is PENDING — editing one that's
    already been paid, rejected, or failed would rewrite history a receipt already
    exists for, so Django 400s that case. Any field omitted here is left unchanged;
    passing `passengers` replaces the whole list and recomputes `amount` from it."""
    payload = payload.model_dump(exclude_none=True)
    if user.get("role") != CONDUCTOR_ROLE:
        raise HTTPException(status_code=403, detail="Only a conductor token can edit a reservation.")
    schema = user.get("tenant_schema")
    if not schema:
        raise HTTPException(status_code=400, detail="This conductor account has no tenant assigned.")

    found = await tenant_db.find_namastepay_checkout_by_reference(reference_id)
    if not found:
        return _error("Reservation not found.", 404)
    reservation_schema, reservation = found
    if reservation_schema != schema:
        return _error("This reservation was not created for your tenant.", 403)

    # Same bus-choice validation reserve_ticket() applies at creation --
    # edit exists specifically to let a conductor fix a wrong bus, so it
    # has to hold here too, against whichever route is in effect after
    # this edit (the new one if route_id is also being changed, else the
    # reservation's existing one).
    effective_vehicle_id = payload.get("vehicle_id", reservation.get("vehicle_id"))
    effective_route_id = payload.get("route_id", reservation.get("route_id"))
    if effective_vehicle_id:
        buses = await tenant_db.list_operating_buses_for_route(str(effective_route_id), schema)
        if not any(str(b.get("id")) == str(effective_vehicle_id) for b in buses):
            return _error(
                "vehicle_id isn't one of the buses currently serving this route.",
                400,
                errors={"buses": [{k: str(v) if v is not None else v for k, v in b.items()} for b in buses]},
            )

    resolved_passengers = None
    if payload.get("passengers"):
        resolved_passengers = []
        for passenger in payload["passengers"]:
            entry = {
                "fare_paid": passenger.get("fare_paid"),
                "passenger_name": passenger.get("passenger_name", ""),
                "to_stop_id": passenger.get("to_stop_id"),
            }
            ticket_type_code = passenger.get("ticket_type")
            if isinstance(ticket_type_code, str) and ticket_type_code.strip():
                ticket_type_id = await tenant_db.resolve_ticket_type_id(ticket_type_code.strip().upper())
                if ticket_type_id is None:
                    return _error(f"Unknown ticket_type: {ticket_type_code!r}.", 400)
                entry["ticket_type_id"] = ticket_type_id
            resolved_passengers.append(entry)

    domain = await tenant_db.get_domain_for_schema(schema)
    if not domain:
        return _error(f"No domain configured for tenant '{schema}'.", 500)

    django_payload = {k: v for k, v in payload.items() if k != "passengers"}
    if resolved_passengers is not None:
        django_payload["passengers"] = resolved_passengers

    resp = await _proxy_to_django(
        "PATCH",
        f"/api/v1/ticketing/reservations/{reference_id}/",
        schema,
        domain,
        credentials.credentials,
        json_body=django_payload,
    )
    return _passthrough(resp)


@router.get(
    "/tickets/my/",
    tags=["Public API — Tickets"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": [{
            "id": "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
            "ticket_uid": "TKT-A1B2C3D4E5F6",
            "qr_code": "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAAAAAB...",
            "operator_schema": "mayurbus",
            "ticket_type_id": "14e05061-78fe-4ed8-af60-bb02e78d139f",
            "trip_id": None,
            "booking_id": None,
            "vehicle_id": "8924bdb4-6953-4e8a-bdce-b7c7e8c7e8dc",
            "bus_number": "Bus 26",
            "route_id": "826b8836-8621-44a0-82f2-96aaee86f728",
            "route_code": "6767",
            "route_name": "Balkhu — Kamal Pokhari",
            "passenger_id": "11111111-2222-3333-4444-555555555555",
            "passenger_name": "Hari Prasad",
            "passenger_phone": None,
            "document_id": None,
            "conductor_id": None,
            "issued_at": "2026-09-21T08:00:00Z",
            "issued_by": "MOBILE",
            "valid_until": "2026-09-21T23:59:59Z",
            "fare_paid": "25.00",
            "payment_method": "ESEWA",
            "payment_reference": "yatroo-txn-8f3a1b2c",
            "status": "VALID",
            "from_stop_id": "484d042d-f919-4a7d-8595-2371f3557ef5",
            "to_stop_id": "87caeef9-fbb9-48d9-a66e-5674ccbf16bf",
            "from_stop_name": "Balkhu",
            "to_stop_name": "Kamal Pokhari",
        }],
        "message": "Success",
        "errors": None,
    }}}}},
)
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
    await tenant_db.enrich_booking_and_vehicle(tickets)
    await tenant_db.enrich_route_names(tickets)
    return _ok(data=[_serialize_ticket(t) for t in tickets])


@router.get(
    "/tickets/issued/",
    tags=["Public API — Tickets"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": [{
            "id": "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
            "ticket_uid": "TKT-A1B2C3D4E5F6",
            "route_id": "826b8836-8621-44a0-82f2-96aaee86f728",
            "route_code": "6767",
            "route_name": "Balkhu — Kamal Pokhari",
            "vehicle_id": "8924bdb4-6953-4e8a-bdce-b7c7e8c7e8dc",
            "bus_number": "Bus 26",
            "passenger_name": "Hari Prasad",
            "issued_at": "2026-09-21T08:00:00Z",
            "fare_paid": "25.00",
            "payment_method": "CASH",
            "status": "VALID",
            "from_stop_name": "Balkhu",
            "to_stop_name": "Kamal Pokhari",
        }],
        "message": "Success",
        "errors": None,
    }}}}},
)
async def my_issued_tickets(
    user: dict = Depends(get_current_user),
    since: Optional[str] = Query(
        None, description="ISO 8601 timestamp — only tickets issued strictly after this"
    ),
):
    """The calling conductor's own issuance history -- every ticket they've personally
    issued (`Ticket.conductor_id` = their own user_id), most recent first, within their
    own tenant only (a conductor never issues outside their own tenant, so this is a
    single-schema lookup -- see GET /tickets/my/ above for the cross-tenant passenger
    equivalent, which this intentionally does NOT reuse: a conductor's own issued-tickets
    list and a passenger's owned-tickets list are different questions that happen to
    share a table). `403` if the caller isn't a conductor."""
    if user.get("role") != CONDUCTOR_ROLE:
        raise HTTPException(status_code=403, detail="Only a conductor can list their own issued tickets.")
    schema = user.get("tenant_schema")
    conductor_id = user.get("user_id")
    if not schema or not conductor_id:
        raise HTTPException(status_code=400, detail="This conductor account has no tenant assigned.")

    since_dt = None
    if since is not None:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            return _error("`since` must be a valid ISO 8601 timestamp.", 400)

    tickets = await tenant_db.find_tickets_for_conductor(schema, conductor_id, since=since_dt)
    await tenant_db.enrich_stop_names(tickets)
    await tenant_db.enrich_payment_references(tickets)
    await tenant_db.enrich_passenger_details(tickets)
    await tenant_db.enrich_booking_and_vehicle(tickets)
    await tenant_db.enrich_route_names(tickets)
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


@router.get(
    "/tickets/uid/{ticket_uid}/eticket/",
    tags=["Public API — Tickets"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "id": "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
            "ticket_uid": "TKT-A1B2C3D4E5F6",
            "qr_code": "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAAAAAB...",
            "operator_schema": "mayurbus",
            "ticket_type_id": "14e05061-78fe-4ed8-af60-bb02e78d139f",
            "trip_id": None,
            "booking_id": None,
            "vehicle_id": "8924bdb4-6953-4e8a-bdce-b7c7e8c7e8dc",
            "bus_number": "Bus 26",
            "route_id": "826b8836-8621-44a0-82f2-96aaee86f728",
            "route_code": "6767",
            "route_name": "Balkhu — Kamal Pokhari",
            "passenger_id": "11111111-2222-3333-4444-555555555555",
            "passenger_name": "Hari Prasad",
            "passenger_phone": None,
            "document_id": None,
            "conductor_id": None,
            "issued_at": "2026-09-21T08:00:00Z",
            "issued_by": "MOBILE",
            "valid_until": "2026-09-21T23:59:59Z",
            "fare_paid": "25.00",
            "payment_method": "ESEWA",
            "payment_reference": "yatroo-txn-8f3a1b2c",
            "status": "VALID",
            "from_stop_id": "484d042d-f919-4a7d-8595-2371f3557ef5",
            "to_stop_id": "87caeef9-fbb9-48d9-a66e-5674ccbf16bf",
            "from_stop_name": "Balkhu",
            "to_stop_name": "Kamal Pokhari",
            "operator": {
                "schema": "mayurbus",
                "domain": "mayurbus.citybus.com.np",
                "company_name": "Mayur Bus Pvt. Ltd.",
                "logo_url": "https://mayurbus.citybus.com.np/media/company_logos/mayur.png",
            },
            "crew": {
                "vehicle_no": "BA-1-KHA-2345",
                "driver_name": "Ram Bahadur",
                "conductor_name": "Shyam Kumar",
                "owner_name": "Ganesh Thapa",
            },
        },
        "message": "Success",
        "errors": None,
    }}}}},
)
async def get_eticket_by_uid(ticket_uid: str, user: dict = Depends(get_current_user)):
    """E-ticket for a ticket looked up by its human-readable **ticket_uid** (e.g.
    `KV-XXXXXXXX`) instead of the internal UUID. Useful when the mobile app only
    has the printed UID. Returns ticket data + operator company name and logo URL.
    `403` if the caller is neither the ticket's passenger nor staff of the issuing
    operator; `404` if not found."""
    return await _eticket_response(ticket_uid, user, by_uid=True)


@router.get(
    "/tickets/{ticket_id}/",
    tags=["Public API — Tickets"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "id": "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
            "ticket_uid": "TKT-A1B2C3D4E5F6",
            "qr_code": "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAAAAAB...",
            "operator_schema": "mayurbus",
            "ticket_type_id": "14e05061-78fe-4ed8-af60-bb02e78d139f",
            "trip_id": None,
            "booking_id": None,
            "vehicle_id": "8924bdb4-6953-4e8a-bdce-b7c7e8c7e8dc",
            "bus_number": "Bus 26",
            "route_id": "826b8836-8621-44a0-82f2-96aaee86f728",
            "route_code": "6767",
            "route_name": "Balkhu — Kamal Pokhari",
            "passenger_id": "11111111-2222-3333-4444-555555555555",
            "passenger_name": "Hari Prasad",
            "passenger_phone": None,
            "document_id": None,
            "conductor_id": None,
            "issued_at": "2026-09-21T08:00:00Z",
            "issued_by": "MOBILE",
            "valid_until": "2026-09-21T23:59:59Z",
            "fare_paid": "25.00",
            "payment_method": "ESEWA",
            "payment_reference": "yatroo-txn-8f3a1b2c",
            "status": "VALID",
            "from_stop_id": "484d042d-f919-4a7d-8595-2371f3557ef5",
            "to_stop_id": "87caeef9-fbb9-48d9-a66e-5674ccbf16bf",
            "from_stop_name": "Balkhu",
            "to_stop_name": "Kamal Pokhari",
        },
        "message": "Success",
        "errors": None,
    }}}}},
)
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


@router.post(
    "/tickets/{ticket_id}/cancel/",
    tags=["Public API — Tickets"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "id": "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
            "ticket_uid": "TKT-A1B2C3D4E5F6",
            "ticket_type_id": "14e05061-78fe-4ed8-af60-bb02e78d139f",
            "trip_id": None,
            "vehicle_id": None,
            "passenger_id": "11111111-2222-3333-4444-555555555555",
            "passenger_name": "Hari Prasad",
            "conductor_id": None,
            "issued_at": "2026-09-21T08:00:00Z",
            "paid_at": "2026-09-21T08:00:00Z",
            "issued_by": "MOBILE",
            "valid_until": "2026-09-21T23:59:59Z",
            "fare_paid": "25.00",
            "payment_method": "ESEWA",
            "qr_code": "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAAAAAB...",
            "status": "CANCELLED",
            "from_stop_id": "484d042d-f919-4a7d-8595-2371f3557ef5",
            "to_stop_id": "87caeef9-fbb9-48d9-a66e-5674ccbf16bf",
            "from_stop_name": None,
            "to_stop_name": None,
            "vehicle_bus_number": None,
        },
        "message": "Ticket cancelled successfully.",
        "errors": None,
        "meta": {"timestamp": "2026-09-21T08:00:00.000000+00:00"},
    }}}}},
)
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


@router.get(
    "/tickets/{ticket_id}/eticket/",
    tags=["Public API — Tickets"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "id": "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
            "ticket_uid": "TKT-A1B2C3D4E5F6",
            "qr_code": "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAAAAAB...",
            "operator_schema": "mayurbus",
            "ticket_type_id": "14e05061-78fe-4ed8-af60-bb02e78d139f",
            "trip_id": None,
            "booking_id": None,
            "vehicle_id": "8924bdb4-6953-4e8a-bdce-b7c7e8c7e8dc",
            "bus_number": "Bus 26",
            "route_id": "826b8836-8621-44a0-82f2-96aaee86f728",
            "route_code": "6767",
            "route_name": "Balkhu — Kamal Pokhari",
            "passenger_id": "11111111-2222-3333-4444-555555555555",
            "passenger_name": "Hari Prasad",
            "passenger_phone": None,
            "document_id": None,
            "conductor_id": None,
            "issued_at": "2026-09-21T08:00:00Z",
            "issued_by": "MOBILE",
            "valid_until": "2026-09-21T23:59:59Z",
            "fare_paid": "25.00",
            "payment_method": "ESEWA",
            "payment_reference": "yatroo-txn-8f3a1b2c",
            "status": "VALID",
            "from_stop_id": "484d042d-f919-4a7d-8595-2371f3557ef5",
            "to_stop_id": "87caeef9-fbb9-48d9-a66e-5674ccbf16bf",
            "from_stop_name": "Balkhu",
            "to_stop_name": "Kamal Pokhari",
            "operator": {
                "schema": "mayurbus",
                "domain": "mayurbus.citybus.com.np",
                "company_name": "Mayur Bus Pvt. Ltd.",
                "logo_url": "https://mayurbus.citybus.com.np/media/company_logos/mayur.png",
            },
            "crew": {
                "vehicle_no": "BA-1-KHA-2345",
                "driver_name": "Ram Bahadur",
                "conductor_name": "Shyam Kumar",
                "owner_name": "Ganesh Thapa",
            },
        },
        "message": "Success",
        "errors": None,
    }}}}},
)
async def get_eticket(ticket_id: str, user: dict = Depends(get_current_user)):
    """E-ticket view for a ticket by its internal **UUID**. Returns all ticket fields
    from `GET /tickets/{ticket_id}/` plus an `operator` object containing the issuing
    bus company's `company_name` and `logo_url` — the minimum a mobile app needs to
    render a branded e-ticket without a second request. Same access rules as the plain
    ticket lookup: restricted to the ticket's own passenger or staff of the issuing
    operator; `403`/`404` otherwise."""
    return await _eticket_response(ticket_id, user)


@router.post(
    "/tickets/{ticket_uid}/validate/",
    tags=["Public API — Tickets"],
    responses={200: {"content": {"application/json": {"example": {
        "success": True,
        "data": {
            "id": "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
            "ticket_uid": "TKT-A1B2C3D4E5F6",
            "ticket_type_id": "14e05061-78fe-4ed8-af60-bb02e78d139f",
            "trip_id": None,
            "vehicle_id": "8924bdb4-6953-4e8a-bdce-b7c7e8c7e8dc",
            "passenger_id": "11111111-2222-3333-4444-555555555555",
            "passenger_name": "Hari Prasad",
            "conductor_id": "22222222-3333-4444-5555-666666666666",
            "issued_at": "2026-09-21T08:00:00Z",
            "paid_at": "2026-09-21T08:00:00Z",
            "issued_by": "MOBILE",
            "valid_until": "2026-09-21T23:59:59Z",
            "fare_paid": "25.00",
            "payment_method": "ESEWA",
            "qr_code": "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAAAAAB...",
            "status": "USED",
            "from_stop_id": "484d042d-f919-4a7d-8595-2371f3557ef5",
            "to_stop_id": "87caeef9-fbb9-48d9-a66e-5674ccbf16bf",
            "from_stop_name": None,
            "to_stop_name": None,
            "vehicle_bus_number": "Bus 26",
        },
        "message": "Ticket valid and marked as used.",
        "errors": None,
        "meta": {"timestamp": "2026-09-21T08:00:00.000000+00:00"},
    }}}}},
)
async def validate_ticket(
    ticket_uid: str,
    payload: ValidateTicketRequest = Body(default_factory=ValidateTicketRequest),
    user: dict = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    """Conductor QR scan or manual entry — marks a ticket as boarded. Conductor-only.

    `ticket_uid` is the human-readable code printed on/encoded in the ticket's
    QR (e.g. "TKT-A1B2C3D4E5F6") — the same value a collector would either
    scan or type in by hand. Not the ticket's internal database id.

    Optional `boarding_stop_id` in the body: if given, must match the ticket's own
    boarding stop — `403` on a mismatch, and the ticket is left untouched (not marked
    used). Omit it to keep the previous exists/unused/unexpired-only check."""
    payload = payload.model_dump(exclude_none=True)
    if user.get("role") != CONDUCTOR_ROLE:
        raise HTTPException(status_code=403, detail="Only a conductor token can validate tickets.")

    found = await tenant_db.find_ticket_by_uid(ticket_uid)
    if not found:
        return _error("Ticket not found.", 404)
    schema, ticket = found

    # find_ticket_by_uid() searches every tenant schema, so `schema` here is
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

    if ticket.get("vehicle_id"):
        # Only enforced when both sides are actually known: a self-service ticket has no
        # vehicle_id yet (nothing to mismatch against), and a conductor with no active
        # dispatch allocation today has no vehicle to compare either -- never block
        # validation on missing dispatch data, same principle as every other rule this
        # session that reads from DailyAllocation.
        conductor_vehicle_id = await tenant_db.fetch_conductor_active_vehicle_id(
            schema, user.get("user_id")
        )
        if conductor_vehicle_id and str(ticket["vehicle_id"]) != conductor_vehicle_id:
            return _error(
                "This ticket was issued for a different bus.",
                403,
                errors={"expected_vehicle_id": conductor_vehicle_id},
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
