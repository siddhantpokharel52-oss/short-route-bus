# CityBus / KVBMS — Project Handover

**Purpose:** current, single source of truth for anyone picking this project
up — what's built, what's deployed, how to operate it, and what's still
open, across four active workstreams (the Yatroo integration, the
NamastePay payment system, the CityBus Team Implementation Guide gaps, and
the Route & Group Rotation QA fix series) plus current production
deployment status.

**Last updated:** 2026-09-23

---

## 1. Executive summary

| Workstream | Status |
|---|---|
| **Yatroo integration** (§2) | Feature-complete. A partner-reported complaint (no ticket API, slow fares) was investigated and found factually incorrect on the ticket-API claim; the fare-speed claim has no visible code cause. A newer Namaste Pay "Partner/Subscriber App" integration model was also analyzed against the codebase — mostly not built yet (§2.5). |
| **NamastePay payment system** (§3) | 7 of 10 spec items (CB1–CB4, CB6, CB7, CB9) done and committed. 3 items (CB5, CB8's remainder, CB10) are blocked on NamastePay/product decisions, not code work. |
| **Team Implementation Guide gaps** (§4) | All 3 original code-fixable gaps closed (per-passenger destinations, Bus Owner Dashboard, ticket history API), plus a follow-up pass that found and closed a real access-control gap — the Owner Dashboard's own endpoints and nav had no real role scoping. Also added: ISSUED/PAID timestamp scaffolding for §3.6, a `child_fare` bulk-tooling fix for §3.3, (§4.5) a full real-device testing pass across owner/conductor/admin that found and fixed six more UX/access gaps, including a hard requirement that a conductor open a shift before issuing tickets, and (§4.6) a real regression that same lockdown introduced — self-service/group ticket purchase would have 403'd in production — caught live and fixed before shipping. 2 items (§3.6's actual state machine, §3.3's real concession rates) still need a team decision or external numbers, not code. |
| **Route & Group Rotation QA report** (§5) | All 94 issues triaged; every issue that was a real, scopeable bug is fixed and verified live (Critical 5/5, High 21/24, Medium/Low 29/65). The rest (39 issues) are explicitly "Clarify"-status or large standalone features needing a product decision first — not oversights. |
| **Production deployment** (§6) | Everything through commit `ef413128` is confirmed live in production as of 2026-09-21. §4.5/§4.6's fixes are committed and pushed (`c3374338`) but **not yet confirmed deployed** — deploy commands are ready, see §6. |

---

## 2. Yatroo integration — feature-complete, live in production

Two separate pieces of work, both done:

1. **Federated login** — a real Yatroo passenger can get a scoped City Bus
   API token without a separate signup, via a server-to-server HMAC-signed
   exchange. Built, deployed, confirmed working with Yatroo's actual real
   HMAC secret and a real request from their backend.
2. **Master API gaps from Yatroo's own app-spec document** — every item in
   their UX/API spec PDF is implemented (location-aware stop search,
   destination-only route search, richer route detail, fare distance/time,
   selectable ticket type, route description), except one deliberate,
   communicated divergence (§2.4).

### 2.1 Federated login — how it works

**Endpoint:** `POST /partner/federated-login` (also reachable at
`/public-api/v1/partner/federated-login` — both resolve to the same place;
see the nginx note in §6).

**Flow:** Yatroo's backend, having already authenticated its own rider,
signs a request (`external_user_id` + optional `phone`/`email`/`name`) with
a shared HMAC-SHA256 secret and calls this endpoint. We verify the
signature (timestamp window + one-time nonce), look up or create a scoped
City Bus passenger account keyed on `(partner="yatroo", external_partner_id)`,
and return a normal passenger JWT — indistinguishable downstream from a
token issued by a real login, so every other Master API endpoint just works
against it unchanged.

**Code:** `backend/fastapi_services/partner_api/router.py` (FastAPI side —
signature verification, token minting) + `backend/apps/users/views.py`
`PartnerProvisionView` (Django side — idempotent account lookup/creation,
called internally by FastAPI over a service-to-service header, never
exposed publicly).

**Design note — Yatroo-only, not a generic multi-partner system:** this was
built, then briefly generalized to a multi-partner design (per-partner
secrets, `X-Partner` header), then explicitly reverted back to Yatroo-only
per direct instruction ("this system is especially for the yatroo only").
The same convention was applied later to NamastePay (§3) — distinct secrets
per partner (`YATROO_HMAC_SECRET`, `INTERNAL_SERVICE_KEY`,
`NAMASTEPAY_LOOKUP_SECRET`), never shared. If a second partner is ever
onboarded for real, that's a small, well-scoped addition then — not
something to carry as speculative complexity now.

**Real bugs this surfaced, all fixed:**
- Minted tokens were missing `token_type`/`jti` claims that
  `rest_framework_simplejwt` requires on anything proxied through to
  Django (e.g. ticket cancellation) — invisible to mocked tests, since a
  mock never actually decodes a JWT.
- Ticket cancellation for a passenger-owned ticket 403'd, because a
  passenger's own `tenant_schema` is correctly `""` (not tied to one
  operator) but the tenant-slug middleware needs an exact match — fixed by
  routing through the same scoped self-service account `issue_ticket()`
  already used for the identical reason.
- The internal FastAPI→Django provisioning call had no explicit `Host`
  header, so django-tenants couldn't resolve a schema for the internal
  docker hostname and 404'd — invisible in dev, because dev's seed data
  happens to register `django` itself as a tenant domain alias; production
  has no such alias. Fixed by adding `DJANGO_PUBLIC_DOMAIN` and setting it
  explicitly.

### 2.2 Master API gaps closed (from Yatroo's app-spec PDF)

Source: `/home/aadarsha/Documents/Sha-requirements/yaatro city Bus docs.pdf`
(their own product/UX spec, not something in this repo).

| Their ask | What shipped |
|---|---|
| Location-aware stop search for the home feed | `GET /stops/autocomplete/` takes optional `lat`/`lon`; results sorted by walking distance, each gains `distance_km` |
| Get routes for a single picked destination (no origin yet) | `GET /routes/?stop=<code>` — new search mode, deterministic precedence if combined with the existing `from_stop`/`to_stop` or `lat`/`lon` modes |
| Route detail: first/last bus, frequency, total buses, total stops, estimated duration | All bundled into `GET /routes/{id}/` directly — no second call to the timetable endpoint. `total_buses` is a real cross-tenant fan-out query over `apps.fleet.Vehicle`, excluding retired/inactive/breakdown vehicles |
| Route detail: distance from route start, per stop | Added to the embedded `stops[]` list as `distance_from_start_km` — cumulative haversine along consecutive stops (same approximation basis already used elsewhere; no real road-distance data source exists yet) |
| Fare lookup: distance + time between stops | `GET /fares/` gains `distance_km`/`time_minutes`, measured along the specific `route_id` in the request |
| Selectable ticket type at purchase | `POST /tickets/` (self-service) takes optional `ticket_type` (e.g. `ADULT`/`STUDENT`), resolved to `Ticket.ticket_type_id` server-side |
| Route Description field | `Route` had no such column at all — added as a real migration (`apps.platform.migrations.0004_route_description`), surfaced on route detail and the more specific search results, intentionally left off the bare `/routes/` list to avoid bloating every list response with free text (same precedent as `geojson_path`) |

