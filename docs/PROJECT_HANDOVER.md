# CityBus / KVBMS — Project Handover

**Purpose:** current, single source of truth for anyone picking this project
up — what's built, what's deployed, how to operate it, and what's still
open, across six active workstreams (the Yatroo integration, the
NamastePay payment system, the CityBus Team Implementation Guide gaps, the
Route & Group Rotation QA fix series, the Pokhara tenant QA fix series, and
Owner accounts / login security & form UX) plus current production
deployment status.

**Last updated:** 2026-09-27

---

## 1. Executive summary

| Workstream | Status |
|---|---|
| **Yatroo integration** (§2, §13.1–13.2) | Feature-complete. A partner-reported complaint (no ticket API, slow fares) was investigated and found factually incorrect on the ticket-API claim; the fare-speed claim has no visible code cause. A newer Namaste Pay "Partner/Subscriber App" integration model was also analyzed against the codebase — mostly not built yet (§2.5). New this session (§13.1): the "validate-then-pay" reservation flow for a Yatroo passenger's self-service ticket — reserve → conductor scans/accepts → merchant QR → paid ticket, mirroring the walk-in flow's own payment-before-ticket rule. |
| **NamastePay payment system** (§3) | 6 of 10 spec items (CB1–CB4, CB6, CB9) done and committed. **CB7 (conductor cash-shift ledger) was built, then fully removed by explicit request** (§3.1.1) — no shift tracking exists anywhere in the app today. 3 items (CB5, CB8's remainder, CB10) are blocked on NamastePay/product decisions, not code work; CB8's own remaining half no longer has anything to fall back on now that CB7 is gone. |
| **Team Implementation Guide gaps** (§4) | All 3 original code-fixable gaps closed (per-passenger destinations, Bus Owner Dashboard, ticket history API), plus a follow-up pass that found and closed a real access-control gap — the Owner Dashboard's own endpoints and nav had no real role scoping. Also added: ISSUED/PAID timestamp scaffolding for §3.6, a `child_fare` bulk-tooling fix for §3.3, (§4.5) a full real-device testing pass across owner/conductor/admin that found and fixed six more UX/access gaps — one of which, a hard requirement that a conductor open a shift before issuing tickets, was **itself removed again days later** along with the rest of shift tracking (§3.1.1) — and (§4.6) a real regression that same lockdown introduced — self-service/group ticket purchase would have 403'd in production — caught live and fixed before shipping. 2 items (§3.6's actual state machine, §3.3's real concession rates) still need a team decision or external numbers, not code. |
| **Route & Group Rotation QA report** (§5) | All 94 issues triaged; every issue that was a real, scopeable bug is fixed and verified live (Critical 5/5, High 21/24, Medium/Low 29/65). The rest (39 issues) are explicitly "Clarify"-status or large standalone features needing a product decision first — not oversights. |
| **Pokhara tenant QA report** (§6) | All 11 issues fixed and verified live against a real second tenant. Headline finding: Route/Stop weren't filtered by tenant assignment at all — a cross-tenant data leak that had already **corrupted** a tenant's own roster data (real `Duty` rows written against another tenant's routes), not just a display bug. Also closed: two stuck-submit-button/silent-400 form bugs, a genuinely missing "create a login for this conductor/driver" flow (nothing in the product ever built it), a dead-looking-but-actually-guarded button, mislabeled nav links, unseeded tenant branding, and a stray-waypoint map bug. |
| **Owner accounts / login security & form UX** (§7) | Owner `create-login` + forced temp-password change flow built, verified live end-to-end, and committed. Also fixed in the same pass: a broken `changePassword` endpoint call (wrong URL/field name), admin-password fields rendering in plaintext (`type="text"`), and a password-strength mismatch between frontend (8 chars) and backend (10 chars) validation. |
| **Production deployment** (§8, §13.5) | **Updated 2026-10-01 — the new server is live.** The Ncell ISP port-filter blocker in §8.1 is resolved (80/443 confirmed open from outside) and DNS for the bare `citybus.com.np` domain now correctly points to `36.253.137.147`. Everything through commit `ef8ae9a8` (§13's whole session) is deployed and verified there — see §13.5 for the deploy log and a newly-found gotcha (the "public" tenant/domain was never bootstrapped on this fresh DB, §13.6). **`mobile-api.citybus.com.np`** — the actual hostname Yatroo's integration is documented against — **still points to a third, unrelated, old-code server** and needs a DNS fix that isn't doable from either server; see §13.7. The original server (172.19.0.246) is unchanged from before and still has zero tenants provisioned. |
| **Dispatch / Fleet / Maintenance** (§12) | New this session (2026-09-27): driver/conductor double-booking prevention, a conductor picker + fixed name resolution on Dispatch, a Copy Schedule tool (repeat a day's dispatch), a manual End Shift action, resolved bus/route/driver/conductor on Dispatch Logs with a route filter, a fabricated-data bug fix on Add Vehicle's insurance side effect, a real Available toggle on Fleet tied to vehicle status, and a two-way integration between Fleet's toggle and Maintenance scheduling (scheduling service marks a vehicle unavailable; completing or force-overriding it marks it available again). Deployed live as part of §13.5. |
| **Yatroo reconciliation + API docs cleanup** (§13) | New this session (2026-09-30/10-01): a conductor/bus revenue reconciliation report (daily/weekly/yearly, cash vs. online), a full pass fixing the Public API's Swagger documentation (7 endpoints had no request schema at all, 3 had a subtler bug hiding the example value, the whole API was one unnavigable flat list), and the first real production deployment since §8.1 — including two real bugs found only by testing against the live server (see §13.6) and a still-open DNS blocker (§13.7). Also traced the Live Tracking map showing blank in every environment to a third-party (Baato) account quota limit, not a code or config bug (§13.8). |

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
see the nginx note in §8).

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
| Per-company/per-vehicle route availability with times | ⚠️ Partial | `GET /routes/{id}/` returns only an aggregate `total_buses` count across every operator on that route — the per-schema counts are computed internally then discarded, never broken out per company. No live arrival times (GPS tracking is out of scope, §11). |
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
  §9, the Reference doc still hasn't been sent to them.
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
| CB7 — conductor shift / cash ledger | Built, then removed entirely — see §3.1.1 | `b2598ec3`, removed `57f0efbe` |
| CB3 — child concession fare | | `5122eeda` |
| CB9 — checkout confirmation flow | Built as a redirect-confirmation flow instead of a signed webhook, since NamastePay's real API (confirmed against their docs) has no signed webhook — only a browser redirect + server-side `enquire_checkout()` re-verification | `ceb0c542` |
| CB4 — ticket lookup API for NamastePay's pay-by-ID screen (P4) | Required extending CB9's `NamastePayCheckout` to also cover conductor-initiated walk-in checkouts. New module `backend/fastapi_services/namastepay_api/`, gated by `NAMASTEPAY_LOOKUP_SECRET` | `42397f7e` |

### 3.1.1 CB7 removed entirely, by explicit request (2026-09-23)

Conductor shift tracking — the `ConductorShift` model, its `/operator/shifts/*`
API (open/close/current), the "My Shift" nav item and page, and the hard
block that required an open shift before a conductor could issue a ticket
(added a day earlier in §4.5) — was **all removed**, end to end, per a
direct instruction to rip out shift tracking from the conductor side
entirely, not just the enforcement. Commit `57f0efbe`.

The feature was unusually self-contained: `ConductorShift` had no real FK
relations to or from it anywhere (every join was a loose UUID filter, this
codebase's established pattern), and no tests referenced it. The one real
downstream consumer was the Owner Dashboard's `cash_collected` figure
(§4.1), which aggregated `ConductorShift.system_cash_total` — that's now
computed directly from `Ticket.payment_method="CASH"` instead (the exact
same value the view already computed locally for its cash-vs-online split;
confirmed identical in a live check before and after).

**A migration to drop `staff_conductorshift`
(`0008_delete_conductorshift.py`) had already been generated and applied
against the dev DB by a separate, concurrent process before this commit** —
this change just brought the application code in line with that
already-dropped state. Not yet deployed to production; the only UI path
that could ever create a real shift row (§4.5's nav item) was itself never
deployed, so production almost certainly has zero real `ConductorShift`
rows to lose.

**Practical effect on everything else in this doc**: CB8's "remaining
half" note below no longer has a CB7 half to be "mostly covered by" —
CB8 is now entirely blocked, same as CB5/CB10. Any earlier mention in this
document of a conductor's shift, cash session, or `ConductorShift` refers
to a feature that no longer exists in the code — kept for history, not as
current status.

### 3.2 Blocked — waiting on external input, not code work

- **CB8** (conductor↔vehicle↔shift linkage) — was mostly covered by CB7's
  `ConductorShift.vehicle_id`/`conductor_user_id`; now that CB7 is removed
  (§3.1.1), this is unaddressed again. Blocked on the same open item as
  CB10/CB5 either way — the conductor's own NamastePay wallet identity
  question only matters once a cash-settlement model is picked.
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
| **(Superseded — see §3.1.1)** A conductor issuing a ticket before opening a shift produced a confusing case (that ticket's cash never falls inside any shift's reconciliation window) — the exact scenario the "My Shift" docs above warn about. | Two-layer fix at the time: (1) `TicketViewSet.create()` hard-blocked conductor-role ticket issuance with no open `ConductorShift` (`400`, "Open a shift before issuing tickets."); (2) `TicketingPage.tsx` checked shift status client-side with a "You need to Open a Shift first" popup. **This entire fix, and the shift feature it protected, was removed two days later** (`57f0efbe`, §3.1.1) per explicit request — kept here only as a historical record of what this pass found and fixed at the time. |

Also backfilled real QR codes onto the ~10 demo tickets seeded earlier for
Owner Dashboard testing — those had been created directly via a Django
shell script that bypassed `TicketSerializer.create()` (the only place a
QR actually gets generated), so their `qr_code` was empty. Confirmed real
ticket issuance (via the actual POS UI) always produces a genuine QR;
backfilled the seed data to match rather than leave it looking broken.

`npx tsc --noEmit` and `python manage.py check` clean throughout. Committed
(`c3374338`), pushed. Not yet confirmed deployed to production — see §8.

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

## 6. Pokhara tenant — QA fix series (11 issues, all fixed)

Source: `/home/aadarsha/Documents/Sha-requirements/KVBMS-Pokhara-QA-Report.docx`
— an end-to-end acceptance test of the `pokharayatayat.citybus.com.np`
tenant performed as a first-time tenant admin, against **live
production**. 2 Critical, 5 High, 3 Medium, plus a validation-consistency
review. All 11 real issues fixed and verified live; commits `1997e392`
(Critical), `6e230f3b` (High), `57994545` (Medium).

### 6.1 Critical — cross-tenant data leak, and it had already corrupted data

**Root cause, not a schema-isolation bug.** `Route`/`Stop` correctly live
in `SHARED_APPS` — routes are a genuinely platform-wide concept, with
multiple transport companies assigned to the same physical route via
`RouteAssignment` (a real `route`↔`tenant` join table). Since
`TenantSchemaMiddleware` only switches the Postgres schema for
`TENANT_APPS` tables, a plain `Route.objects.filter(...)` was never scoped
by tenant — isolation has to come from an explicit `RouteAssignment`
filter, which was simply missing at 4 query sites, cascading into 6
screens (Routes list, Scheduler/Ticketing's route dropdowns, Vehicle
Groups' balance/eligibility, and Roster Generate). The correct pattern
already existed one class away in the same file
(`FareMatrixViewSet.get_queryset()`) — reused verbatim rather than
inventing a new mechanism.

**The severe part**: Roster Periods → Generate had already **written
real, persisted `Duty` rows** into Pokhara's own roster referencing
mayurbus's routes — a passive information leak that had become active
data corruption the first time a real tenant touched scheduling. Fixed at
the write site (`RosterPeriodViewSet._generate_duties()`) along with the
3 read sites. **Any tenant that ran Roster Generate before this fix may
already have phantom `Duty` rows in the live production database** — a
read-only audit query (find `Duty` rows whose `route_id` isn't in that
tenant's own `RouteAssignment` set) is ready to hand over, but cleaning up
already-corrupted production rows needs explicit go-ahead before it's run
— not something to do as part of routine fix work.

Verified against a real second tenant (`pokhara`, genuinely
auto-provisioned through django-tenants, not a shortcut): a pokhara-owned
route and roster no longer reference mayurbus's data at all, and
generating a roster for pokhara now produces duties against its own route
only — the exact repro from the report.

### 6.2 High — two form bugs, a dead-looking button, and a missing feature

- **Add Vehicle / Add Driver — stuck submit button after one failed
  attempt.** `setError()` was being called for any field a 400 landed on,
  including several with no client-side validation rule — a manually-set
  error on a rule-less field is never re-validated/cleared by react-hook-
  form, permanently blocking resubmission on the same open modal. Live-
  reproduced the report's "silent 400 on fully valid data" first: a
  complete, valid vehicle submits cleanly (201) through the real API, so
  that symptom was this same stuck-button bug amplifying whatever the
  first attempt's real error was, not a separate hidden validation
  mismatch. Fixed by only calling `setError()` for fields that actually
  have a client rule.
- **Add Driver — `experience_years` silent 400.** A
  `PositiveSmallIntegerField` with no `null=True`; the create form sent
  `""` when left blank (no asterisk, nothing stopped a real admin from
  skipping it). Now sends `0`, matching the model's own default — the
  edit path already did this correctly, only create had the gap.
- **Payment Integration "Test Connection" — looked dead, was actually a
  correctly-guarded disabled button.** The `outline` Button variant had no
  `disabled:` CSS at all, so a real, working guard looked exactly like a
  dead, fully-interactive control. Fixed the variant's styling (benefits
  every other use of `outline` too) and added a persistent hint line, not
  just a hover-only tooltip.
- **Vehicle Group Conductor/Driver pickers — real, active records never
  selectable.** Not a naming split ("Collector" and "Conductor" are the
  same model) and not an API mismatch — the picker correctly filters to
  records with a linked `user_id`, and `GroupConductorAssignment`/
  `GroupDriverAssignment` genuinely require one (it's what lets that
  person's own future login resolve "my group"). Nothing in the product
  ever created that login — confirmed via `UserSerializer`'s own
  `read_only_fields` comment, which names "driver/conductor login
  creation" as an anticipated flow that was apparently never built. Built
  it: a `create-login` action on `ConductorViewSet`/`DriverViewSet`
  (reusing the exact `User`-creation pattern already proven in tenant
  onboarding), plus a "Create Login" UI action shown only when a record
  has no linked login yet. Verified end to end: create login → picker
  shows the record → a real `GroupDriverAssignment` was created.

### 6.3 Medium — labels, seeding, and a stray click

- **Sidebar "Dashboard"/"Scheduler" linked to `/tenant/live-tracking`/
  `/tenant/dispatch`** — real, working pages, just mislabeled, while the
  URLs the labels implied (`/tenant/dashboard`, `/tenant/scheduler`)
  render blank. Relabeled to "Live Tracking"/"Dispatch" rather than
  building two new pages under a "bug fix" banner.
- **New tenants showed placeholder "Default Company" branding** — the
  real name/contact info was already collected at Super Admin onboarding
  time but never propagated; `BusCompanyView.get_object()` only ever
  lazily created that row with hardcoded defaults. Tenant onboarding now
  seeds it for real, alongside the existing RBAC/Chart-of-Accounts
  seeding.
- **Add Route — a stray waypoint could be added silently** when clicking
  the map just to dismiss the still-open Route Start/End search dropdown.
  `PlaceSearchInput` now reports its open state to the parent; a map
  click while a dropdown is open just closes it, no waypoint added.

### 6.4 Dev-environment note

Same tenant-portal testing gotchas as §5.3 apply here too (mint a JWT
from the real user's actual `tenant_schema`, drive the browser through
nginx `:8090`). One addition: `Tenant.delete()` does **not** drop the
Postgres schema (`auto_drop_schema` is deliberately off) — a deleted test
tenant leaves an orphaned schema behind unless it's dropped manually.

**Code:** `backend/apps/platform/views.py`, `backend/apps/fleet/views.py`,
`backend/apps/roster/views.py`, `backend/apps/staff/views.py`,
`backend/apps/tenants/serializers.py`,
`frontend/src/apps/tenant-portal/pages/` (Fleet, Drivers, Conductors,
PaymentIntegrationPage, Routes), `frontend/src/components/shared/`
(Button, PlaceSearchInput), `frontend/src/i18n/`.

---

## 7. Owner accounts / login security & form UX

A Bus Owner created via `OwnersPage.tsx` had no way to actually get a login
short of a tenant admin manually creating a `User` in Django admin and
pasting its UUID into a raw "Login User ID" field — the same gap `Driver`/
`Conductor` already had a `create-login` action for. Fixing that surfaced a
cluster of related, smaller gaps in the same area, all closed together:

| Finding | Fix |
|---|---|
| Owner had no `create-login` action, unlike Driver/Conductor. | New `POST /fleet/owners/{id}/create-login/` (`OwnerViewSet`), mirroring `ConductorViewSet.create_login()` exactly — creates a `role=OWNER` `User`, links `Owner.user_id`, and stores the tenant-chosen password as `Owner.temp_password` (new `EncryptedCharField`, same type as `NamastePayConfig.api_key`) so the tenant admin can view it (eye toggle) until the owner signs in and replaces it. |
| Driver/Conductor/Owner/Tenant-admin `create-login`/create-account paths read straight from `request.data` and called `set_password()` directly — no email-format or password-strength check anywhere, unlike the normal registration path. | New shared `backend/apps/users/validators.py` (`validate_email_or_message`, `validate_password_or_messages`, `ComplexityPasswordValidator` registered in `AUTH_PASSWORD_VALIDATORS`) — applied uniformly across `DriverViewSet`/`ConductorViewSet`/`OwnerViewSet.create_login()` and `TenantViewSet`'s admin-creation action. |
| An owner logging in with a tenant-issued temp password had no forced path to set their own — they'd land straight on My Earnings still using it. | `CustomTokenObtainPairSerializer` returns `must_change_password` (true whenever `Owner.temp_password` is still set); `TenantApp.tsx`'s route guard redirects there before anything else; new `SetNewPasswordPage.tsx` reuses the existing change-password endpoint (`old_password` = the temp password); `ChangePasswordView` clears `Owner.temp_password` on success. |
| **Real, separate bug found in the same area:** `authService.changePassword()` was calling `/auth/password/change/` (doesn't exist) with a `confirm_password` field — the actual endpoint is `/auth/change-password/` and the actual field is `new_password_confirm`. Every "change password" attempt anywhere in the app (`SettingsPage.tsx`, `TenantSettingsPage.tsx`) would have 404'd or failed validation before this fix. | Corrected the URL and field mapping in `authService.ts`. |
| **Real security issue found in the same area:** the admin-password inputs on `TenantsPage.tsx`/`TenantDetailPage.tsx` (super-admin creating a tenant + its admin login) were `type="text"` — a password typed there was fully visible on screen and could be captured by a screen-share, unlike every other password field in the app. | Changed to `type="password"`, and the shared `Input` component (`components/shared/Input.tsx`) now gives **every** password field a show/hide eye toggle for free (unless the caller already supplies its own `rightAddon`), so this class of field never regresses back to plaintext-only again. |
| **Found during this review, fixed before committing:** the new `isValidPassword()`/`PASSWORD_VALIDATION_MESSAGE` (`utils/password.ts`) and every "must be at least 8 characters" hint (English *and* Nepali i18n strings, plus a raw placeholder on `TenantDetailPage.tsx`) said **8**, but the backend's actual `MinimumLengthValidator` requires **10** (`base.py`, unchanged) — a real user could pass every client-side check with an 8- or 9-character password and then get a confusing server-side 400. Fixed to 10 everywhere, both languages. | `utils/password.ts`, `i18n/en/platform.json`, `i18n/ne/platform.json`, `TenantDetailPage.tsx`. |
| Drivers' "View" modal was a single long vertical scroll through five sections; the new step-based "Add Driver" wizard (gated — each step's required fields must pass before "Next" unlocks the next tab) made that inconsistency more visible. | View modal rebuilt as a horizontal pill-tab layout matching the Add wizard's visual language, but **ungated** (every tab clickable in any order at any time, since it's read-only) — same pattern applied to Owners' new View modal. Add Driver wizard also now advances on Enter within a non-final step instead of submitting early. |

Verified end-to-end (not just read): live-tested `create-login` → login
returns `must_change_password: true` → `change-password` with the temp
password succeeds and clears `Owner.temp_password` — all three steps
confirmed against the real running dev stack, fixture cleaned up
afterward. `npx tsc --noEmit` and `python manage.py check` clean. Migration
(`fleet.0012_owner_temp_password`) already applied to the dev DB.

---

## 8. Production deployment — operational notes

**There are now two servers.** Original: SSH `citybus@172.19.0.246`. New
(stood up 2026-09-26): SSH `ubuntu@36.253.137.147`. Both use
`docker-compose.prod.yml` **only** — never combine it with the base
`docker-compose.yml` (different project name, creates a stray parallel
stack with empty volumes). Repo lives at `~/short-route-bus`, but the
compose files themselves are one level down at `~/short-route-bus/docker/`
(run `cd ~/short-route-bus/docker` first — same gotcha as the `.env` file
below).

### 8.1 New server (36.253.137.147) — built and verified, blocked on ISP port filtering (2026-09-26)

**Status update, 2026-10-01: this is resolved — see §13.5.** Both blockers
described below (the ISP port filter and the DNS pointing at the wrong IP)
were fixed by the time this session started; kept as-written below since
it's an accurate record of the investigation, not because it's still true.

**Why a second server:** the user was handed a new, empty box
(`ubuntu@36.253.137.147`) and asked to deploy there. Before copying
anything over, the original server's database was checked directly
(`psql ... -c "SELECT schema_name, name FROM tenants_tenant;"`) and came
back **zero rows** — despite being referred to as "prod" throughout this
project, 172.19.0.246 has **never had a real tenant provisioned on it**.
This is a load-bearing finding for anyone continuing this deployment: there
was no real production data to lose or migrate, only the base
`public`-schema migrations and an empty app.

**What was actually done, in order:**
1. Dumped 172.19.0.246's `kvbms` database (`pg_dump -Fc`, ~200KB — confirms
   it really is just the empty public schema, no tenant schemas), archived
   its media volume and its `/etc/letsencrypt` cert directory, and copied
   its `docker/.env` — all four moved to the new server via the user's own
   laptop as a relay (`scp` old→laptop→new).
2. Installed Docker Engine + Compose plugin from the official apt repo on
   the new Ubuntu 24.04 box, cloned the repo, placed the copied `.env` at
   `docker/.env`, restored the DB dump and media volume, extracted the
   copied cert to `/etc/letsencrypt`.
3. Built and launched every service (`db`, `redis`, `django`, `fastapi`,
   `celery`, `celery-beat`, `frontend`, `nginx` — in that order, nginx last
   so it doesn't start before certs exist). `django`'s own startup
   `migrate` ran clean, applying every migration through commit `236b6b2c`
   (18 pending migrations, including all of this session's fleet/platform/
   ticketing/staff/users changes) with no errors.
4. Verified the stack actually serves correctly with
   `curl --resolve citybus.com.np:443:36.253.137.147 https://citybus.com.np/`
   (forces the right SNI/Host without needing DNS) → real `200 OK` from
   nginx, correct security headers, TLS handshake against the copied cert
   succeeded.

**Current blocker — not reachable from the public internet.** Two separate
things, both outside the server itself:
- **DNS**: `citybus.com.np` currently resolves to `103.170.75.51` — a
  *third* IP, neither old server nor new. Someone needs to update the A
  records (`citybus.com.np`, `www`, `*.citybus.com.np`) at whatever
  registrar/DNS provider manages this domain, to `36.253.137.147`.
- **ISP port filter (the real blocker)**: the new server's public IP
  belongs to **Ncell** (`AS38565`, confirmed via `ipinfo.io` — this is a
  Nepali ISP connection, not a conventional cloud VPS with a security-group
  console). `ufw` is inactive and nginx is correctly listening on
  `0.0.0.0:80`/`:443` (confirmed via `ss -tlnp`) — but from two independent
  external networks, port `22` (SSH) is reachable while `80` and `443` are
  not; a `tracepath -p 443` shows packets reaching the destination's own
  network edge (the last hop resolves as `citybus.com.np` itself) and then
  going silent — the classic signature of an ISP-side firewall silently
  dropping inbound web-port traffic, not a server misconfiguration. Also
  worth flagging: `ip addr show` reports the IP as `dynamic` (DHCP-leased),
  not confirmed static.
- **Action needed, not code**: contact Ncell support, ask them to unblock
  inbound TCP `80`/`443` on this connection and confirm whether the IP is
  (or can be made) static. Nothing further can be diagnosed or fixed from
  the server side — Docker, nginx, and the app are all confirmed correctly
  configured and working internally.

**Also note:** a large amount of feature work committed to `main` before
this deploy attempt (Route & Group Rotation P0–P3, the NamastePay
CB1/CB2/CB6/CB9 items, the Bus Owner Dashboard, Fares/Ticket Types moving
to tenant-portal, the driver/conductor citizenship-photo and
double-booking fixes, and more) is **not yet reflected elsewhere in this
handover doc** — §§2–7 above are stale relative to the actual repo state
as of `236b6b2c`. Treat `git log --oneline` as the source of truth for
what's actually built until those sections get a real rewrite.

**Ready to deploy, not yet confirmed live — through commit `57994545`.**
Covers §4.5's real-device testing-pass fixes, §4.6's ticket-issuance
regression fix (`c3374338`, no new migrations), §3.1.1's full removal
of conductor shift tracking (`57f0efbe`, **one new migration** —
`staff/migrations/0008_delete_conductorshift.py`, drops the
`staff_conductorshift` table), and all of §6's Pokhara QA fixes
(`1997e392`, `6e230f3b`, `57994545` — no new migrations, all three are
query/view/frontend changes only). No manual migrate step needed — the
`django` service's own startup command already runs `manage.py migrate`
every time it starts (`docker-compose.prod.yml`'s `command:`), so the one
pending migration applies automatically on the same `up -d django` step
used for every prior deploy; it just won't be a no-op like the previous
commit's migrate step was.

**Also now pending — §7's owner-accounts commit (`7cbf88be`)**, one more
migration on top of the above (`fleet/migrations/0012_owner_temp_password.py`,
adds `Owner.temp_password`), picked up automatically by the same `django`
startup migrate step, no separate action needed:

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

## 9. Documents already sent to / prepared for Yatroo

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

## 10. Where things live (quick reference)

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
| Owner-role access lockdown (`IsTenantStaff`) | `backend/apps/users/permissions.py`; applied in `backend/apps/ticketing/views.py` (`TicketViewSet`/`BookingViewSet`), `backend/apps/scheduling/views.py` (`LivePositionsView`/`PlaybackView`); nav scoping in `frontend/.../components/TenantLayout.tsx`, redirect in `frontend/src/hooks/useAuth.ts` |
| ISSUED/PAID ticket scaffolding | `backend/apps/ticketing/models.py` (`Ticket.paid_at`), set in `serializers.py`'s two ticket-creation paths, guarded in `backend/apps/accounting/signals.py` and `TicketVerifySerializer` |
| `child_fare` bulk fare-entry fix | `backend/apps/platform/views.py` (`FareMatrixViewSet.bulk_import`/`.generate_from_formula`) |
| Owner route guard (redirect away from anything but My Earnings) | `frontend/src/apps/tenant-portal/TenantApp.tsx` |
| Conductor nav scoping | `frontend/src/apps/tenant-portal/components/TenantLayout.tsx` |
| Suppressible error toast (`suppressErrorToast`) | `frontend/src/services/api.ts`; applied in `TenantLayout.tsx`, `TicketingPage.tsx`, `AccountingPage.tsx` |
| Revenue-by-route name display | `backend/apps/analytics/views.py` (`OwnerDashboardSummaryView`), `frontend/.../services/ownerService.ts`, `MyEarningsPage.tsx` |
| Ticket-create permission for the self-service system account (`IsTicketIssuer`) | `backend/apps/users/permissions.py`; wired via `get_permissions()` override in `backend/apps/ticketing/views.py` (`TicketViewSet`/`BookingViewSet`) |
| Conductor shift tracking (CB7) | **Removed entirely, `57f0efbe` — see §3.1.1.** No longer exists anywhere in the code. |
| `payment_reference` echoed back in the ticket-issuance response | `backend/fastapi_services/public_api/router.py` (`issue_ticket()`/`issue_group_tickets()`) |
| Local-dev demo accounts (persistent, for manual testing) | `demo.owner@kvbms.local`, `demo.admin@kvbms.local`, `demo.conductor@kvbms.local` — all `DemoX@2026`, tenant `mayurbus` |
| Route & Group Rotation — fleet/roster/rotation | `backend/apps/fleet/`, `backend/apps/roster/`, `backend/apps/platform/` |
| Route & Group Rotation — tenant-portal UI | `frontend/src/apps/tenant-portal/pages/` |
| Route/Stop tenant-scoping (`RouteAssignment` filter) | `backend/apps/platform/views.py` (`RouteViewSet.get_queryset()`), `backend/apps/fleet/views.py` (`VehicleGroupViewSet.eligibility()`/`.balance()`), `backend/apps/roster/views.py` (`RosterPeriodViewSet._generate_duties()`) |
| Conductor/Driver "create login" flow | `backend/apps/staff/views.py` (`ConductorViewSet.create_login()`/`DriverViewSet.create_login()`); UI in `frontend/.../pages/ConductorsPage.tsx`/`DriversPage.tsx` (row action) |
| New-tenant `BusCompany` seeding | `backend/apps/tenants/serializers.py` (`TenantSerializer.create()`) |
| Local-dev test tenant (persistent, real second schema) | `pokhara` / `qa.pokhara.admin@kvbms.local` — created for the Pokhara QA cross-tenant fixes, kept around for future tenant-isolation testing |
| Owner `create-login` + temp-password flow | `backend/apps/fleet/views.py` (`OwnerViewSet.create_login()`), `backend/apps/fleet/models.py` (`Owner.temp_password`), `backend/apps/users/serializers.py` (`must_change_password`), `backend/apps/users/views.py` (`ChangePasswordView` clearing it); UI in `frontend/.../pages/OwnersPage.tsx`, `frontend/.../pages/SetNewPasswordPage.tsx` |
| Shared email/password validators | `backend/apps/users/validators.py` (`validate_email_or_message`, `validate_password_or_messages`, `ComplexityPasswordValidator`); frontend equivalents `frontend/src/utils/email.ts`, `frontend/src/utils/password.ts` |
| Universal password show/hide toggle | `frontend/src/components/shared/Input.tsx` |
| Tests | `tests/backend/test_partner_api/`, `tests/backend/test_public_api/` |
| Full Master API reference (internal, git-tracked) | `docs/API.md` |
| This project's own status history (now partly stale) | `docs/YATROO_INTEGRATION_STATUS.md` |
| Auth-gap deep-dive (now resolved, kept for history) | `docs/YATROO_AUTH_GAP.md` |

---

## 11. What's genuinely still open, across all six workstreams

**Yatroo:**
- Yatroo hasn't been sent the Reference/Recent-Changes docs yet (§9), and
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
- CB8 is now entirely blocked on the same cash-settlement decision — it
  no longer has a CB7 half to fall back on, since CB7 was removed
  entirely (§3.1.1).

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
  fixes, revenue-by-route name — the shift-required ticket issuance fix
  from this same pass was itself removed again in §3.1.1, so it's no
  longer part of what's pending deploy) and §4.6's regression/
  payment_reference fixes are committed and pushed (`c3374338`) but
  **not yet confirmed deployed** — deploy commands are in §8, same
  sequence used for `ef413128`. §3.1.1's shift-removal commit
  (`57f0efbe`) and §7's owner-accounts work are also pending the same
  deploy.

**Pokhara tenant QA report (§6):** everything in §6 (all 11 issues) is
committed and pushed (`1997e392`, `6e230f3b`, `57994545`) but **not yet
confirmed deployed** — same pending-deploy batch as everything else in
this section, see §8. Also still open, not code: a read-only audit for
already-corrupted `Duty` rows in the live production database (§6.1)
needs to actually be run, and any rows it finds need explicit
confirmation before deleting anything.

**Owner accounts / login security & form UX (§7):** fully built and
verified, nothing blocked — committed and pushed but **not yet confirmed
deployed**, same pending-deploy batch, see §8.

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

---

## 12. Dispatch / Fleet / Maintenance — 2026-09-27 session

All built and verified live against the running dev stack this session, in
order. Pushed to `main` through `0ba28ac1`; **not yet deployed anywhere**
(neither 172.19.0.246 nor the new 36.253.137.147 box, which is itself
still blocked on the Ncell port issue in §8.1).

- **Driver/conductor double-booking prevention** (`cb4f905a`) —
  `dispatch.DailyAllocation` only enforced `unique_together` on
  `(date, vehicle_id)`; nothing stopped the same driver or conductor being
  allocated to two different buses the same day. Added a check to
  `create`/`update`/`reassign` on `DailyAllocationViewSet`, naming the
  conflicting vehicle in the rejection message.
- **Conductor picker + name-resolution fix on Dispatch** (`236b6b2c`) —
  the Assign Bus form and Edit modal had no conductor field at all, only
  driver. Added one, backed by the same `/operator/conductors/` source the
  Vehicle Groups picker already uses. Found and fixed a real bug in the
  same pass: `DailyAllocationSerializer.get_driver_name()` called
  `d.full_name`, a field that doesn't exist on `Driver` (only
  `full_name_en`) — it was silently falling back to the raw UUID
  everywhere a driver's name should have shown, the whole time.
- **Copy Schedule** (`2ad0a771`) — new `POST /dispatch/allocations/copy/`
  duplicates one or more allocations onto a different date (same bus/
  route/driver/conductor/shift), re-running the same conflict checks per
  row so one bad row is skipped with a reason rather than failing the
  whole batch. Frontend: a "Copy Schedule" tab with a one-click "Repeat
  Yesterday" plus a select-specific-shifts-and-copy-to-any-date flow.
- **End Shift** (`dbfedd8c`) — `DailyAllocation.Status.COMPLETED` was
  defined but never reachable from anywhere; a bus allocated today stayed
  `ACTIVE`/`PENDING` forever. New
  `POST /dispatch/allocations/{id}/end-shift/`, dispatcher-triggered
  (matches Breakdown/Reassign/Remove's own manual, nothing-automatic
  pattern) — flips status to `COMPLETED`, frees the vehicle, logs it.
- **Dispatch Logs — resolved fields + route filter** (`5a4efeec`) — the
  Logs tab showed only a truncated raw vehicle UUID and free-text notes.
  `DispatchLogSerializer` now resolves `vehicle_registration`,
  `route_name`, `driver_name`, `conductor_name` (the last two read through
  the linked `allocation`, since `DispatchLog` has no driver/conductor
  field of its own), and `GET /dispatch/logs/` gained a `route_id` filter.
  Frontend Logs tab gained a date picker (was hardcoded to today) and a
  route dropdown.
- **CI: `deploy.yml` no longer runs automatically** (`584448f5`) — it had
  failed on all 113 of its automatic runs ever (missing AWS/Docker Hub
  secrets, and a deploy path — `/opt/kvbms` — that doesn't match how this
  project is actually deployed). Switched to `workflow_dispatch` so it's
  still there as a template but doesn't show red on every push.
- **Add Vehicle — stop fabricating a `VehicleInsurance` row** (`af4b973e`)
  — `VehicleSerializer.create()` was silently creating a second insurance
  record with data the form never asks for and no page ever shows
  (`provider=""`, `coverage_amount=0`, `premium=0`) — that model has no
  viewset, no URL, no frontend usage anywhere. Removed the side effect;
  the real policy number/expiry date still save correctly via
  `VehicleDocument`, exactly as `update()` already only did.
- **Fleet "Available" column — real toggle** (`4f95a391`) —
  `is_available_for_trip` is computed (status + insurance validity +
  maintenance), not a raw field, so a toggle controls the one real,
  settable piece of it: `status` ACTIVE ↔ INACTIVE, matching what
  Dispatch's own available-bus picker already checks. Toggling a vehicle
  in some other status (Assigned, Breakdown, etc.) overwrites it, by
  design — confirmed with the user before building.
- **Fleet ↔ Maintenance integration** (`bb3e4eef`, `5af0c598`) —
  scheduling a service now sets the vehicle to `IN_MAINTENANCE`
  automatically (an existing `Vehicle.Status` choice, never actually set
  anywhere before this). Fleet's table shows an info icon next to the
  toggle ("Scheduled for {type} maintenance") whenever a pending schedule
  exists. Trying to toggle such a vehicle available opens a confirm popup
  naming the maintenance type — Cancel changes nothing, confirming calls
  `POST /fleet/vehicles/{id}/confirm-available/`, which marks the vehicle
  ACTIVE and every pending schedule `CANCELLED` (not deleted — the
  cancelled row, with an appended note recording who/when/why, is the
  audit trail; `MaintenanceScheduleViewSet`'s default list now excludes
  `CANCELLED` so it actually disappears from the Maintenance page). A new
  "Completion" column on Maintenance gives the ordinary, non-conflicting
  path: `POST /maintenance/schedules/{id}/complete/` marks a schedule
  `COMPLETED` and reactivates the vehicle — but only if nothing else is
  still pending for it (completing one of two open schedules for the same
  vehicle correctly leaves it `IN_MAINTENANCE`, verified as a real test
  case, not just assumed).

---

## 13. Yatroo reservation flow, reconciliation, API docs cleanup, and first real production deployment — 2026-09-30/10-01 session

Everything below was built and verified live against the running dev stack
(real HTTP calls end-to-end, not mocks — only the NamastePay gateway calls
themselves were mocked, since there's no real merchant key in dev), then
committed and pushed through `ef8ae9a8`. §13.5 onward covers actually
deploying this to the new server and what was found doing it for real.

### 13.1 Yatroo "validate-then-pay" reservation flow (`123f7097`)

The passenger-app flow the whole rest of this project's Yatroo work never
covered: a passenger reserves a fare on the Yatroo app (no payment yet, no
real `Ticket` exists), a conductor scans the resulting code and either
rejects it outright or accepts it — accepting is the point a real NamastePay
checkout gets created, and only a confirmed payment turns it into a real,
settled ticket. Deliberately reuses the exact machinery CB9/CB4's walk-in
flow already established rather than inventing a second payment model:

- `NamastePayCheckout.checkout_id` made nullable (a reservation has no
  checkout yet) and a new `REJECTED` status added — one new migration,
  `ticketing/migrations/0011_alter_namastepaycheckout_checkout_id_and_more.py`.
- Three new endpoints: `POST /tickets/reserve/` (passenger creates the
  reservation), `GET /tickets/reservations/{reference_id}/` (conductor looks
  it up), `POST /tickets/reservations/{reference_id}/validate/` (conductor
  accepts → real NamastePay checkout starts, or rejects → dead end, no
  payment ever attempted).
- Confirming payment reuses the *existing* `NamastePayCheckoutConfirmView` —
  the same conductor-tagging logic that already applied to walk-in fares
  applies here for free, no new code needed for that part.

### 13.2 Conductor cash/QR walk-in flow (Scenario 2) — confirmed already built

Investigated whether a conductor needs a new "choose cash or QR" API before
showing a payment method to a walk-in passenger — it doesn't. `POST
/tickets/` (cash, conductor confirms the amount directly, `payment_method`
defaults to `CASH`) and `POST /tickets/namastepay/checkout/` (QR) already
exist as two separate calls; whichever the conductor's own app calls is the
"choice." No backend gap here — see §13.3 for what actually was missing.

### 13.3 Conductor reconciliation report (`d32c9170`)

New `GET /analytics/reconciliation/` — today/this-week/this-year revenue in
one response, split cash vs. NamastePay/online, grouped by
`(conductor_id, vehicle_id)` pairs (not conductor alone, since a conductor
can move buses across a week/year and the money should stay tied to
whichever bus it was actually collected on — `Ticket.vehicle_id` already
records that directly at issuance per CB1, no need to reconstruct it from
`DailyAllocation` history). Wired into the tenant portal as a new
"Conductor Reconciliation" card under Accounting → Reports, reusing the
existing report-selector UI.

### 13.4 Public API Swagger documentation — fixed and reorganized (`80d9ee9b`, `19637885`, `66c4e08b`, `eca1d69a`, `f60c0976`, `bc4c3cba`, `ef8ae9a8`)

Found while checking why the Collector-login endpoint's Swagger page showed
an empty `{}` request body — turned into a full pass across the whole
Public API:

- **7 endpoints took a bare `payload: dict`** (login, issue ticket, group
  booking, NamastePay checkout, and the 3 new reservation endpoints from
  §13.1) — FastAPI can't introspect field names from a plain `dict`, so
  Swagger showed nothing. Added a Pydantic model per endpoint; every field
  stays `Optional` even where logically required (the handlers keep their
  own more-descriptive `_error(...)` messages instead of a generic Pydantic
  422), and every model has `extra="allow"` since `issue_ticket()` forwards
  a filtered-but-otherwise-arbitrary payload straight to Django.
- **3 of those (login, validate-reservation, validate-ticket) still showed
  an empty Example Value after that fix.** Real cause, not caching: giving
  the endpoint parameter a bare `= Model()` default made FastAPI embed a
  sibling `"default": {}` next to the schema's `$ref` in the OpenAPI spec —
  Swagger renders that sibling instead of resolving into the referenced
  schema's own example. Fixed by switching to `Body(default_factory=Model)`,
  which produces a clean `$ref` with no sibling key — verified against a
  live-container routing test, not just the spec JSON, that a truly-empty
  request body still gets the same friendly error as before (no behavior
  change, docs-only).
- **3 new endpoints (the reservation ones) were also missing the response
  examples** every other endpoint in the file has — added, matching the
  existing `responses={...}` convention. Also added one for the NamastePay
  merchant-lookup API's own ticket-by-ID endpoint, and a proper 302-vs-JSON
  explanation for the NamastePay browser-redirect callback.
- **The whole Public API was one flat 23-endpoint Swagger list** under a
  single `"Public API"` tag. Split into 6 sections (Auth, Routes & Fares,
  Trips, Tickets, NamastePay Payments, Reservations) via per-route
  `tags=[...]`, and removed the router-level tag from `main.py`'s
  `include_router()` call — FastAPI unions router-level and route-level
  tags, so leaving both would have made every operation appear twice.
- **The bare `citybus.com.np` domain no longer exposes the Public API at
  all** (`ef8ae9a8`) — it used to also proxy `/public-api/` to FastAPI as a
  duplicate path alongside `mobile-api.citybus.com.np`. Removed by explicit
  request: the Public API now has exactly one home, so there's a single
  place for an integrator to look. `/api/v1/live/` (GPS/live-tracking, a
  *different* FastAPI router used by the tenant portal's own dashboard) was
  deliberately left untouched — verified via a live routing test with
  throwaway containers standing in for fastapi/django/frontend, checking
  each one's own access log to confirm exactly which requests landed where.

### 13.5 First real production deployment since §8.1 (2026-09-30/10-01)

With both §8.1 blockers resolved (Ncell's port filter opened, DNS for the
bare domain corrected), deployed everything through `ef8ae9a8` to
`36.253.137.147` for real, start to finish:

```bash
ssh ubuntu@36.253.137.147
cd ~/short-route-bus && git pull origin main
cd docker
docker compose -f docker-compose.prod.yml build django fastapi frontend
docker compose -f docker-compose.prod.yml up -d db redis
docker compose -f docker-compose.prod.yml up -d django fastapi celery celery-beat frontend
docker compose -f docker-compose.prod.yml logs django --tail 50   # confirm migration 0011 applies clean
docker compose -f docker-compose.prod.yml up -d nginx
```

**One thing easy to miss:** `celery`/`celery-beat` build from the *same*
Dockerfile as `django` (`Dockerfile.django.prod`) but as their own,
separately-tagged images — the `build django fastapi frontend` step above
does **not** rebuild them. Needed their own explicit
`build celery celery-beat` + `up -d celery celery-beat`, or they silently
keep running the pre-deploy code indefinitely.

**Gotcha #3 from §8.1 bit again, exactly as documented:** after rebuilding
django/fastapi/frontend, `citybus.com.np` 502'd — nginx was never actually
restarted (`up -d nginx` is a no-op if compose sees no config change),
so it kept trying to reach the old, now-dead container IPs. Fixed with
`docker compose -f docker-compose.prod.yml restart nginx`. Verified for
real afterward: `citybus.com.np` → `200` with real HTML, and the live
OpenAPI spec (`/public-api/v1/routes/`'s own `tags` field, and the presence
of `/tickets/reserve/`) confirmed it was genuinely today's code, not a
stale cache.

### 13.6 New gotcha found this deploy: the "public" tenant/domain was never bootstrapped

While chasing why `citybus.com.np/api/docs/` (Django's own drf-spectacular
docs, distinct from FastAPI's — see §13.4) 404'd with Django's own generic
404 page, traced it to django-tenants' `TenantMainMiddleware.get_tenant()`
doing a hard `Domain.objects.get(domain=hostname)` — **no fallback**. A
direct check on production found **both `Tenant` and `Domain` tables
completely empty** — not even the baseline `public` schema had a
bookkeeping row, meaning *every* Django-routed request for `citybus.com.np`
(not just `/api/docs/`) was 404ing. This is the same "zero tenants
provisioned" finding from §8.1, just traced one level deeper than before —
even the platform's own baseline tenant was missing, not just real customer
tenants.

**Fixed with a purely additive `get_or_create`** (safe to confirm before
running: `TenantMixin.save()` calls `create_schema(check_if_exists=True)`,
which explicitly `return`s early if the schema already exists — since
`public` obviously already exists as Postgres's own default schema, this
can never attempt a `CREATE SCHEMA` or re-run migrations):

```python
from backend.apps.tenants.models import Tenant, Domain
tenant, _ = Tenant.objects.get_or_create(
    schema_name='public',
    defaults={'name': 'KVBMS Platform', 'status': 'ACTIVE', 'plan_type': 'BASIC'},
)
for host in ['citybus.com.np', 'www.citybus.com.np']:
    Domain.objects.get_or_create(domain=host, defaults={'tenant': tenant, 'is_primary': host == 'citybus.com.np'})
```

Worth checking on 172.19.0.246 too, if that server is ever brought back into
use — it likely has the identical gap.

### 13.7 Still open: `mobile-api.citybus.com.np` DNS points at a third, wrong server

`citybus.com.np` (bare domain) now correctly resolves to `36.253.137.147`,
but **`mobile-api.citybus.com.np` — the exact hostname Yatroo's integration
is documented against — resolves to `103.170.75.51`**, a server neither the
old (172.19.0.246) nor the new (36.253.137.147) box, confirmed still running
pre-session code (its own `/docs` page shows the old flat `"Public API"` tag
from before §13.4's reorganization). Confirmed the new server is otherwise
100% ready for this hostname regardless of DNS — forcing a direct connection
(`curl --resolve mobile-api.citybus.com.np:443:36.253.137.147 ...`) returns
`200` with the correct wildcard TLS cert match (`*.citybus.com.np`).

**Whoever manages DNS for `citybus.com.np`** (nameservers are
`ns1.shangrilagroup.com.np` / `ns2.shangrilagroup.com.np` — not a
third-party registrar, so this is an internal team member's own DNS panel,
not a support ticket) needs to update one A record:
`mobile-api.citybus.com.np` from `103.170.75.51` to `36.253.137.147`. Check
current status any time with `dig +short mobile-api.citybus.com.np`.

Since §13.4 deliberately removed the bare-domain `/public-api/` fallback,
there is currently **no working public URL for the Public API until this
DNS record is fixed** — this is now the single blocker on Yatroo's
integration, not anything code- or server-side.

### 13.8 Live Tracking map shows blank everywhere — third-party quota, not a bug

The map background (Baato, a Nepal-focused MapLibre-compatible tile
service) shows blank in local dev *and* production identically. Traced
precisely, not assumed: the style JSON loads fine (`200`), but the actual
tile endpoint (`GET https://api.baato.io/api/v1/maps/{z}/{x}/{y}.pbf`)
returns `403: "Your monthly usage limit has been exceeded"` — a real,
verified response from Baato's own API, not a local config problem. Marker
pins still render because those are separate React components, not part of
the tile layer; a faint boundary-outline shape can still appear since that
one layer loads from a static GeoJSON file, not the metered tile endpoint.

Same key (`VITE_BAATO_API_KEY`) is baked into both `frontend/.env` (local)
and `frontend/.env.production`, which is exactly why both environments fail
identically — the quota is per Baato account, not per environment.
`git log --all -- frontend/.env.production` shows the key was added in
commit `504e5060` by **Siddhant Pokharel** (matches the GitHub account this
repo is hosted under) — not confirmed whether that's a personal account or
a Shangrila-owned one.

**Fix needed, entirely outside this codebase:** log into the Baato account
that owns this key, upgrade the plan or wait for the monthly reset (or
generate a fresh key on a different account for a quick unblock), then
update `VITE_BAATO_API_KEY` in both `.env` files — production also needs a
frontend rebuild afterward to bake in the new key.

---

## 14. Standing crew, recurring dispatch, NamastePay merchant-lookup docs, and a full live Super Admin verification — 2026-10-02/03 session

### 14.1 Standing driver/conductor per vehicle, auto-filled on Dispatch (`633e5de4`)

Driver/conductor allocation used to be re-picked by hand on every Dispatch
assignment, even when the same vehicle runs with the same crew day after
day. `fleet.Vehicle` gained `standing_driver_id`/`standing_conductor_id`
(plus `current_driver_id`/`current_conductor_id` scaffolding), set once on
the vehicle via Fleet's edit/create forms, referencing `staff.Driver.id`/
`staff.Conductor.id` directly — the same convention
`dispatch.DailyAllocation.driver_id`/`conductor_id` already use, so
Dispatch's auto-fill needs no ID translation.

On the Dispatch assign form, picking a vehicle now auto-fills its standing
driver/conductor into the Driver/Conductor fields (a `useEffect` watching
`vehicle_id`, hint text "(auto-filled from vehicle — editable)") — but
both fields stay fully editable for a one-off substitution that day,
exactly as the user specified ("mostly permanent... override through the
roster"). No change is forced onto `DailyAllocation` itself; the standing
crew lives on `Vehicle`, Dispatch just reads it as a default.

### 14.2 Vehicle Categories: filter by body class, fuel type, name (`45957fb1`)

`VehicleCategoryViewSet.filterset_fields` gained `fuel_type` alongside the
existing `body_class`/`air_conditioned`/`is_active`. `VehicleCategoriesPage.tsx`
gained a search box (name) plus Body Class (Micro/Mini/Standard/Deluxe) and
Fuel Type (Diesel/Petrol/CNG/Electric/Hybrid) dropdowns, with a "Clear
filters" link shown only when a filter is active.

### 14.3 Recurring dispatch — auto-end shift, auto-create next day (`5535ff22`)

The ask: a 5am–6pm dispatch should auto-complete when its shift ends, and
if marked recurring, tomorrow's identical allocation should auto-appear
without the dispatcher re-entering it. Resolved via `AskUserQuestion` into
an explicit opt-in checkbox (not "every allocation recurs by default") and
an automatic close exactly at `shift_end` (not a manual "end of day" batch
job).

- `DailyAllocation.is_recurring` (bool, default `False`); `DispatchLog`
  gained `AUTO_COMPLETE`/`AUTO_RECUR` action types for the audit trail.
- New `backend/apps/dispatch/tasks.py`, a Celery Beat job
  (`dispatch.auto_complete_and_recur_shifts`, `crontab(minute="*/5")`,
  registered in `CELERY_BEAT_SCHEDULE`) that loops every `ACTIVE` tenant
  (same per-tenant `schema_context()` pattern as `analytics.tasks`) and,
  for every PENDING/ACTIVE allocation whose `shift_end` has passed: frees
  the vehicle, marks the allocation `COMPLETED`, logs `AUTO_COMPLETE` —
  then, only if `is_recurring`, creates tomorrow's identical allocation
  (same vehicle/driver/conductor/route/shift times), logging `AUTO_RECUR`.
  A recur is skipped (logged, not silently dropped) if the vehicle is
  already allocated tomorrow, or if the driver/conductor is already
  allocated elsewhere tomorrow — never double-books a person or a bus.
- Frontend: a "Repeat this every day" checkbox on the Dispatch assign
  form; a `RefreshCw` icon (wrapped in `<span title=...>` — `LucideProps`
  has no `title` prop directly) marks a recurring row in the allocations
  table.
- Verified the checkbox for real in the browser: `form_input` setting
  `.checked = true` doesn't fire a real DOM event, so react-hook-form
  never saw it (the payload silently sent `is_recurring: false` despite
  the box visually appearing checked) — fixed by driving a genuine
  `element.click()` via `javascript_tool` instead, confirmed via the
  actual submitted payload afterward.

### 14.4 Route-approval 403 — confirmed by design, not a bug (self-correction)

Investigated a Company Admin's 403 on approving a route. An unscoped
search (`grep def get_permissions`) initially matched a *different*
viewset earlier in the same file and wrongly concluded Company Admin
should be allowed. Re-scoped the search strictly inside `RouteViewSet`'s
own class body: it has its **own** `get_permissions()` override requiring
`IsSuperAdmin()` specifically for `approve`/`approve_stop`/
`approve_all_stops`/`reject_stop`, with an explicit code comment — route
approval is a platform-level quality/safety review, not a tenant's own
call. **No bug here**; corrected the record after initially reporting it
as broken.

### 14.5 Full live verification: Super Admin → tenant → real ticket sale

Asked directly: is everything Yatroo's app (passenger and conductor) needs
actually working end-to-end today, in full, testable right now? Rather
than re-reading code, ran it for real — Django's `test.Client` hitting
real view/serializer/permission code (not curl) plus `httpx` from inside
`kvbms-fastapi-1` (which has no `curl`), `unittest.mock.patch()` stubbing
only the genuinely-external NamastePay call. Confirmed the full chain
works: Super Admin creates a tenant (PENDING), activates it, a tenant admin
logs in (Django requires `X-Tenant-Slug`; FastAPI's conductor login instead
takes `tenant_schema` in the body — two different conventions on the two
surfaces, both correct for their own auth path), drivers/conductors/fleet/
fares get configured, a conductor issues a ticket, a passenger buys one
self-service — producing correct, distinct e-tickets tagged with the right
`conductor_id`/`passenger_id` on each path.

Real required-field gaps found by trial (not bugs — just the actual
required set, now known for next time): `/operator/drivers/` also needs
`dob`/`citizenship_no`/`address`/`license_category`; `/operator/conductors/`
also needs `citizenship_no`; the fare endpoint is `/platform/fare-matrix/`,
not `/platform/fares/`, and needs `student_fare`/`senior_citizen_fare`/
`child_fare` alongside `base_fare`/`peak_fare`; FastAPI's `fare_paid` must
be sent as a **string**, not a number (`"30"`, not `30` — `422` otherwise).
Test tenant teardown needed `FareMatrix`/`TicketType`/`Route`/`Stop` rows
deleted before the `Tenant` row (PROTECT FKs), then the orphaned Postgres
schema dropped manually (`Tenant.delete()` doesn't drop it).

Also used this pass to answer the user's e-ticket questions directly: an
e-ticket carries `ticket_uid`, route/stop names, fare, payment method,
QR code, issuing conductor's name, and `paid_at`/`issued_at`. A conductor
tells paid from unpaid purely from `Ticket` existing at all — every real
`Ticket` row in this system is, by construction, already paid
(`paid_at` set at creation); there is no "ticket exists but unpaid" state
to display, by design (see §3's `NamastePayCheckout` reserve-then-settle
pattern for the one place an unpaid *intent* exists, before a real Ticket
is ever created).

### 14.6 NamastePay's dynamic-QR lookup endpoint — confirmed already built, not missing

The user asked for an endpoint NamastePay can call to render a dynamic QR
(route, bus, amount, "pay once" guarantee) before a passenger pays, and
specifically asked that it carry bus number, conductor_id, ticket_id,
fare, and route. Checked: this endpoint already exists —
`GET /public-api/v1/namastepay/tickets/{reference_id}/`
(`backend/fastapi_services/namastepay_api/router.py`, built earlier in
commit `42397f7e` for Payment System Design item CB4) — looked up by
`NamastePayCheckout.reference_id` (format `CB-<16 hex>`), not
`Ticket.ticket_uid`, specifically because at lookup time no `Ticket` exists
yet for either case it serves (a passenger's own self-service checkout, or
a conductor-initiated walk-in for a passenger with no CityBus account);
`reference_id` is generated at checkout-creation time to be quoted
externally as "the ticket ID." Dynamic-per-passenger is already
structural: each checkout gets its own `reference_id`, so a second
passenger always gets a different QR, never a shared/reusable one.

This surfaced from two of my own mistaken "it's missing" claims, both
corrected in this session:
- First claim (missing entirely): I'd only grepped
  `public_api/router.py`, not the separate `namastepay_api/` module it
  lives in — both locally and against the live server's container.
  Rechecking with a correctly-scoped recursive grep found it immediately;
  a byte-for-byte comparison then confirmed the server's copy is an exact
  match of what's already committed (`42397f7e`) — no server drift, no
  uncommitted code, nothing missing. Corrected to the user explicitly.
- Second claim: a screenshot later showed a "Public API — NamastePay
  Payments" Swagger section with 3 *different* endpoints
  (`namastepay-payments`-tagged — checkout-create/confirm/status, built
  for CB9's actual payment flow) and the user asked why NamastePay
  couldn't use those instead. Answer: those three are CityBus calling
  *NamastePay's* API (initiate/enquire a checkout) — the reverse
  direction, and for a different purpose (an in-app purchase) than what
  NamastePay's own merchant terminal needs (a read-only lookup to decide
  what to render *before* either side has done anything). The
  `namastepay/tickets/{reference_id}/` endpoint — now split onto its own
  doc, see §14.7 — is the one actually meant for them to call.

The user then asked the right follow-up: the endpoint needs to carry
`conductor_id` and a way to trace which bus/owner the fare belongs to, for
reconciliation. Added (`f2b4b408`):
- `NamastePayCheckout.conductor_id` (nullable — null for a pure
  self-service checkout where no conductor is involved at all; set the
  moment a conductor actually drives the checkout into existence, either a
  walk-in checkout or accepting a scanned reservation).
- `fetch_vehicle_owner_id()` in `tenant_db.py` — one join from
  `fleet.Vehicle.owner_id`, same pattern as every other "which owner does
  this bus belong to" lookup in the codebase.
- The lookup endpoint's response now includes `vehicle_id`, `owner_id`,
  and `conductor_id` alongside the existing route/bus/amount/status
  fields — everything needed to post this fare against the right
  owner/bus/conductor in a reconciliation report, all already known on
  CityBus's own side, nothing new required from NamastePay.

### 14.7 NamastePay's own, separate Swagger doc (`8595f2a2`, `67ab2c68`)

User's ask: the one endpoint NamastePay actually needs should live on its
own documentation page, not buried inside Yatroo's full Master API surface
— cleaner for a partner who should see exactly one endpoint, nothing else.

Built as `/namastepay-docs` (Swagger UI) + `/namastepay-openapi.json`
(the schema it reads), both serving a real, separate, minimal OpenAPI doc
containing only the NamastePay lookup endpoint. The real endpoint's actual
URL/behavior is completely untouched — this only changes what shows up in
documentation.

Two non-obvious FastAPI/nginx gotchas hit and fixed while building this:
- **`include_in_schema=False` double-gates.** Setting this flag on the
  main app's `namastepay_router` inclusion (to hide it from Yatroo's main
  docs) also silently empties out ANY custom `get_openapi()` call built
  from that same route object — traced via `inspect.getsource()` on
  FastAPI's own `get_openapi_path()`, which gates its whole per-route
  schema-building logic on `if route.include_in_schema:`, not just the
  main docs' own rendering. Fixed by building a second, throwaway
  `APIRouter()` (`_namastepay_docs_router`) that re-includes the same
  router at the same prefix *without* the flag, and generating the custom
  schema from that throwaway router's `.routes` instead of the real app's
  route table. The real endpoint stays correctly hidden from the main docs
  and fully functional at its real URL.
- **nginx's catch-all silently 404s new top-level paths.** The
  `mobile-api.citybus.com.np` server block's `location /` unconditionally
  rewrites any unmatched path to `http://fastapi/public-api/v1/` (a prefix
  rewrite, not passthrough) — so the new `/namastepay-docs` and
  `/namastepay-openapi.json` URLs 404'd via the wrong rewritten path even
  after the FastAPI side was correctly deployed. Fixed with two explicit
  `location = /exact-path { proxy_pass ...; }` blocks, matching the
  existing pattern already used for `/docs`/`/openapi.json`/`/health`.

### 14.8 Still open: `mobile-api.citybus.com.np` DNS, and a newly-found SSL cert gap

**Same unresolved DNS issue as §13.7** — `mobile-api.citybus.com.np` still
resolves to `103.170.75.51` (the wrong, third server), confirmed again
this session; nothing has changed there since §13.7 was written. This
remains the single blocker on NamastePay or Yatroo reaching the live
endpoints by hostname.

**New finding, worth re-checking §13.7's own claim:** while investigating
an SSL certificate renewal (cert found expiring in 9 days; `certbot` isn't
even installed on the production server, and the existing wildcard cert
was almost certainly just copied over via a `letsencrypt_backup.tar.gz`
found in the user's home directory — no working renewal mechanism exists
at all), a `certbot --standalone` attempt for `citybus.com.np`/`www`/
`mobile-api` failed because Let's Encrypt's own validators reached
`103.170.75.51` for **all three** domains, including the bare
`citybus.com.np` — directly contradicting §13.7's claim that
`citybus.com.np` "now correctly resolves to `36.253.137.147`." Root cause
traced to a leftover `/etc/hosts` override inside *my own sandbox*
(`36.253.137.147 citybus.com.np` / `...mayurbus.citybus.com.np`) that had
been silently fooling every `dig`/`curl` check run from this sandbox
throughout this whole DNS saga, including whatever check §13.7 itself was
based on. The user independently ran `dig citybus.com.np @8.8.8.8 / @1.1.1.1
/ @9.9.9.9 +short` — all three public resolvers agree on `103.170.75.51`.
**§13.7's "citybus.com.np now correctly resolves" claim should be treated
as unconfirmed, not fixed** — the bare domain itself has likely never
actually been pointed at the new server (`36.253.137.147`) in real public
DNS at all, only inside this sandbox's own stale hosts file.

Drafted a short plain-text message (`dns_update_plan.txt`, sent to the
user, progressively simplified per request down to short plain points)
for the user to forward to whoever manages DNS, listing the exact A
records needing to change and citing the `dig` outputs plus Let's
Encrypt's own failed validation as independent evidence. **Neither the
DNS fix nor a working SSL certificate renewal was completed by the end of
this session** — both need action from whoever controls
`ns1.shangrilagroup.com.np`/`ns2.shangrilagroup.com.np`, not more code.
