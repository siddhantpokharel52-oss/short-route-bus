# KVBMS — API Reference

**Project:** KVBMS (Kathmandu Valley Bus Management System)
**Last updated:** 2026-08-02

There are three separate API surfaces in this repo. This document covers all
of them, **master API first** since it's the one external (mobile app)
clients integrate against — everything else is internal, staff-facing.

| # | API | Base path | Consumers | Auth |
|---|---|---|---|---|
| 1 | **Master Consumer API** (Yatroo) | `/public-api/v1/` | Passenger + conductor mobile app | JWT bearer (shared with Django) |
| 2 | Django REST API | `/api/v1/...` | Super Admin portal, Tenant portal | JWT bearer (`rest_framework_simplejwt`) |
| 3 | FastAPI GPS & Live Ops | `/api/v1/live/...` | Internal dispatcher dashboards, GPS hardware/simulators | JWT bearer (same tokens as #2) |

All three share one JWT: Django issues it (`SIMPLE_JWT`, `HS256`, signed with
`JWT_SECRET_KEY`), and both FastAPI services decode it with the same secret —
there's one login, one token, valid everywhere.

---

## 1. Master Consumer API — `/public-api/v1/`

**Code:** `backend/fastapi_services/public_api/router.py` (endpoints, response
shaping, authorization) + `tenant_db.py` (all direct DB reads).
**Consumers:** the Yatroo mobile app — passengers browsing routes/fares and
buying tickets, conductors issuing and validating them.

### 1.1 What this API is

A **thin aggregation layer**, not a new source of truth:

- **Reference-data reads** (routes, stops, fares, timetable) query the same
  Postgres tables `apps.platform` / `apps.scheduling` already own, directly
  via async SQLAlchemy — no Django round-trip, no business logic to
  duplicate (this data has none).
- **Ticket creation and validation** have real business logic (ticket UID
  generation, QR codes, status transitions, conductor tagging) that already
  lives in `apps.ticketing.views`. Rather than reimplement it, these two
  endpoints **proxy the actual HTTP request into Django** — forwarding the
  caller's own bearer token so Django's own auth and permission classes run
  exactly as they would for a direct call — and pass the response straight
  back. Nothing about ticket validation is duplicated here.
- **`GET /tickets/{id}/` and `GET /tickets/my/`** are genuinely new logic:
  `Ticket.passenger_id` is a shared user id, but tickets themselves are
  stored per-tenant (django-tenants schema isolation), and no Django view
  today searches across every tenant for "does this passenger/ticket exist
  anywhere". `tenant_db.py` does that by iterating tenant schemas.
- **`GET /trips/{trip_id}/qr/`** and **`WS /ws/tickets/`** are the two
  genuinely new endpoints on this API (everything else above extends an
  existing one). The former mints a short-lived token identifying a trip,
  for "passenger self-books by scanning the conductor's QR"; the latter
  pushes a ticket to its passenger the moment it's issued — see §1.4 for
  both.

**Explicitly out of scope** (do not add without a separate decision): GPS/live
vehicle positions, ETA/headway/playback/route-polyline, payment gateway
calls, SMS/push notifications. None of the code here touches
`apps.scheduling`'s `ETAView`/`HeadwayView`/`PlaybackView`/
`LivePositionsView`/`RoutePolylineView`, or anything under
`fastapi_services/gps/`.

### 1.2 Response envelope

Every endpoint returns the same shape, matching `apps/ticketing/views.py`'s
`api_response()`:

```json
{
  "success": true,
  "data": { "...": "..." },
  "message": "Human-readable summary",
  "errors": null
}
```

On failure, `success` is `false`, `data` is `null`, and `errors` may hold
details. HTTP status codes are used normally (`200`, `201`, `400`, `401`,
`403`, `404`, `409`, `500`) — the envelope is not a substitute for them.

### 1.3 Auth

- `get_current_user` (required) / `bearer_scheme` — decodes the same JWT
  Django issues. Payload already carries `user_id`, `role`, `tenant_schema`
  as claims (no extra DB lookup needed to check role/tenant).
- Reference-data reads (routes/stops/fares/timetable) require **no auth** —
  public information.
- Ticket endpoints require a valid bearer token; `POST /tickets/{id}/validate/`
  and `GET /trips/{trip_id}/qr/` additionally require `role == CONDUCTOR`.
  `POST /tickets/` requires `role == CONDUCTOR` **or** `role == PASSENGER`
  with a valid `trip_qr_token` in the body — see §1.4.

### 1.4 Endpoints

#### `GET /routes/`
List routes. `apps.platform.Route`.

| Query param | Type | Notes |
|---|---|---|
| `status` | string | e.g. `APPROVED` |
| `route_type` | string | `EXCLUSIVE` or `SHARED` |
| `lat`, `lon` | float | Search-point coordinates for a **nearby-route search**. Both required together or neither — `400` if only one is given. |
| `radius_km` | float | Default `5.0`. Only used with `lat`/`lon`. |
| `from_stop`, `to_stop` | string | Origin/destination **stop_code** (not UUID) for a **stop-pair route search**. Both required together or neither — `400` if only one is given. Takes priority over `lat`/`lon` if both are somehow supplied. |

Three mutually exclusive modes, checked in this order:

1. **`from_stop` + `to_stop`**: city-bus journey step 1, "passenger picks From
   stop / To stop directly" without knowing which route serves them —
   previously the only way to approximate this was pulling a `route_id` out
   of a `GET /fares/?from_stop&to_stop` response, which wasn't designed for
   route discovery. Returns every route whose stop list passes through
   `from_stop` **before** `to_stop` (`RouteStop.sequence_no` comparison — a
   route serving only the reverse leg does not match), ordered
   nearest-pair-first. Each result carries `from_sequence_no`/
   `to_sequence_no` for the matched pair. `status`/`route_type` are not
   currently supported alongside this mode.
2. **`lat` + `lon`**: nearby-route search. Finds every `Stop` within
   `radius_km` (great-circle distance via a pure Python `_haversine_km`,
   computed against `Stop`'s stored static latitude/longitude — **not** GPS
   or live position data), resolves to parent routes via `RouteStop`,
   dedupes per route, and orders closest-matching-stop-first. Each route
   carries `nearest_stop_distance_km` — distinct from the route's own
   pre-existing `distance_km` field (its total length), so the two can
   never be confused. `status`/`route_type` still apply.
3. **Neither**: plain filtered list, `status`/`route_type` as normal.

#### `GET /routes/{route_id}/`
Single route detail, **with its ordered stop list embedded** as `stops` (same
shape and data as `GET /routes/{route_id}/stops/` below — that endpoint
remains available separately for callers who only want the stop list without
the rest of the route object; this is additive, not a replacement). `404` if
not found or deleted.

#### `GET /routes/{route_id}/stops/`
Ordered stops for a route (`RouteStop.sequence_no` ascending). `404` if the
route doesn't exist.

#### `GET /fares/`
`apps.platform.FareMatrix` for one specific route + boarding/dropping stop pair.
**All three params are required** — `400` if any is missing. This answers
"what does this exact trip cost," not "list every fare on this route"; there's
no broader fare-browsing use case for a passenger-facing API.

| Query param | Notes |
|---|---|
| `route_id` | Required. |
| `from_stop`, `to_stop` | Required. Stop **codes** (not IDs) — resolved to `Stop.zone`, matched against `FareMatrix.zone_from`/`zone_to`, same logic `apps.platform.PublicFareInquiryView` already uses. |

**Fare precision = zone precision.** Two different stops sharing a zone return
the same fare — this is the correct model for a genuine stage-fare system (a
small number of price bands), not a bug. It's already extensible to per-stop
precision with **zero code changes**: give a stop its own unique `zone` value
via the existing `FareMatrixViewSet`/`Stop` admin endpoints. No new table or
endpoint needed for that.

#### `GET /routes/{route_id}/timetable/`
Scheduled (**not live**) departure/arrival slots. `apps.scheduling.Timetable`
+ `TimetableSlot`, resolved to whichever tenant(s) hold an `ACTIVE`
`RouteAssignment` for this route — a shared/exclusive route may be served by
one or several operators, and this returns all of them.

| Query param | Notes |
|---|---|
| `date` | ISO date, defaults to today |
| `day_type` | Explicit override: `WEEKDAY`, `SATURDAY`, `SUNDAY`, `HOLIDAY`. Otherwise derived from `date` (Saturday/Sunday detected, everything else `WEEKDAY` — no holiday calendar). |

Response: `{"day_type": "...", "slots": [...]}`. Each slot carries
`tenant_schema` — deliberately kept, since it's the operator running that
trip, genuine display data for a multi-operator route.

#### `GET /trips/{trip_id}/qr/`
Conductor-only. Mints `trip_qr_token` — a short-lived (4h) JWT encoding
`trip_id`/`tenant_schema`/`conductor_id`, signed with the same
`JWT_SECRET_KEY` Django and the rest of this API already share (not a new
auth mechanism — one more narrowly-scoped, short-lived claim set using the
existing key). This is what the conductor's app renders as a QR code for
that trip; it is deliberately not single-use, since many different
passengers scanning the same trip's code to book separate tickets is the
point. `404` if the trip doesn't exist, is soft-deleted, or isn't assigned
to the calling conductor — the same response in all three cases, so a
wrong/guessed `trip_id` can't be used to probe another conductor's trips.

Response: `{"trip_qr_token": "...", "expires_in": 14400, "trip_id": "...",
"trip_code": "..."}`.

#### `POST /tickets/`
Conductor-issued ticket, a passenger self-booking by scanning a conductor's
trip QR, or a passenger self-service purchase with no conductor involved at
all — three different callers, one endpoint.

**Field aliases:** `boardingStopId`/`droppingStopId`/`passengerPhone`/
`documentId` (the brief's camelCase names) are accepted as aliases for
`from_stop_id`/`to_stop_id`/`passenger_phone`/`document_id` — normalized at
the top of this endpoint before anything else runs, so every code path below
only ever deals with the snake_case names. If a caller sends both forms for
the same field, snake_case wins.

**Passenger phone / document ID:** stored the same way `payment_reference`
is — a small side-table this API owns (`public.public_api_ticket_passenger_details`),
since `apps.ticketing.Ticket` has no such columns and that app stays off-limits
to migrate. Returned on every ticket read (`GET /tickets/{id}/`, `GET /tickets/my/`),
`null` for either field if never supplied at issuance.

**Conductor path (`role == CONDUCTOR`):** proxies to
`apps.ticketing.TicketViewSet.create` — the whole request body (minus
`idempotency_key`/`payment_reference`, see below) is forwarded as-is;
Django's own `TicketSerializer` validates it, generates `ticket_uid` + QR
code, and tags `conductor_id`/`issued_by` from the authenticated user. This
endpoint adds no validation of its own.

**Scan-to-book path (`role == PASSENGER` + `trip_qr_token` in the body):**
the token (from `GET /trips/{trip_id}/qr/`) is decoded to recover which
trip/tenant/conductor it represents — `403` if it's missing, malformed,
expired, or wasn't minted for this purpose. `trip_id` (from the token) and
`passenger_id` (the caller's own `user_id`) are set on the forwarded
payload, overriding anything the client sent for those two fields. The
proxied call to Django is authenticated with a **freshly minted, ~60-second
service token** attributing the request to the trip's real conductor — never
the passenger's own JWT, which carries no `tenant_schema` and would be
rejected outright by `TenantSchemaMiddleware` (`backend/config/tenant_middleware.py`).
The resulting ticket is therefore indistinguishable from one that conductor
entered directly (`issued_by=CONDUCTOR`, real `conductor_id`) — structurally
it is the same operation, just triggered by a scan. **Cash-on-board:** the
ticket is created immediately, exactly like the conductor-direct path —
there is no payment-gateway wait here, same as today.

**Self-service path (`role == PASSENGER` + `route_id` in the body, no
`trip_qr_token`)** — city-bus journey step 4, "Ticket (optional,
self-service)... paid via gateway." No conductor or QR involved at all; the
passenger picks a route themselves, ahead of boarding.
- `payment_reference` is **required** here (unlike the optional one below) —
  there is no conductor present to collect cash for this flow, so an
  unverified ticket would be a real revenue gap. `400` if missing/blank.
- `trip_id` is never set — city-bus tickets aren't tied to a specific trip.
- Which operator the ticket gets issued under is resolved via
  `apps.platform.RouteAssignment` (a route can be served by more than one
  operator): the sole operator is auto-picked if there's only one;
  otherwise `400` asking for an explicit `tenant_schema` in the body (valid
  choices listed in `errors.operators`). `404` if `route_id` doesn't exist
  or has no operator at all.
- Routed to Django via a **lazily-created, per-tenant, non-human
  "self-service account"** (`tenant_db.get_or_create_self_service_account`
  — a real row in the same `users_user` table conductor/staff accounts live
  in, `role=PASSENGER`, created on first use for that tenant, never used to
  log in) rather than borrowing a real conductor's identity — there's no
  conductor to borrow from for this flow. `issued_by` is forced to
  `MOBILE`; `conductor_id` stays null (correct: no conductor has touched
  this ticket yet, one will when it's later scanned via
  `POST /tickets/{id}/validate/`).
- Both minted service tokens above (scan-to-book's and this one) carry
  `token_type: "access"` and a `jti` claim — `rest_framework_simplejwt`'s
  `AccessToken` hard-requires both on top of the signature/expiry check;
  omitting either raises `TokenError` ("Token has no type" / "Token has no
  id") server-side. Caught via a real call through the actual Django
  container, not a mock — this is exactly the kind of bug a mocked
  `_proxy_to_django` can never surface, since the mock never decodes
  anything.

**Idempotency** — optional `idempotency_key` field in the body:
- Keyed on `(tenant_schema, idempotency_key)`, not the key alone, so two
  different operators reusing the same key value never collide.
- Implemented as an atomic Redis reservation (`SET key IN_PROGRESS NX`,
  30s TTL) taken *before* any proxy call — not a naive
  check-then-store, which would race under near-simultaneous retries (the
  realistic trigger: payment-callback retries arriving close together). A
  concurrent second request with the same key never proxies a second ticket;
  it polls briefly (≤3s) for the first request's real result and returns
  that, or `409` ("already being processed, please retry") if the first
  request hasn't finished yet.
- Once a **successful (2xx)** response is stored, it's kept for 24h
  (`ex=86400`) — a retried request in that window gets the original response
  back unchanged, no second Django call. A **failed** attempt (e.g. a
  rejected token, a transient DB error) is deliberately **not** cached this
  way — the reservation is released instead, so a retry with the same key
  actually retries. (Caught via a real end-to-end smoke test: an earlier
  version cached whatever came back regardless of status, and a single
  transient 401 got replayed for every retry with that key for the full 24h.)
- **Soft gap, by design:** no `idempotency_key` → today's exact behavior, no
  dedupe protection. Callers that need exactly-once semantics must supply
  one.
- **Redis outage:** every Redis call here is wrapped in try/except. On
  failure, this degrades to issuing the ticket normally with no dedupe
  protection (logged as a warning) — a Redis outage never blocks the
  conductor-facing, revenue-critical ticket-issuance path.

**External payment reference** — optional `payment_reference` field in the
body (a gateway/transaction reference string, distinct from `payment_method`,
which is just an enum label like `CASH`/`ESEWA`/`KHALTI`). `apps.ticketing.Ticket`
has no column for this and is off-limits to migrate, so it is **not** part of
the proxied Django payload — after a successful ticket creation, it's stored
separately by this API itself, keyed by the created ticket's `ticket_uid`
(see `tenant_db.store_payment_reference`). Omit it and nothing changes from
today's behavior; `payment_reference` comes back as `null` on that ticket
from every read endpoint below.

#### `GET /tickets/my/`
The calling passenger's own tickets, searched across **every** tenant schema
(a passenger's ride history spans whichever operators they've actually
ridden with). Requires only a valid token — `user_id` from the JWT is the
`passenger_id` filter. Each ticket includes `payment_reference` (see above),
`null` if none was stored at issuance.

**"Conductor issues ticket → shows in Yatroo app"** — a ticket is available
via this endpoint the instant it's issued (no delay to wait out). Two
delivery mechanisms exist side by side:

- `since` query param (ISO 8601 timestamp) narrows the result to tickets
  issued strictly after it — **short-interval client-side polling**, still
  the reliable catch-up mechanism (see the WebSocket note below for why it
  stays relevant even now that push exists). Pass the `issued_at` of the
  newest ticket already seen (or the time polling started). `400` if `since`
  isn't a valid ISO 8601 timestamp.
- **`WS /public-api/v1/ws/tickets/?token=<jwt>`** — genuine push. Connect
  with a **passenger**-role token as a `token` query param (WebSocket
  handshakes can't carry an `Authorization` header the way normal requests
  do — this is the standard workaround, decoded by hand with the same
  `JWT_SECRET_KEY`, not a new auth mechanism). The server holds the
  connection open and pushes `{"event": "ticket_issued", "data": {...ticket
  fields...}}` the moment a ticket with this passenger's `passenger_id` is
  issued — from either issuance path, conductor-direct or passenger-QR-scan.
  Closes with code `1008` on a missing/invalid/wrong-role token.
  **Caveat:** connections are held in the FastAPI process's own memory
  (same pattern as the existing GPS WebSocket endpoints) — correct for this
  deployment's single-worker setup, but would need a Redis pub/sub fan-out
  to stay correct behind multiple replicas. Because of that, and because a
  client can always miss a message while disconnected/reconnecting, `since`
  polling remains the endpoint of record — a client should poll at least
  once after (re)connecting the WebSocket, not treat push as the only source
  of truth.

#### `GET /tickets/{ticket_id}/`
Single ticket lookup, searched across every tenant schema by UUID (stops at
first match). Authorized for the ticket's **owning passenger** or **staff of
the issuing tenant** (`user.tenant_schema == ` the ticket's schema) — `403`
otherwise. This is a stricter check than Django's own `TicketViewSet`
(`IsAuthenticated` only, no owner restriction), not a relaxation of it.
Includes `payment_reference` (see above), `null` if none was stored.

#### `POST /tickets/{ticket_id}/validate/`
Conductor QR scan. **Requires `role == CONDUCTOR`.** Wraps
`apps.ticketing.VerifyTicketView` (a Django `GET` that mutates ticket status)
behind a `POST`, since a state-mutating call shouldn't be a `GET`. Explicitly
checks `schema == user.tenant_schema` **before** proxying — the ticket
lookup searches every schema, so without this check a conductor could target
another tenant's ticket ID. (Django's own `TenantSchemaMiddleware` would
independently reject the mismatched `X-Tenant-Slug` too, but this endpoint
doesn't rely on that unrelated file to stay safe.)

**Optional `boarding_stop_id`** in the body: if supplied, checked against
this ticket's own `from_stop_id` **before** anything is proxied to Django —
`403` (with `errors.expected_boarding_stop_id`) on a mismatch, and the
mismatch never reaches Django, so a rejected boarding never marks the ticket
`USED`. Without this, `VerifyTicketView` only ever checked *exists / not
used / not expired* — a ticket bought for one stop pair could be validated
on any other route with zero rejection. Deliberately **optional, not
mandatory**: it only has real integrity once a conductor's app is actually
updated to send its current stop, which is a client rollout this API can't
force — a conductor whose app hasn't been updated yet keeps the exact
previous exists/unused/unexpired behavior, unchanged.

### 1.5 Ticket response shape

`_serialize_ticket()` — an explicit field allowlist, not a passthrough of
whatever `tenant_db` returns:

```
id, ticket_uid, qr_code, operator_schema, ticket_type_id, trip_id,
passenger_id, passenger_name, passenger_phone, document_id, conductor_id,
issued_at, issued_by, valid_until, fare_paid, payment_method,
payment_reference, status, from_stop_id, to_stop_id, from_stop_name,
to_stop_name
```

`qr_code` (base64 PNG, generated by Django's `TicketSerializer.create()` at
issuance) is included on every read here, not just the direct
`POST /tickets/` response — a passenger's app polling `GET /tickets/my/` or
`GET /tickets/{id}/` later gets the same QR image, not just the ticket
metadata.

Route/stop/fare/timetable responses go through their own equivalent
allowlists (`_serialize_route`, `_serialize_route_stop`, `_serialize_fare`,
`_serialize_timetable_slot`) in `router.py` — deliberately re-declared there
even though `tenant_db.py`'s SQL `SELECT` lists are already narrow, so a
future column added to a query doesn't silently start appearing in the API
response without someone deciding it belongs there. `_serialize_route`'s
allowlist now also includes `stops` (see §1.4) when populated by
`get_route()`. None of these expose `created_by`/`approved_by`/`updated_by`/
`is_deleted`/`deleted_at` or other staff-only columns.

**Payment reference storage:** `payment_reference` is not a column on
`apps.ticketing.Ticket` — that app is off-limits to migrate. It's persisted
in a small table this API owns outright, `public.public_api_ticket_payment_ref`
(`ticket_uid` primary key, plus `tenant_schema` for consistency with how
other cross-tenant lookups in `tenant_db.py` are scoped), in the same shared
Postgres schema as `tenants_tenant`/`tenants_domain`. Chosen over Redis
because a payment reference is audit/reconciliation data that should outlive
a ticket's lifetime, not something appropriate for a cache. The table is
created lazily on first use (`tenant_db._ensure_payment_ref_table`, an
idempotent `CREATE TABLE IF NOT EXISTS` — not a Django migration), so it
self-heals regardless of whether a given Postgres volume is fresh or
pre-existing.

### 1.6 Known gaps / operational notes

- **FastAPI's own docs are reachable through the normal nginx front door** at
  `/public-api/docs`, `/public-api/redoc`, `/public-api/openapi.json` (exact
  `location` matches in `docker/nginx/nginx.conf` / `nginx.local.conf`, since
  the broad `location /api/` rule would otherwise shadow them by routing to
  Django instead — `/api/docs`/`/api/redoc` on their own still mean Django's
  separate Swagger UI). The FastAPI container's own port
  (`http://<host>:8001/api/docs`) also still works directly.
- Rate-limited at the nginx layer: `location /public-api/` uses the
  `public_api` zone (100 req/min per client IP, burst 20) — see
  `docker/nginx/nginx.conf` / `nginx.local.conf`.
- No payment gateway integration — nothing here calls eSewa/Khalti/etc. to
  actually charge a fare; the app must complete payment out-of-band before
  calling `POST /tickets/`. `payment_method` is still just an enum label. An
  external gateway's own transaction reference *can* now be attached via the
  optional `payment_reference` field (§1.4) — that's reference storage for
  reconciliation, not a gateway integration.
- No SMS/push receipt on issuance or validation — the API response itself is
  the only confirmation.

---

## 2. Django REST API — `/api/v1/...`

**Code:** `backend/apps/*/views.py`, `urls.py` per app; routing in
`backend/config/urls.py` (real tenant domains) and `backend/config/urls_public.py`
(the `public` schema only — see the two-urlconf note below).
**Consumers:** the Super Admin portal (platform staff) and Tenant Portal
(operator staff — dispatchers, fleet managers, conductors, finance, etc.).

### 2.1 Auto-generated docs

- Swagger UI: `/api/docs/`
- ReDoc: `/api/redoc/` — **tenant domains only**, not registered in
  `urls_public.py`, so this 404s on the bare public-schema host (e.g.
  `localhost`). Works on a real tenant subdomain, e.g.
  `test.localhost:8090/api/redoc/`.
- OpenAPI schema (JSON): `/api/schema/`

### 2.2 Auth (`/api/v1/auth/`, `apps.users`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/auth/login/` | Obtain JWT pair (access + refresh). Response includes `role`, `tenant_schema`, `full_name`, `language`, `user_id`, `requires_2fa`. |
| `POST` | `/api/v1/auth/token/refresh/` | Refresh an access token (`ROTATE_REFRESH_TOKENS` + blacklist-after-rotation enabled). |
| `POST` | `/api/v1/auth/logout/` | Invalidate the current session. |
| `GET` | `/api/v1/auth/profile/` | Current user's profile. |
| `GET/POST` | `/api/v1/auth/users/` | List/create users (platform-role gated). |
| `POST` | `/api/v1/auth/change-password/` | Change password. |

### 2.3 Multi-tenancy — two independent mechanisms

1. **Hostname-based** (django-tenants' `TenantMainMiddleware`): the `Domain`
   model maps a hostname to a `Tenant`; determines which URLconf (`urls.py`
   vs. `urls_public.py`) and Postgres schema a request resolves to.
2. **Header-based** (`backend/config/tenant_middleware.py`'s
   `TenantSchemaMiddleware`, custom to this repo): reads the `X-Tenant-Slug`
   header (set by the frontend's axios interceptor) and calls
   `connection.set_tenant()` — this is what actually scopes `TENANT_APPS`
   data (fleet, staff, dispatch, accounting, rbac, etc.) for API calls that
   go through the shared `localhost`/nginx host rather than a tenant
   subdomain directly. The header is checked against the *authenticated
   user's own* `tenant_schema` claim before the schema switch is honored —
   a cross-tenant header value gets a `403`, not a silent wrong-schema read.

**Two-urlconf gotcha:** any app added to `TENANT_APPS`
(`backend/config/settings/base.py`) must be registered in **both**
`urls.py` and `urls_public.py`, or it 404s the moment a request is on a real
tenant subdomain (or vice versa on the public schema). `apps.inventory` has
this gap today (registered in one, not the other) — its frontend page is
unrouted dead code, so it hasn't mattered in practice, but it's a trap for
the next app added to `TENANT_APPS`.

### 2.4 App URL prefixes

| Prefix | App | Scope | Notes |
|---|---|---|---|
| `/api/v1/platform/` | `tenants` | Shared (public schema) | Tenant CRUD, subscriptions, onboarding |
| `/api/v1/platform/` | `platform` | Shared (public schema) | Routes, Stops, RouteStop, FareMatrix, TicketType, SmartCard — same models the Master API reads directly |
| `/api/v1/billing/` | `billing` | Shared | AMC plans, invoices |
| `/api/v1/operator/` | `staff` | Tenant | Drivers, conductors, staff records |
| `/api/v1/fleet/` | `fleet` | Tenant | Vehicles |
| `/api/v1/scheduling/` | `scheduling` | Tenant | Timetables, trips, driver shifts, auto-schedule, ETA/headway/playback/live-positions/route-polyline |
| `/api/v1/dispatch/` | `dispatch` | Tenant | Bus/driver assignment |
| `/api/v1/ticketing/` | `ticketing` | Tenant | Tickets, daily/monthly/student passes — **the Master API's ticket endpoints proxy here** |
| `/api/v1/maintenance/` | `maintenance` | Tenant | Service records |
| `/api/v1/fuel/` | `fuel` | Tenant | Fuel logs |
| `/api/v1/procurement/` | `procurement` | Tenant | Purchase orders |
| `/api/v1/incidents/` | `incidents` | Tenant | Incident reports |
| `/api/v1/operator/complaints/` | `complaints` | Tenant | Complaint handling (staff side; public submission is a separate public endpoint) |
| `/api/v1/documents/` | `documents` | Tenant | Document storage |
| `/api/v1/analytics/` | `analytics` | Tenant (registered in both urlconfs — city-wide views run on the public/shared host) | Reporting. Includes the **live ticket/revenue dashboard**: `GET /analytics/tickets/live/?date=YYYY-MM-DD` (one operator's own running totals — `role` must be ops or finance staff) and `GET /analytics/city/tickets/live/?date=YYYY-MM-DD` (platform-wide, aggregated live across every `ACTIVE` tenant schema — `IsTransportAuthority` only). Both computed on-the-fly from `apps.ticketing.Ticket` every call (no snapshot table). Response: `ticket_count`, `qr_codes_issued` (always equal — every ticket gets exactly one QR at creation), `total_collected`, `cash_collected`, `by_payment_method` (tenant view) / `by_tenant` (city view). **Deliberately excludes GPS/live-tracking and payment-gateway/bank-settlement data** — see below. Also pushed over WebSocket — see §3's `WS /api/v1/live/ws/tickets/`, since Django itself has no Channels/WebSocket infrastructure to push from directly. |
| `/api/v1/accounting/` | `accounting` | Tenant | Chart of accounts, journal entries, salary payments, financial reports — see `docs/ACCOUNTING_MODULE_DEVLOG.md` for full endpoint detail |
| `/api/v1/notifications/` | `notifications` | Shared | Notification delivery |
| `/api/v1/rbac/` | `rbac` | Tenant | Roles & permissions |
| `/health/` | `users` (`health_urls`) | — | Health check |

Public (unauthenticated) endpoints live under `/api/v1/public/` (see
`urls_public.py`): stop lookup, fare inquiry, complaint submission.

**Deliberately not built (2026-08-02), both explicitly out of scope by
request:**
- **Live bus tracking in Yatroo** ("where each bus is / ETA to a stop") — this
  is GPS/live-position tracking by definition (§3 already has the
  infrastructure — `GET /vehicles/`, `WS /ws/vehicles/{tenant_slug}/`,
  `WS /ws/trips/{trip_id}/` — for internal dispatcher dashboards). Excluded
  because GPS was explicitly out of scope for this round of work; wiring it
  into the Master Consumer API for Yatroo is a distinct follow-up task, not
  an oversight here.
- **Automatic wallet-payment revenue split to bank accounts** — this repo has
  no payment-gateway settlement or bank-transfer integration at all today
  (see §1.6). Splitting and *actually moving* money requires that
  integration to exist first; excluded entirely rather than building a
  calculation that has nowhere real to send its result.

---

## 3. FastAPI — GPS & Live Ops — `/api/v1/live/...`

**Code:** `backend/fastapi_services/gps/router.py`,
`backend/fastapi_services/live_ops/router.py`.
**Consumers:** GPS hardware/simulators (ingest), internal dispatcher
dashboards (everything else). **Not** used by the Master Consumer API or the
Yatroo mobile app — this is the live-tracking surface the Master API
explicitly stays out of (§1.1).

All Redis-backed; positions are stored with a 300s TTL snapshot key
(`vehicle:position:{vehicle_id}`) plus a 1000-entry, 24h time-series list
(`vehicle:ts:{vehicle_id}`) for playback.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/gps/ingest/` | none | GPS device pushes a position event. Target: 500 events/sec. Triggers a `SPEEDING` alert (broadcast + stored) if over `SPEED_ALERT_THRESHOLD_KMH`. |
| `GET` | `/vehicles/` | `get_current_user` | Snapshot of all current vehicle positions, optionally filtered by `tenant_slug`. |
| `GET` | `/alerts/active/` | `get_current_user` | Last 50 unresolved alerts for a tenant. |
| `WS` | `/ws/vehicles/{tenant_slug}/` | — | Live position broadcast for a tenant's whole fleet. |
| `WS` | `/ws/trips/{trip_id}/` | — | Live position broadcast for one trip. |
| `POST` | `/gps/simulate/` | none | Demo/testing only — injects simulated positions along a route (defaults to a Kathmandu Valley path if none given). |
| `POST` | `/geofences/` | `get_current_user` | Create a geofence zone. |
| `GET` | `/ops/summary/` | `get_current_user` | Dispatcher dashboard: active vehicle count + recent alerts for a tenant. |
| `POST` | `/ops/alerts/{alert_id}/resolve/` | `get_current_user` | Mark an alert resolved. |
| `WS` | `/ws/tickets/?token=<jwt>` | query-param JWT, decoded by hand (see §1.4's `/ws/tickets/` note — same reasoning) | Live money/ticket dashboard push (§2.4's `analytics` row). **Not GPS data** — the one exception in this section — but lives here because this is the staff-dashboard audience, and Django itself can't push (no Channels). Doesn't reimplement the aggregation: on connect, decides platform-wide (`SUPER_ADMIN`/`TRANSPORT_AUTHORITY_OFFICER`) vs. one-operator (any other staff role with a `tenant_schema`) from the token's role, then calls the *same* `GET /analytics/.../tickets/live/` Django endpoint every 5s via `_proxy_to_django` (imported from `public_api/router.py`) and pushes whatever it returns — so Django's own permission classes are still the real access gate, not anything reimplemented here. Closes with `1008` on a bad/roleless token, `1011` if the schema has no resolvable domain, or after relaying one non-2xx response from Django (e.g. a permission change mid-session) rather than looping on the same rejection. |

`/health` (FastAPI's own, distinct from Django's `/health/`) is a plain
liveness check defined in `main.py`; `/metrics` exposes Prometheus stats via
`prometheus-fastapi-instrumentator`.

---

## Appendix — local dev quick reference

| Service | Direct port | Via nginx (`localhost:8090`) |
|---|---|---|
| Frontend | `3002` | `/` |
| Django | `8002` | `/api/`, `/admin/`, `/health/` |
| FastAPI | `8001` | `/public-api/`, `/api/v1/live/`, `/ws/v1/` |
| Postgres | `5435` | — |
| Redis | `6381` | — |

Ports are remapped from image defaults to avoid clashing with services that
may already be running on the host (see `docker/docker-compose.yml` /
`docker-compose.override.yml`). `docker compose restart django` is required
after any `backend/**/*.py` change — `daphne` does not auto-reload; the
frontend (Vite) does.