**Code:** `backend/fastapi_services/public_api/router.py` +
`backend/fastapi_services/public_api/tenant_db.py`.

### 2.3 Not implemented — verify before assuming otherwise

- **Field naming** — Yatroo's spec proposes different field names in places
  (`stop_id`/`stop_name` vs. our `id`/`name_en`; a `/tickets/users` path vs.
  our real `/tickets/`). We did **not** rename our fields to match theirs —
  that risks breaking the existing API contract for no real benefit. The
  mapping is documented for them instead, in
  `docs/CityBus_Master_API_Reference_for_Yatroo.docx`.
- **Sort routes by fare or frequency** — their spec marks this as optional/
  for-later, with "nearest stop" (already covered by the existing
  `lat`/`lon` search) as the only required default. Not built.
- **`ticket_type` is optional**, not required as their spec states — a
  deliberate looser constraint, since making it hard-required would be a
  breaking change for any caller (including Yatroo's own already-built
  integration) that doesn't send it.

### 2.4 Deliberate divergence: ticket purchase stays payment-first

Yatroo's spec proposes creating a ticket as `PENDING` first, then handling
payment as a separate step afterward (`payment_status` field, implying a
webhook or confirm-call later). We explicitly kept the existing flow
instead: `payment_reference` is required upfront (their own gateway has
already collected payment before calling us), and the ticket issues as
`VALID` immediately. No new ticket states, no webhook infrastructure needed
on our side. This was a direct decision — not an oversight — and has been
communicated to Yatroo in `docs/CityBus_Master_API_Recent_Changes.docx`.
The same "no pending-ticket state" constraint later shaped how NamastePay's
own flows were built (§3), and is the exact reason the Team Implementation
Guide's proposed ticket state machine is still an open item (§4.4).

### 2.5 Newer requirement — Namaste Pay "Partner/Subscriber App" model via Yatroo — gap analysis

A separate document (Nepali-language, provided directly by the user, not a
file in this repo) describes a materially different integration model than
anything built so far: each **bus owner** gets their own Namaste Pay
**Agent Wallet/Account** (via Namaste Pay's own "Partner App"), money from
a ticket sale goes **directly into that owner's own account** (not a
pooled CityBus account), and passengers pay **directly from their own
Namaste Pay wallet** via a "Subscriber App" API — a different mechanism
than the hosted-checkout-redirect flow CB9 already built. Checked point by
point against the actual code:

| What the doc asks for | Status | Why |
|---|---|---|
| Multi-passenger booking, each with own type/destination/fare | ✅ Built | Already covered by CB2 + §4.1's per-passenger destination fix + CB3's concession fares |
| Dynamic per-ticket QR, conductor scan-to-verify | ✅ Built | `_generate_ticket_uid_and_qr()`, `validate_ticket()` |
| Passenger's full ticket history (date/route/bus/amount/grouping) | ✅ Built | §3.8's ticket history fix |
| Per-vehicle ticket/collection records | ✅ Built | `Ticket.vehicle_id` (CB1), Owner Dashboard per-bus breakdown (§4.1) |
| Money settling into each owner's **own** Namaste Pay account | ❌ Not built | `NamastePayConfig` is one row per **tenant** (company-wide), not per-owner — confirmed via `NamastePayConfig.objects.first()`, an unfiltered singleton lookup, used everywhere the config is read. `fleet.Owner` has no field referencing any Namaste Pay account/wallet/agent ID at all. |
| Static QR on the bus for a passenger with no app booking | ❌ Not built | Zero matches anywhere in the codebase for any static/owner-linked QR — only the existing per-ticket dynamic QR exists. Same root blocker as CB5. |
| Passenger paying directly from their Namaste Pay wallet (Subscriber API) | ❌ Not built | The existing NamastePay flow (CB9) is a hosted-checkout redirect, a different mechanism; no Subscriber API integration exists, and we don't have their Subscriber API docs. |
| Per-company/per-vehicle route availability with times | ⚠️ Partial | `GET /routes/{id}/` returns only an aggregate `total_buses` count across every operator on that route — the per-schema counts are computed internally then discarded, never broken out per company. No live arrival times (GPS tracking is out of scope, §9). |
| Namaste Pay's own future interoperability with other PSPs | N/A | Entirely Namaste Pay's own roadmap; not something this codebase would ever implement either way. |

**Bottom line:** this document assumes a fundamentally different money-routing
architecture (per-owner wallets) than what CB1–CB10 built (one pooled
tenant account with internal bookkeeping). Closing this gap needs three
things only Namaste Pay/CityBus can supply: Namaste Pay's Partner App
actually issuing each owner their own Agent account/wallet ID we can
store and use, Namaste Pay's static QR content format, and Namaste Pay's
Subscriber API documentation if direct wallet-debit (rather than
hosted-checkout) is actually wanted. Full analysis sent to the user as
`docs/Yatroo_NamastePay_Gap_Analysis_Layman.txt`.

### 2.6 Partner complaint investigated — "no ticket API, slow fares" (2026-09-21)

A complaint attributed to Yatroo's side (reportedly raised 2026-09-01, no
response since) claimed no ticket-generation API exists and the fare
search API is slow. Checked directly against the code:

- **"No ticket API" — false.** `POST /tickets/` (`public_api/router.py:777`)
  explicitly branches on `role == PASSENGER` and supports both scan-to-book
  (`trip_qr_token`) and full self-service purchase (`route_id` +
  `payment_reference`, no conductor needed). `POST /tickets/group/` and
  `POST /tickets/namastepay/checkout/` also exist. All are real, working,
  proxied through to Django's ticket-creation logic. Most likely
  explanation: Yatroo is working off stale/incomplete documentation — see
  §7, the Reference doc still hasn't been sent to them.
- **"Fares API slow" — no cause found in code, can't rule it out either.**
  Traced the full call chain (`get_fares` → `tenant_db.fetch_fares` →
  `_fetch_fares_exact`): no cross-schema fan-out, no N+1 queries, no
  blocking calls, queries properly scoped by `route_id`. If real, this
  points to infrastructure (DB connection contention, network latency)
  rather than a code design flaw — worth timing a real request rather than
  guessing either way.
- The "no response since Sep 1" part is a human communication question,
  not something verifiable from the code — worth checking directly with
  whoever manages the Yatroo relationship.

---

## 3. NamastePay payment system (CB1–CB10)

Source: `/home/aadarsha/Documents/Sha-requirements/CityBus-Payment-System-Design.docx`
(prepared by Shangrila Dev Team, audience Namaste Pay/CityBus/Yatroo).
Defines six payment flows (P1–P4, C1–C2) and ten CityBus-owed requirements
(CB1–CB10).

### 3.1 Done and committed

| Item | What shipped | Commit |
|---|---|---|
| Gateway plumbing | NamastePay credentials + integration scaffolding, then a real fix once their auth scheme (`X-API-KEY`) was confirmed against their actual docs (initial build had guessed wrong) | `5f1fb066`, `930467b2`, `a72a9fbc`, `419aa6a5` |
| CB1 — bus/vehicle on every ticket | | `a67c3d05` |
| CB6 — ticket search/validation filtered to a specific bus | | `547e4816` |
| CB2 — group booking support | | `b704f542` |
| CB7 — conductor shift / cash ledger | | `b2598ec3` |
| CB3 — child concession fare | | `5122eeda` |
| CB9 — checkout confirmation flow | Built as a redirect-confirmation flow instead of a signed webhook, since NamastePay's real API (confirmed against their docs) has no signed webhook — only a browser redirect + server-side `enquire_checkout()` re-verification | `ceb0c542` |
| CB4 — ticket lookup API for NamastePay's pay-by-ID screen (P4) | Required extending CB9's `NamastePayCheckout` to also cover conductor-initiated walk-in checkouts. New module `backend/fastapi_services/namastepay_api/`, gated by `NAMASTEPAY_LOOKUP_SECRET` | `42397f7e` |

### 3.2 Blocked — waiting on external input, not code work

- **CB8** (conductor↔vehicle↔shift linkage) — mostly covered by CB7's
  `ConductorShift.vehicle_id`/`conductor_user_id`. The remaining half
  (conductor's own NamastePay wallet identity) only matters for
  cash-settlement Model B and is blocked on the same open item as CB10.
- **CB5** (static QR format/reissue) — blocked: NamastePay hasn't
  specified their QR content format (spec's open item #6).
- **CB10** (owner dashboard: settled vs. outstanding cash) — blocked:
  depends on which cash-settlement model (A/B/C) gets chosen (spec's open
  item #1). Note: the *dashboard itself* is now built (§4.1) — what's
  blocked is specifically the settled/outstanding split, since no
  settlement record exists anywhere yet.

### 3.3 Key architecture finding (load-bearing for any future work here)

The spec's lifecycle assumes a ticket can exist "created but not yet paid"
(flows P1/C2). **This codebase has no such state** —
`Ticket.status` is only `VALID`/`USED`/`EXPIRED`/`CANCELLED`, and every real
issuance path creates `Ticket` atomically with payment already settled
(same constraint as Yatroo's §2.4 divergence). The pattern established
here: model any "pending payment" case as a `NamastePayCheckout` row
(materializes `Ticket`/`Booking` only on confirmed payment), never as a new
`Ticket` state. Any future CB-numbered item touching "unpaid"/"pending"
tickets should reuse `NamastePayCheckout` (or a sibling pending-object
pattern) — adding a pending state to `Ticket` itself would touch
`accounting/signals.py`'s unconditional revenue-recognition trigger and
every other view that assumes a `Ticket` row means a settled fare. This is
also the exact reason §4.4's ticket-state-machine item is unresolved, not
built.

**Code:** `backend/apps/ticketing/models.py`/`views.py`/`serializers.py`,
`backend/fastapi_services/namastepay_api/`,
`backend/fastapi_services/public_api/router.py` (checkout start endpoint).

---

## 4. CityBus Team Implementation Guide v1.0 — Phase 1 gaps

Source: `CityBus-Team-Implementation-Guide-v1.0.docx` (Shangrila Dev Team,
20 September 2026) — a build-ready extract of the master Payment System
Design, telling the CityBus team what to build now ("Phase 1 — no external
dependency"), what to design room for but not build yet (Phase 2, waiting
on Namaste Pay), and what the cash ledger needs regardless of which
settlement model eventually gets picked (Phase 3). Nine Phase 1 items in
total; six were already covered by CB1–CB9 (§3.1). Cross-checking the
other three against the actual code found real, narrow gaps — all three
closed this session. A follow-up pass then checked the shipped Owner
Dashboard against the doc's own access requirement ("an owner sees their
earnings, their trends, nothing else") and found it wasn't actually
enforced — see §4.1's second table below.

### 4.1 Gaps closed

| Item | What shipped | Commit |
|---|---|---|
| §3.2 — group bookings, per-passenger destinations | The doc's own field table is explicit: origin shared by the booking (everyone boards the same bus at the same point), destination per passenger (selected individually, can differ per line). `Booking`/`NamastePayCheckout` had both wrongly booking-level — every ticket in a group got the same destination regardless of what each passenger actually picked. Moved `to_stop_id` into each passenger entry (`BookingPassengerSerializer`, shared by both the group-booking and NamastePay-checkout paths); dropped the now-meaningless single `to_stop_id` column from both models. `from_stop_id` (origin) is untouched — it was already correctly shared. | `2a34fbf7` |
| §3.7 — Bus Owner Dashboard | New `fleet.Owner` entity (a tenant's fleet can include buses belonging to several different owners) + `OWNER` role, scoped strictly to the buses one owner holds: per-bus breakdown, daily/weekly/monthly trends with ridership, cash-vs-online split, revenue by route (attributed via `dispatch.DailyAllocation`, the date-accurate vehicle→route link — not `Vehicle.assigned_route_id`, which only reflects today's assignment and would misattribute historical revenue after any reassignment). Reports `cash_collected`/`online_collected`, deliberately not "settled/outstanding" — no settlement record exists anywhere yet, same blocker as CB10 (§3.2). Verified owner isolation directly: a second owner's vehicles/tickets never appear in the first owner's dashboard. | `f8707112` |
| §3.8 — Ticket history API | `GET /tickets/my/` was dropping `vehicle_id` (already fetched from the DB, just never returned — a one-line drop), never selected `booking_id` at all despite it being a real column, and had no route anywhere (`Ticket` itself has no `route_id` column — only recoverable via `Booking.route_id` for a group-booked ticket or `scheduling_trip.route_id` for a scan-to-book one; a plain self-service ticket has neither and correctly returns `null` rather than guessing). Reuses the endpoint's existing "enrich after fetch" pattern (`enrich_stop_names` etc.), with route/bus resolution grouped per tenant schema since `Booking`/`Vehicle`/`Trip` are tenant-scoped tables, unlike the shared `platform_stop`/`platform_route` tables the existing enrich functions already query globally. | `f4beb272` |

**A real bug the Owner Dashboard build surfaced, caught only by an actual
browser login, not by any backend/API test**: adding the `OWNER` role to
`User.Role` wasn't enough for the *frontend* to route an owner into the
tenant portal. Three separate hardcoded tenant-role lists in the frontend
(`store/authStore.ts`'s `isTenantRole`, `App.tsx`'s `ProtectedRoute
allowedRoles` guarding `/tenant/*`, and `hooks/useAuth.ts`'s
`redirectByRole`) didn't know about the new role — an owner login
succeeded (valid JWT, correct role) but silently landed on the public
passenger site instead of the dashboard. All three fixed in `f8707112`.
Worth remembering next time a new role is added: grep for existing role
lists, don't assume the backend `Role` choice alone is enough.

### 4.2 Owner Dashboard access lockdown (follow-up, found while answering "how many pages are denied to the owner role?")

Asked directly against §3.7's own wording ("an owner sees their earnings,
their trends, nothing else") — re-checking the shipped dashboard (§4.1)
found it wasn't actually enforced:

| Gap found | Fix | Commit |
|---|---|---|
| The tenant-portal nav (`TenantLayout.tsx`) showed an owner the full ~20-item admin sidebar — the only role logic there *adds* items, never removes any. Most of those pages did 403 for an owner at the API layer (incidentally, not by design), but a few landed on real, unfiltered data. | Nav now shows an owner exactly one item, My Earnings. Login also redirects an owner straight there instead of to Live Tracking. | `14f28a83` |
| `TicketViewSet`/`BookingViewSet` (the tenant's full ticket/booking list) and `ConductorShiftViewSet` (every conductor's cash-shift history) were gated only by `IsAuthenticated` — no role check at all. An authenticated owner could call either and see full tenant-wide data, not scoped to their own buses. | New `IsTenantStaff` permission class (`backend/apps/users/permissions.py`) — deliberately a short deny-list (excludes `OWNER`/`PASSENGER`/`STUDENT`/`TOURIST`) rather than this file's usual per-role allow-list, so a future new staff role doesn't need to be remembered and added everywhere, the same omission bug that broke owner login in §4.1. Applied to both views. | `14f28a83` |
| Worse than the above, found only by an actual browser login (same lesson as §4.1's role-list bug): `scheduling.LivePositionsView`/`PlaybackView` — the live GPS tracking map's data source — were also plain `IsAuthenticated`, and were an owner's *default landing page* after login (`redirectByRole` sent every tenant role, owner included, to Live Tracking). An owner's very first screen, no clicks needed, was a live GPS map of the tenant's entire fleet. | Same `IsTenantStaff` class applied to both views; login redirect fixed as above. | `14f28a83` |

Verified with a Django-shell regression matrix (owner 403 on all three
endpoint groups, every currently-working staff role — company admin, ops
manager, conductor, finance — still 200, no regression) and a real
browser login as the demo owner account, confirming the sidebar, the
post-login landing page, and direct-URL attempts to reach Ticketing/Live
Tracking all now behave correctly.

### 4.3 ISSUED/PAID scaffolding + `child_fare` bulk-tooling fix

Two smaller, unrelated fixes made in the same follow-up pass, prompted by
"so we can't do anything right now?" about the two still-open items below:

- **`Ticket.paid_at`** — a new, separate timestamp from `issued_at`,
  matching the doc's own advice for §3.6 ("build ISSUED and PAID as
  separate, independently-timestamped states... keeps you safe whichever
  way that decision lands, without a rework"). Every current
  ticket-creation path sets it immediately (zero behavior change — see
  §4.4 below), but `accounting/signals.py`'s revenue-recognition signal
  and ticket-validation (`TicketVerifySerializer`) both now guard on it,
  so a future pay-later flow can't prematurely recognize revenue or pass
  boarding validation. Commit `da4a7128`.
- **`child_fare` wired into `FareMatrixViewSet.bulk_import` and
  `.generate_from_formula`** (`backend/apps/platform/views.py`) — these
  two bulk fare-entry tools were never updated after `child_fare` shipped
  (§3.1, CB3) and were silently defaulting every bulk-entered/generated
  fare row's `child_fare` to `0` (free for children), unnoticed. Commit
  `da4a7128`.

### 4.4 Still open from this doc

- **§3.6 — ticket state machine.** The doc's proposed lifecycle
  (`CREATED → UNPAID → PAID`/`PAYMENT_PENDING → VALIDATED`, plus
  `REFUND_REQUESTED`/`REFUNDED`) directly conflicts with the decision
  already made and documented in §2.4/§3.3 above: every real ticket in this
  codebase is created atomically with payment already settled, and
  `accounting/signals.py` fires revenue recognition unconditionally the
  instant one exists. The doc itself flags this exact tension as
  unresolved (its own open item 2, §7 of that doc — "payment before or
  after ticket issuance"). **The `ISSUED`/`PAID` timestamp scaffolding the
  doc asks for as a hedge is now built** (`Ticket.paid_at`, §4.3,
  `da4a7128`) — today it's always set equal to `issued_at` (zero behavior
  change), so this doesn't resolve the open item, it just means whichever
  way the decision lands, no schema rework is needed. Still needs an
  actual decision from the team before the *behavior* (when does a ticket
  actually become PAID) is built.
- **§3.3 — fare rounding rule.** The doc's own open item 1 (its §7) is
  still unconfirmed — but investigating it this session found it doesn't
  actually block anything: there is no live code anywhere in this
  codebase that computes a concession fare as a percentage discount of the
  base fare. `student_fare`/`senior_citizen_fare`/`child_fare` are always
  flat, directly-entered-or-copied values. The one place a
  percentage-discount model exists at all, `platform.FareDiscount`
  (`discount_percentage`), is configuration that's stored via its own CRUD
  serializer but never read/applied anywhere — the same "modeled but
  orphaned" shape already found for `ticketing.StudentPass`. So there's
  nothing today for a rounding rule to attach to; it only becomes a real
  blocker once/if concession-by-percentage is actually built. What *was*
  a real, unrelated gap in this area — `child_fare` never wired into the
  two bulk fare-entry tools — is fixed (§4.3, `da4a7128`).
- **§4–§6 of the doc (Phase 2/3 preview)** — static QR content per bus,
  payment orchestration/webhook receiver, the cash-settlement model choice
  — all already tracked as blocked in §3.2 above. This doc doesn't change
  that; it explicitly agrees with it ("waiting on Namaste Pay's answers,"
  its own §1 phase table).

### 4.5 Real-device role testing pass (2026-09-22) — six findings, all fixed

Three persistent local-dev demo accounts were created (`demo.owner@kvbms.local`,
`demo.admin@kvbms.local`, `demo.conductor@kvbms.local` — all `DemoX@2026`
passwords, tenant `mayurbus`, meant to stay around for ongoing manual
testing, not one-time throwaway logins) specifically so every role could be
clicked through for real instead of reasoned about from code. That found
six real gaps, all fixed and re-verified live in the same session:

| Finding | Fix |
|---|---|
| An owner could still reach other tenant pages (e.g. Live Tracking) by typing the URL directly — nav hid the link and the API correctly 403'd, but the page *shell* still rendered, with an "Access denied" toast and an empty map. | New route guard in `TenantApp.tsx`: any `/tenant/*` path other than `my-earnings` redirects an `OWNER` straight back, before the page ever renders. |
| Conductor's nav showed the full ~20-item admin sidebar (Fleet, Accounting, Payment Integration, Roles & Permissions, etc.) — clutter, not a security hole, since every one of those pages was still correctly backend-gated against `CONDUCTOR`. | `TenantLayout.tsx` gives `CONDUCTOR` a dedicated 3-item nav (Live Tracking, Ticketing, My Shift), same treatment as the earlier `OWNER` fix. |
| Company admin's full nav, checked as a suspected instance of the same bug — turned out **not** to be one: `COMPANY_ADMIN` is genuinely included in nearly every permission class in `permissions.py` (`IsFleetRole`, `IsOperationsRole`, `IsFinanceRole`, `IsHRRole`, `IsMaintenanceRole`, `CanManageRoutes`, `CanViewFares`), so every link really does lead to a page they're meant to use. | No fix needed — confirmed correct by design, not left unexamined. |
| A misleading "Access denied" toast fired on every page load for any non-ops role — turned out to be `GET /operator/company/` (a background header-logo/receipt-branding fetch, correctly gated to ops roles) triggering the global 403 toast even though its failure is harmless. Found in **three** separate call sites, not just the one first noticed. | New `suppressErrorToast` option on the shared API client (`services/api.ts`); applied to the three decorative call sites (`TenantLayout.tsx`, `TicketingPage.tsx`, `AccountingPage.tsx`). Left `TenantSettingsPage.tsx`'s copy untouched on purpose — that page's whole job *is* editing company info, so a 403 there is a real, meaningful message. |
| Owner Dashboard's "Revenue by Route" table showed only the bare route code (`6767`), not the route name — a real display gap, not a security issue. | `OwnerDashboardSummaryView` (`analytics/views.py`) now returns `route_name` alongside `route_code`; `MyEarningsPage.tsx` renders both. |
| A conductor issuing a ticket before opening a shift produced a confusing case (that ticket's cash never falls inside any shift's reconciliation window) — the exact scenario the "My Shift" docs above warn about. | Two-layer fix: (1) `TicketViewSet.create()` now hard-blocks conductor-role ticket issuance with no open `ConductorShift` (`400`, "Open a shift before issuing tickets."); (2) `TicketingPage.tsx` checks shift status client-side and shows a "You need to Open a Shift first before Issuing Ticket." popup with a "Got it" button on both "Verify Ticket" and "Issue Ticket — POS", instead of letting the conductor fill out the whole form first. Scoped to `CONDUCTOR`-role issuance only — self-service and generic POS/station-staff issuance are untouched. |

Also backfilled real QR codes onto the ~10 demo tickets seeded earlier for
Owner Dashboard testing — those had been created directly via a Django
shell script that bypassed `TicketSerializer.create()` (the only place a
QR actually gets generated), so their `qr_code` was empty. Confirmed real
ticket issuance (via the actual POS UI) always produces a genuine QR;
backfilled the seed data to match rather than leave it looking broken.

`npx tsc --noEmit` and `python manage.py check` clean throughout. Committed
(`c3374338`), pushed. Not yet confirmed deployed to production — see §6.

### 4.6 Self-service ticket regression + payment_reference echo fix (2026-09-23)

Found while implementing an unrelated, small fix — Yatroo's ticket-issuance
response was silently storing `payment_reference` but never returning it
in the same call, forcing a second request just to confirm it stuck.
Verifying that fix live (not just by reading the code) surfaced something
much bigger:

| Finding | Fix | Commit |
|---|---|---|
| **A real regression, not yet shipped.** §4.2's `IsTenantStaff` lockdown (applied to `TicketViewSet`/`BookingViewSet` to stop an owner seeing tenant-wide ticket data) excludes `PASSENGER` from its deny-list. But every self-service ticket, scan-to-book ticket, and group booking — Yatroo's entire ticket flow — is created via an internal system account that is always `role=PASSENGER` (`get_or_create_self_service_account`). Had this shipped as originally written, the very first real self-service purchase would have 403'd. Reproduced live against the running dev stack before fixing, not assumed from reading the code. | New `IsTicketIssuer` permission class (`backend/apps/users/permissions.py`) — allows anyone except `OWNER` to create a ticket/booking, while `list`/`retrieve` stay on `IsTenantStaff`. Wired in via a `get_permissions()` override on both viewsets so create() and list()/retrieve() can have different gates. | `c3374338` |
| `payment_reference` sent by Yatroo was stored server-side (`tenant_db.store_payment_reference`) but never echoed back in the same response — `issue_ticket()`/`issue_group_tickets()` both ended with a fresh, unmutated re-parse of Django's raw response. | Both functions now inject `payment_reference` into the response body right after storing it, and return that mutated body instead of re-parsing `resp.json()` a second time. Swagger examples updated to match. | `c3374338` |

Verified live end-to-end against the running dev stack: self-service
ticket purchase and a 2-passenger group booking both now return the exact
`payment_reference` sent. Full regression matrix re-run after the
permission fix — `OWNER` still 403 on both `list` and `create` (the
original §4.2 intent preserved), `CONDUCTOR`/`COMPANY_ADMIN` unaffected
(`list` 200, `create` 200/expected-400), self-service `PASSENGER` account
`create` now 201 where it would have been 403. `python manage.py check`
and `npx tsc --noEmit` clean. All test fixtures cleaned up.

---

## 5. Route & Group Rotation — QA fix series

Source: `/home/aadarsha/Documents/Sha-requirements/CityBus-Route-Group-Rotation-QA-Issue-Report.docx`
— 94 issues (5 Critical, 24 High, 40 Medium, 25 Low) from end-to-end Chrome
testing of the already-built Route & Group Rotation feature against
`mayurbus.citybus.com.np`. The feature itself (categories/groups/
eligibility/balance, roster/publish/driver-view, the rotation engine,
cost-based matching, depot proximity, crew-hours) predates this fix series
and is fully in this repo — commits `06e7ee50`, `9964445b`, `f0b887f7`,
`173d133f`, `89db8321`, and an earlier Slice 1.

### 5.1 Status: 55 of 94 fixed and verified live; the rest need a decision

| Severity | Total | Fixed | Still open |
|---|---|---|---|
| Critical | 5 | 5 | 0 |
| High | 24 | 21 | 3 (all "Clarify"-status) |
| Medium/Low | 65 | 29 | 36 |

Every fix across all four passes was verified against the live docker dev
stack with real API calls and, for the frontend pass, a real logged-in
browser session — not mocks — with test data cleaned up after each pass.

**Critical (`8f115c95`):**
- RG-033 — roster grid truncated to 20 duties, weekends vanish
- RG-060 — Auto-Rotate allowed on an already-published roster
- RG-063 — overlapping published periods / cross-period double-booking
- RG-074/041/042 — group delete left ghost duties / locked buses forever
- RG-081 — the rotation engine's own repair pass could assign an
  ineligible group

**High (`1179d3d4`)** — RG-051/052/053/054/055/075/043/010/011 (fleet
cascades/CRUD), RG-025/026/027/056/058/062/064/068/089 (roster/platform
validation, including one real security exposure — an unauthenticated
route/requirement leak), RG-017/009/076 (frontend — modal layout,
vehicle-form category field, empty-dropdown messaging).
**Still open: RG-080** (pinning/fixed routes — a substantial missing
feature, marked "Clarify" not "Open", needs a product decision first).

**Medium/Low (`7a98b9a4` + `270fe8ff`)** — 29 of 65 fixed across two
passes: field validation/uniqueness fixes (RG-005/012/018/048/006/016/047),
group/requirement validation (RG-049/044/077/045/030/031/028/029/032),
rotation policy bounds (RG-037/040), surge/audit-trail (RG-070/071),
malformed-input hardening (RG-057/072/090), and — in the later, purely
frontend-facing pass — pagination-flash, a combined save button, roster
date validation, group composition-rule display, inline form errors, an
idle-group roster-grid filter, clearer conflict/fair-share reporting, and
plain-language duty-cost explanations (RG-003/079/093/024/091/036/035/073/067).

**Still open (36 Medium/Low):** two categories, deliberately not touched:
1. **"Clarify"-status items** needing a product decision before any code
   is written: RG-001b/013/034/039/059/066/088, and Low RG-001/007/050.
2. **Large feature/infra work**, each really its own scoped project, not a
   fix: RG-023 (composition-rule UI), RG-078 (category multi-select UI),
   RG-085 (background job for `rotate()`), RG-087 (Nepali i18n), RG-066
   (missing endpoints), RG-082 (forbidden-pairing generation), RG-083
   (week-pattern math), RG-084 (concurrency/atomicity hardening).

Also still open, from the report's own appendix and stated-untested
sections (not "issues," but gaps the report itself flags): unbuilt spec
features (pinning/fixed routes, per-weekday+festival day types,
substitution time-windows, close-period/version-diff/reports UI, a
`fare_class` field) and untested areas (role enforcement, cross-tenant
isolation, driver mobile view, real phone/tablet layouts).

### 5.2 Notable corrections made during these passes

- `recompute_capability()` didn't filter by vehicle status at all, so
  re-triggering it on a status change (RG-052) was a no-op until the
  filter was added there too — caught by live testing, not by the
  original plan.
- RG-046, RG-065, RG-021, RG-008 were investigated and found
  already-correct / not-reproducible — no code change, not silently
  skipped.
- RG-014's stated premise (an envelope inconsistency between vehicle and
  category `create()`) is false — both already return DRF's bare default
  response identically. Excluded, not fixed.
- RG-035 and RG-073 turned out to be partly backend bugs (a message
  format, a report query), not purely frontend — fixed at the layer
  that's actually wrong.

### 5.3 Dev-environment gotcha, worth knowing before testing this feature again

Driving the tenant portal with a manually-minted JWT (instead of a real
login) has two traps: (1) `User` is a shared, not tenant-scoped, model — a
JWT must carry the *real* `user.tenant_schema` DB value, not an arbitrary
custom claim, or `TenantSchemaMiddleware` 403s; (2) the Vite dev server
(`:3002`/`:3000`) rewrites the `Host` header via its proxy's
`changeOrigin: true`, breaking tenant-schema resolution for any
tenant-scoped API call — drive browser testing through nginx
(`http://<schema>.localhost:8090`) instead.

**Code:** `backend/apps/roster/`, `backend/apps/fleet/`,
`backend/apps/platform/`, `backend/apps/users/permissions.py`,
`frontend/src/apps/tenant-portal/pages/` (Fleet, VehicleGroups, Routes,
RosterGridPage, RosterPeriodsPage, Drivers, Conductors).

---

## 6. Production deployment — operational notes

**Server access:** SSH `citybus@172.19.0.246`. Production uses
`docker-compose.prod.yml` **only** — never combine it with the base
`docker-compose.yml` (different project name, creates a stray parallel
stack with empty volumes). Repo lives at `~/short-route-bus`, but the
compose files themselves are one level down at `~/short-route-bus/docker/`
(run `cd ~/short-route-bus/docker` first — same gotcha as the `.env` file
below).

**Ready to deploy, not yet confirmed live — commit `c3374338`.** Covers
§4.5's real-device testing-pass fixes and §4.6's ticket-issuance
regression fix. No new migrations in this commit — a straight rebuild,
no `migrate_schemas` step needed:

```bash
ssh citybus@172.19.0.246
cd ~/short-route-bus && git pull
cd ~/short-route-bus/docker
docker compose -f docker-compose.prod.yml build django fastapi frontend
docker compose -f docker-compose.prod.yml up -d django fastapi frontend
docker compose -f docker-compose.prod.yml restart nginx
```

Then smoke-test from an external client (not the server itself, per
gotcha #4 below):

```bash
curl -w "\nHTTP_STATUS:%{http_code}\n" https://citybus.com.np/
curl -w "\nHTTP_STATUS:%{http_code}\n" https://mobile-api.citybus.com.np/api/openapi.json
```

Both should return `HTTP_STATUS:200`; a `502` on either means nginx
didn't pick up the rebuilt containers — re-run the `restart nginx` step.

**2026-09-21 deploy — confirmed live.** Everything through commit
`da4a7128` (65 files, 10 new migrations across `fleet`/`platform`/`staff`/
`ticketing`/`users`) is now running in production — this closed a real gap
where the server had been stuck on commit `419aa6a5` for a while, meaning
most of this handover's work (Owner Dashboard, conductor cash shifts,
NamastePay checkout, group booking fixes, ticket history, and the owner
access lockdown) had been built and verified in dev but never actually
shipped. Verified via `curl` from an external client (not the server
itself, per gotcha #4 below) against both the frontend (200, real HTML)
and a live API endpoint (200, real route data) — not just "the build
didn't error."

**New gotcha hit during this deploy — broken outbound network (DNS +
Path MTU), not a code or Docker problem:** `git pull` and the Docker image
build both failed with DNS-resolution timeouts (`Could not resolve host:
github.com`, then `registry-1.docker.io` timing out through the local
resolver). Diagnosis: `ping 8.8.8.8` showed 100% packet loss, and a raw
`curl` to `1.1.1.1:443` connected at the TCP level but hung forever right
after the TLS `Client Hello` — the classic signature of a **Path MTU
Discovery blackhole** (small packets get through, larger ones get silently
dropped because ICMP "fragmentation needed" replies aren't getting back,
likely due to the VM sitting behind a hypervisor/network layer with a
smaller real MTU than the guest OS's advertised 1500). This resolved
itself before a permanent fix (lowering the `ens160` interface MTU, or
TCP MSS clamping) was actually needed — but if `git pull` or an image
build ever hangs on this server again with DNS errors, check `ping
8.8.8.8` and a raw `curl -v https://1.1.1.1` first before assuming it's a
GitHub/Docker Hub outage.

**Real gotchas hit and fixed this project, worth knowing before touching
this server again:**

1. **`docker compose` reads `.env` from the invocation directory**, not the
   repo root — the real file is `~/short-route-bus/docker/.env`, not
   `~/short-route-bus/.env` (which is a near-empty, unused decoy).
2. **A literal `$` in a `.env` value gets partially eaten** — compose treats
   `$word` as variable interpolation. Any secret containing `$` must have
   every `$` doubled (`$$`) in the file, or it silently truncates. Verify
   any secret placed there by comparing its length inside the running
   container (`len(os.environ[...])`) against the real value — never by
   eyeballing the file.
3. **After rebuilding `django` and/or `fastapi`, nginx needs a restart** —
   `docker compose -f docker-compose.prod.yml restart nginx` — or it keeps
   pointing at the old (now-dead) container IPs and returns `502` for
   everything. Always smoke-test post-deploy with
   `curl -w "\nHTTP_STATUS:%{http_code}\n"`, not just by parsing JSON, so a
   502 is obvious immediately instead of read as a confusing empty response.
4. **The server frequently can't reach its own public domain from itself**
   (a routing/DNS quirk, not a real outage) — `curl` to
   `https://citybus.com.np` run *from the server* often hangs or times out
   even when the app is completely healthy. Always verify from an actual
   external client (a laptop, or `curl -H "Host: <domain>" https://localhost/...`
   on the server, which bypasses the issue) before concluding anything is
   actually down.
5. **Adding a new column that a raw-SQL (non-Django-ORM) insert might
   omit needs a real Postgres-level `DEFAULT`, not just Django's
   `default=""`** — Django's field default is ORM-level only on this
   Django version (4.2; `db_default` needs Django 5). Hit this for real
   with `User.partner` (a raw SQL insert in `tenant_db.py`'s self-service
   account bootstrap omitted it, causing a `NotNullViolation` in
   production). Check this every time a new required-ish column is added
   to a table anything outside Django might insert into directly.

**Verifying a deploy for real:** every feature in this handover was proven
against a live dev stack (real Postgres, real Django, real cross-tenant
queries — not mocks) *and*, for the Yatroo/NamastePay work, against
production with real requests before being called done. Mocked unit tests
alone missed at least three of the real bugs listed in §2.1 — and the
frontend role-list bug in §4.1 was found only by an actual browser login,
not any API-level test. Keep doing both.

---

## 7. Documents already sent to / prepared for Yatroo

All of the following are **intentionally untracked in git** (never
committed, never deployed to the server) — they're deliverables to hand
directly to Yatroo (email/Slack/Drive), not repository artifacts:

- `docs/CityBus_Federated_Login_Confirmation_Request.docx` — the original
  ask for their signature-format confirmation, real secret, and timeline.
  **Resolved** — they responded, secret is live.
- `docs/CityBus_Federated_Login_Test_Ready.docx` — superseded by the
  Master API Reference doc below (federated-login section folded in).
- `docs/CityBus_Master_API_Reference_for_Yatroo.docx` — the current
  comprehensive reference, self-contained, covers every endpoint.
- `docs/CityBus_Master_API_Recent_Changes.docx` — short changelog of the
  §2.2/§2.4 items above, meant to be sent alongside or instead of the full
  reference when Yatroo just needs "what changed."
- `docs/KVBMS_Master_API_Test_Data.docx` — internal QA field-by-field test
  data (real test credentials — **never send this one to Yatroo**).
- `docs/KVBMS_Fare_Management_Guide.docx` — internal fare-config reference.
- `docs/postman/KVBMS_Master_API_for_Yatroo.postman_collection.json` —
  sanitized Postman collection, safe to send externally (git-tracked).
- `docs/postman/KVBMS_Master_API.postman_collection.json` — internal
  version with real QA credentials (git-tracked, but not for Yatroo).
- `docs/CityBus_Team_Implementation_Guide_Status_Update.docx` — a formal
  status update on the Team Implementation Guide's Phase 1 (§4), covering
  what shipped and the two open asks (§3.3's fare rates, §3.6's payment-
  timing decision). Ready to send to the Shangrila Dev Team as-is.
- `docs/Yatroo_NamastePay_Gap_Analysis_Layman.txt` — plain-language
  breakdown of §2.5's gap analysis (the Partner/Subscriber App model),
  built/half-built/not-built, in a format easy to paste into an email or
  message.

**As of this handover, Yatroo has not yet been sent the two Master-API-gap
documents** (Reference / Recent Changes) — that's the next real-world
action item, on the human side, not a code task. The ticket-history and
group-booking fixes in §4.1 postdate the Reference doc's last draft and
aren't reflected in it yet — worth a note to Yatroo if/when they start
consuming `GET /tickets/my/`'s new fields (`booking_id`/`bus_number`/
`route_code`/`route_name`) or per-passenger destinations on group bookings.
Also still pending: a reply to Yatroo's own 2026-09-01 complaint about a
missing ticket API and slow fares (§2.6) — the ticket-API claim is
confirmed false and a ready-to-send reply message has been drafted for
the user, but hasn't been confirmed sent yet.

---

## 8. Where things live (quick reference)

| What | Where |
|---|---|
| Federated-login endpoint | `backend/fastapi_services/partner_api/router.py` |
| Partner account provisioning (Django) | `backend/apps/users/views.py` → `PartnerProvisionView` |
| Master API endpoints (routes/stops/fares/tickets) | `backend/fastapi_services/public_api/router.py` |
| Data access layer (raw SQL, cross-tenant fan-out) | `backend/fastapi_services/public_api/tenant_db.py` |
| Route model (incl. `description` field) | `backend/apps/platform/models.py` |
| NamastePay checkout + lookup API | `backend/apps/ticketing/`, `backend/fastapi_services/namastepay_api/` |
| Bus Owner entity + dashboard | `backend/apps/fleet/models.py` (`Owner`), `backend/apps/analytics/views.py` (`OwnerDashboardSummaryView`/`OwnerDashboardTrendView`), `frontend/.../pages/OwnersPage.tsx`, `MyEarningsPage.tsx` |
| Ticket history enrichment (bus/route/booking) | `backend/fastapi_services/public_api/tenant_db.py` (`enrich_booking_and_vehicle`/`enrich_route_names`) |
| Owner-role access lockdown (`IsTenantStaff`) | `backend/apps/users/permissions.py`; applied in `backend/apps/ticketing/views.py` (`TicketViewSet`/`BookingViewSet`), `backend/apps/staff/views.py` (`ConductorShiftViewSet`), `backend/apps/scheduling/views.py` (`LivePositionsView`/`PlaybackView`); nav scoping in `frontend/.../components/TenantLayout.tsx`, redirect in `frontend/src/hooks/useAuth.ts` |
| ISSUED/PAID ticket scaffolding | `backend/apps/ticketing/models.py` (`Ticket.paid_at`), set in `serializers.py`'s two ticket-creation paths, guarded in `backend/apps/accounting/signals.py` and `TicketVerifySerializer` |
| `child_fare` bulk fare-entry fix | `backend/apps/platform/views.py` (`FareMatrixViewSet.bulk_import`/`.generate_from_formula`) |
| Owner route guard (redirect away from anything but My Earnings) | `frontend/src/apps/tenant-portal/TenantApp.tsx` |
| Conductor nav scoping | `frontend/src/apps/tenant-portal/components/TenantLayout.tsx` |
| Suppressible error toast (`suppressErrorToast`) | `frontend/src/services/api.ts`; applied in `TenantLayout.tsx`, `TicketingPage.tsx`, `AccountingPage.tsx` |
| Revenue-by-route name display | `backend/apps/analytics/views.py` (`OwnerDashboardSummaryView`), `frontend/.../services/ownerService.ts`, `MyEarningsPage.tsx` |
| Conductor must-have-open-shift requirement | `backend/apps/ticketing/views.py` (`TicketViewSet.create()`, hard block), `frontend/.../pages/TicketingPage.tsx` (client-side popup) |
| Ticket-create permission for the self-service system account (`IsTicketIssuer`) | `backend/apps/users/permissions.py`; wired via `get_permissions()` override in `backend/apps/ticketing/views.py` (`TicketViewSet`/`BookingViewSet`) |
| `payment_reference` echoed back in the ticket-issuance response | `backend/fastapi_services/public_api/router.py` (`issue_ticket()`/`issue_group_tickets()`) |
| Local-dev demo accounts (persistent, for manual testing) | `demo.owner@kvbms.local`, `demo.admin@kvbms.local`, `demo.conductor@kvbms.local` — all `DemoX@2026`, tenant `mayurbus` |
| Route & Group Rotation — fleet/roster/rotation | `backend/apps/fleet/`, `backend/apps/roster/`, `backend/apps/platform/` |
| Route & Group Rotation — tenant-portal UI | `frontend/src/apps/tenant-portal/pages/` |
| Tests | `tests/backend/test_partner_api/`, `tests/backend/test_public_api/` |
| Full Master API reference (internal, git-tracked) | `docs/API.md` |
| This project's own status history (now partly stale) | `docs/YATROO_INTEGRATION_STATUS.md` |
| Auth-gap deep-dive (now resolved, kept for history) | `docs/YATROO_AUTH_GAP.md` |

---

## 9. What's genuinely still open, across all four workstreams

**Yatroo:**
- Yatroo hasn't been sent the Reference/Recent-Changes docs yet (§7), and
  those docs now trail §4.1's fixes by a few days.
- Reply to Yatroo's 2026-09-01 complaint (§2.6) still needs to actually be
  sent — a drafted response is ready, clarifying the ticket API does exist
  and asking for specifics to investigate the fare-speed claim.
- The Namaste Pay "Partner/Subscriber App" per-owner-wallet model (§2.5)
  is mostly not built — genuinely blocked on Namaste Pay granting Partner
  App access (per-owner Agent accounts) and their static QR/Subscriber API
  docs, not on engineering time.
- Revenue settlement/payout automation — not built, out of scope from the
  start (needs real banking/payment-gateway infrastructure). See
  `docs/YATROO_INTEGRATION_STATUS.md` §7 for the interim manual-
  reconciliation path, still the current recommendation.
- Live vehicle tracking / real-time ETA — not built, GPS integration was
  excluded from this phase's scope from the start. Also the reason §2.5's
  "which company's bus is arriving when" can only be a rough count today,
  not real arrival times.
- No response yet from Yatroo on the Master-API-gap work — nothing to do
  until they test and report back.

**NamastePay payment system (§3.2):**
- CB5 (QR format) and CB10 (owner dashboard settlement split) blocked on
  NamastePay confirming their QR content format and CityBus choosing a
  cash-settlement model — both need an external/product decision, not
  code.
- CB8's remainder (conductor wallet identity) is blocked on the same
  cash-settlement decision.

**Team Implementation Guide (§4.4):**
- The ticket-state-machine item needs an actual team decision on payment-
  before-or-after-issuance before any code is written — the `ISSUED`/`PAID`
  timestamp scaffolding it asks for is now built (§4.3), so this no
  longer blocks a future rework, but the actual decision is still not
  code the team can start today.
- Fare rounding rule — unconfirmed, and confirmed this session to not
  block anything: there's no live percentage-discount computation
  anywhere in the codebase for it to apply to yet.
- Phase 2/3 items are the same blocked list as CB5/CB8/CB10 above; this
  doc doesn't add anything new there.
- §4.5's testing-pass fixes (owner route guard, conductor nav, toast
  fixes, revenue-by-route name, shift-required ticket issuance) and
  §4.6's regression/payment_reference fixes are committed and pushed
  (`c3374338`) but **not yet confirmed deployed** — deploy commands are
  in §6, same sequence used for `ef413128`.

**Also still open, unrelated to any specific doc:** whether one owner's
buses can span more than one tenant (§3.7's own open item — a business
decision, not an external dependency; the dashboard currently only
aggregates within one tenant, and could be told to answer this today if
CityBus knows the answer).

**Route & Group Rotation (§5.1):**
- RG-080 and 39 Medium/Low items need a product "Clarify" decision or
  standalone scoping before any fix is written — see §5.1 for the full
  breakdown by category.
- Untested areas the QA report itself flags (role enforcement,
  cross-tenant isolation, driver mobile view, real device layouts) still
  need a dedicated pass.
