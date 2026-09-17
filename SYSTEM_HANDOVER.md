# KVBMS System Handover

**Kathmandu Valley Bus Management System** — a multi-tenant SaaS for bus operators, with a public-facing site, a platform Super Admin portal, and a per-operator Tenant Portal. This document captures the state of the project after an extended work session so a future session can continue without re-deriving context.

Written: 2026-07-06. Updated: 2026-09-16 (see §10 for everything since the original write-up).

---

## 1. Architecture

- **Backend**: Django + Django REST Framework, ASGI via `daphne`. Multi-tenancy via **django-tenants** (schema-per-tenant in PostgreSQL).
- **Frontend**: React + TypeScript + Vite, single SPA serving three "apps" by route prefix:
  - `/` — public marketing/info site (`frontend/src/apps/public/`)
  - `/super-admin/*` — platform operator console (`frontend/src/apps/super-admin/`)
  - `/tenant/*` — bus-operator company portal (`frontend/src/apps/tenant-portal/`)
- **Realtime/GPS service**: FastAPI (`backend/fastapi_services/`)
- **Async tasks**: Celery + Celery Beat, Redis-backed
- **Reverse proxy**: nginx, routes by path prefix to Django/FastAPI/frontend
- **i18n**: `react-i18next`, 4 namespaces (`common`, `public`, `platform`, `tenant`), English + Nepali (`en`/`ne`) under `frontend/src/i18n/`

### Two Django URL configs (important, caused a real bug this session)
- `backend/config/urls.py` — **ROOT_URLCONF**, used for every real tenant schema
- `backend/config/urls_public.py` — **PUBLIC_SCHEMA_URLCONF**, used only for the special `public` system tenant

Any app added to `TENANT_APPS` (`backend/config/settings/base.py`) must be registered in **both** files, or it 404s the moment you're on a real tenant subdomain. `rbac` was missing from `urls.py` and got fixed this session (see §4). **`inventory` has the same gap and is still unfixed** — see §6.

### Multi-tenancy / how requests get scoped to a tenant
Two independent mechanisms, don't confuse them:
1. **Hostname-based schema resolution** (django-tenants' `TenantMainMiddleware`): the `Domain` model maps a hostname (e.g. `test.localhost`) to a `Tenant`. Determines which `ROOT_URLCONF`/schema is used to route + connect for a request based on the Host header.
2. **Header-based schema switching** (`backend/config/tenant_middleware.py`'s `TenantSchemaMiddleware`, custom code in this repo): reads `X-Tenant-Slug` header (sent by the frontend's axios interceptor, `frontend/src/services/api.ts:40-44`) and calls `connection.set_tenant()`. This is what actually scopes `TENANT_APPS` data (fleet, staff, dispatch, accounting, rbac, etc.) to the correct tenant for API calls that go through nginx/nginx `localhost` rather than a tenant subdomain directly. **This was a critical security hole, fixed this session — see §5.**

### Local dev domains
- `TENANT_BASE_DOMAIN` setting (`base.py`/`development.py`) controls the suffix appended to a new tenant's subdomain: `kvbms.com.np` in production, `localhost` in dev. So creating a tenant named "test" gives it the domain `test.localhost`, reachable at `http://test.localhost:8090` (no `/etc/hosts` edit needed — browsers treat `*.localhost` as loopback automatically).
- nginx currently listens on **port 8090** (not 80, not 8080 — both were taken by other things on this machine; see git history / earlier session notes in `docker/docker-compose.yml` comments).

---

## 2. Running the project

```bash
cd docker
docker compose up -d          # start everything
docker compose ps             # check status
docker compose restart django # REQUIRED after any backend/*.py change — daphne does not auto-reload
docker compose stop           # stop without removing volumes/data
```

Frontend (Vite) **does** hot-reload on file changes — no restart needed for `frontend/src/**` edits.

Ports: nginx `8090`, django `8000`, fastapi `8001`, frontend (direct, bypasses nginx — don't use for tenant-subdomain testing) `3001`, postgres `5433`, redis `6380`.

### Credentials currently in the system
| Role | Email | Password | Tenant |
|---|---|---|---|
| Super Admin | `admin@kvbms.com.np` | `Admin@123456` | — (public schema) |
| Company Admin | `aadarsha@gmail.com` | *(user's own — not known to Claude)* | `test` (schema_name), tenant name "Default Company"/"Test" |

Only one real tenant (`test`) and the `public` system tenant exist right now — the 4 demo tenants from earlier in the session (`sajha_yatayat`, `metro_yatayat`, `mayur_yatayat`, `juneli_yatayat`) were deleted entirely (Tenant rows + Domain rows + PostgreSQL schemas dropped) at the user's request.

All verification/throwaway users and tenants created during this session's testing (`verify-rbac@test.com`, `tenant2`, etc.) were cleaned up afterward — nothing left behind.

---

## 3. Chronological summary of this session's work

1. **Fixed `docker compose up` port conflicts** — port 80 taken by host Apache2, then 8080 taken by an unrelated `parking_nginx` container. Settled on port **8090**.
2. **Repo hygiene**: added `.gitignore` (was missing entirely — `node_modules`, build output, `.env` files, Django `staticfiles`/`media` were all tracked in git), untracked ~28,900 files, wrote `README.md`.
3. **Fixed django-tenants bootstrap**: fresh DB had no `public` Tenant/Domain records, so *every* API request 404'd with "No tenant for hostname". Created the public tenant + `localhost`/`django`/`nginx` domains.
4. **Nepali (`ne`) translation + BS calendar work**, expanding outward from the public site to the whole app:
   - Public site (`HomePage`, `RoutesPage`, `StopsPage`, `FaresPage`, `TicketVerifyPage`, `ComplaintsPage`, `SmartCardPage`, `PublicLayout`, `LoginPage`) — **fully translated**, including moving Zod-validation-message schemas inside components so they can call `t()`.
   - Built `NepaliDateInput` (`frontend/src/components/shared/NepaliDateInput.tsx`) — a **true Bikram Sambat calendar picker** (not just Gregorian dates relabeled), using BS↔AD lookup tables already in `frontend/src/utils/nepaliDate.ts` (exposed two new helpers there: `daysInBSMonth`, `getBSYearRange`). Built because native `<input type="date">` renders in the browser's own locale, which doesn't support Nepali.
   - Built `NepaliTimeInput` (`frontend/src/components/shared/NepaliTimeInput.tsx`) — two plain `<select>` dropdowns (hour/minute) instead of native `<input type="time">`, since native `<option>` text is fully controlled by the app (no browser-locale involvement).
   - Super Admin portal: fully translated (Dashboard, Tenants, Tenant Detail, Billing incl. all 4 tabs, Smart Cards, Users, Settings) + all date/time fields converted to the Nepali components. `platform.json` grew to 318 keys (en/ne fully in sync).
   - Tenant Portal: **partially translated** — see §6 for exact per-file status, this is the biggest remaining chunk of work.
5. **Multi-tenant subdomain-per-tenant onboarding**: previously, creating a tenant always hardcoded a `.kvbms.com.np` domain (unreachable in local dev). Added `TENANT_BASE_DOMAIN` setting; tenant creation (`backend/apps/tenants/serializers.py`) now uses it, so local dev tenants get working `*.localhost` domains automatically. Also fixed the frontend's post-creation "share these credentials" modal to show the real, dynamically-derived login URL instead of a hardcoded `localhost:3001/login`.
6. **Fixed a real bug**: the Super Admin "Tenants" list was showing the internal `public` system tenant alongside real operators, with an active **Suspend** button that would have broken the whole platform's domain resolution if clicked. Fixed by excluding `schema_name=get_public_schema_name()` from `TenantViewSet`'s queryset (`backend/apps/tenants/views.py`).
7. **Fixed the `rbac` app 404 bug**: `rbac` (Roles & Permissions) was registered in `urls_public.py` but not `urls.py`, so it 404'd on every real tenant. Fixed, and also found that new tenants never got the RBAC permission catalogue seeded (empty Permission Matrix for every new tenant) — `TenantSerializer.create()` now calls `seed_permissions` automatically.
8. **Security audit + 2 critical fixes** — see §5, the most important remaining context.

---

## 4. i18n / Nepali translation — exact current status

Translation file key counts (all validated to be syntactically correct JSON, en/ne key sets compared programmatically):

| Namespace | en keys | ne keys | Missing in ne |
|---|---|---|---|
| `common` | 111 | 111 | 0 |
| `public` | 155 | 155 | 0 |
| `platform` | 318 | 318 | 0 |
| `tenant` | 651 | 624 | 27 (all in unreachable `hr`/`inventory`/`revenue` sections — see below, not a concern) |

### Fully done
- **Public site** (all 9 files) — complete, including the BS calendar date picker on the complaints form.
- **Super Admin portal** (all 8 files: layout, dashboard, tenants, tenant detail, billing, smart cards, users, settings) — complete, including all date/time fields.
- **Tenant Portal — `TenantLayout.tsx`** (sidebar) — complete.
- **Tenant Portal — `RoutesPage.tsx`, `StopsPage.tsx`** — complete (these were already ~95% wired to `t()` before this session; only toast messages and 2 inline validation strings needed fixing, now done).
- **Tenant Portal — `DispatchPage.tsx`** — date/time pickers fully converted to `NepaliDateInput`/`NepaliTimeInput`; general translation coverage is good (117 `t()` calls / 1222 lines — this file was already well-translated).

### NOT done — exact scope for the next session
Measured by literal `t()` call count per file (a rough but honest proxy for translation completeness — a well-translated page of this style typically has 1 `t()` call per 8–15 lines):

| File | `t()` calls / lines | Status |
|---|---|---|
| `TenantSettingsPage.tsx` | **0 / 307** | Not started — 100% hardcoded English |
| `SchedulingPage.tsx` | 2 / 154 | Barely started |
| `MaintenancePage.tsx` | 6 / 386 | Barely started |
| `TenantAnalyticsPage.tsx` | 9 / 430 | Barely started |
| `TicketingPage.tsx` | 16 / 743 | Early stage (receipt labels, payment method dropdown, table headers mostly hardcoded) |
| `RolesPermissionsPage.tsx` | 14 / 878 | Early stage (the `ACTION_LABELS`/toast constants especially) |
| `OperationsDashboardPage.tsx` | 27 / 553 | Partial — this is "Today's Trips", high-traffic; has the most hardcoded modal/button text (cancel/delay trip modals) |
| `LiveTrackingPage.tsx` | 18 / 582 | Partial |
| `ConductorsPage.tsx` | 46 / 820 | Partial, decent coverage but toasts + some labels remain |
| `AccountingPage.tsx` | 35 / 1538 | Partial — very large file, low density; tab names (`const tabs = [...]`) and TYPE_META labels are hardcoded arrays, not `t()` |
| `FleetPage.tsx` | 112 / 747 | Good coverage already; a handful of toasts + 3 inline `register(..., { required: '...' })` validation messages remain |

**Recommended order to continue**, per the earlier audit's priority ranking: `OperationsDashboardPage` (highest traffic) → `FleetPage` (small remaining gap, quick win) → `RolesPermissionsPage` → `AccountingPage` → the rest.

**Pattern to follow** (established and consistent across all fixed files this session):
1. Read the file in full.
2. Design new keys under the existing `tenant.json` structure (it already has `fleet`, `staff.drivers`, `staff.conductors`, `routes`, `stops`, `scheduling`, `dispatch`, `ticketing`, `maintenance`, `analytics`, `accounting`, `roles`, `settings`, `nav`, `operations`, `liveTracking` top-level sections — reuse/extend these, don't create new top-level sections).
3. Add keys to **both** `frontend/src/i18n/en/tenant.json` and `frontend/src/i18n/ne/tenant.json` — always keep them in sync (verify with the flatten-and-diff Python one-liner used throughout this session).
4. Wire up `t()` calls in the component. For react-hook-form `register(field, { required: 'message' })` inline validation, either call `t()` directly inline (safe if `t` is already in scope, as done in `RoutesPage.tsx`) or move a `useForm` config/schema inside the component body if using Zod.
5. For any native `<input type="date">` / `type="time">`, replace with `NepaliDateInput`/`NepaliTimeInput` — use `Controller` from `react-hook-form` if the field is `register()`-based, or direct `value`/`onChange` props if it's a plain `useState`.
6. Run `npx tsc --noEmit -p tsconfig.json | grep <FileName>` after every file — compare against the pre-existing baseline noise (see §7) to confirm you haven't introduced new errors.
7. Check `docker compose logs frontend --tail 20` for HMR confirmation (no errors).

### Dead code — do NOT spend time translating these
Confirmed unreachable (not in any router):
- `frontend/src/apps/tenant-portal/pages/TripsPage.tsx`
- `frontend/src/apps/tenant-portal/pages/HRPage.tsx`
- `frontend/src/apps/tenant-portal/pages/InventoryPage.tsx`
- `frontend/src/apps/tenant-portal/pages/DashboardPage.tsx` (superseded by `OperationsDashboardPage.tsx`)
- `frontend/src/apps/super-admin/pages/RoutesPage.tsx`, `StopsPage.tsx`, `AnalyticsPage.tsx` (found in an earlier pass this session)

The 27 missing `ne` keys in `tenant.json` (`hr.*`, `inventory.*`, `revenue.*`) correspond to these dead pages — leave as-is unless those pages get wired up.

---

## 5. Security audit findings

A dedicated security-focused audit was run this session covering `fleet`, `staff`, `scheduling`, `dispatch`, `ticketing`, `maintenance`, `fuel`, `procurement`, `incidents`, `complaints`, `documents`, `analytics`, `accounting`, `rbac`, `tenants`.

### FIXED and verified this session

**1. CRITICAL — Cross-tenant data access via unvalidated `X-Tenant-Slug` header.**
Any authenticated user of tenant A could send `X-Tenant-Slug: tenant-b` and the backend would happily switch the DB connection to tenant B's schema and serve/accept tenant B's data — role permission classes (`IsFleetRole`, `IsFinanceRole`, etc.) only ever checked *what* the user's role could do, never *which tenant* they were allowed to act as.

- **Fix**: `backend/config/tenant_middleware.py` — `TenantSchemaMiddleware` now resolves the JWT directly (via `rest_framework_simplejwt.authentication.JWTAuthentication`, called manually since Django middleware runs before DRF's own auth stage) and rejects the request with `403` if the `X-Tenant-Slug` header doesn't match `request.user.tenant_schema`, **before** switching the schema.
- **Important implementation lesson**: an earlier attempt added a DRF `permission_classes` check instead — this **does not work**, because any view/viewset that sets its own `permission_classes` list (which is nearly every view in this codebase) *replaces* `DEFAULT_PERMISSION_CLASSES` rather than extending it. The fix has to live in the middleware, which runs unconditionally.
- **Verified**: created a second tenant + cross-tenant test users, confirmed a spoofed header now returns `403` while the legitimate own-tenant header and no-header cases behave exactly as before (`200`).

**2. CRITICAL — `accounting` module had zero role-based authorization.**
All 11 view classes in `backend/apps/accounting/views.py` (`ChartOfAccountViewSet`, `JournalEntryViewSet`, `SalaryPaymentViewSet`, and 8 report `APIView`s) had no `permission_classes` set, falling back to `IsAuthenticated`-only. Any authenticated user of *any* role (e.g. a `DRIVER` account) could read/write the full ledger and mark salaries as paid.
- **Fix**: added `permission_classes = [IsFinanceRole]` to all 11 classes (matching the convention every other module already followed).
- **Verified**: `COMPANY_ADMIN`/`FINANCE_OFFICER` → `200`; `DRIVER` → `403`.

### NOT fixed — flagged for a future session, in priority order

**3. MODERATE — No file-upload validation anywhere** (type/size/extension). Affects `Document.file_path`, `VehicleDocument.file`, `Driver.photo`, `Conductor.photo`, `BusCompany.logo`, `Tenant.logo`, `TenantDocument.file`, and others. No model/serializer uses `FileExtensionValidator` or content-type/size checks. Risk: arbitrary file types uploaded and later served from `MEDIA_URL` (potential stored-XSS via `.svg`/`.html` uploads), unbounded storage use. Path traversal itself is mitigated by Django's default `FileSystemStorage`, so this is "add validators," not "fix an RCE."

**4. MODERATE — `VerifyTicketView` (`backend/apps/ticketing/views.py:86-105`) mutates state (marks ticket `USED`) on a plain unauthenticated `GET`.** Should be a `POST`. Low practical risk since the ticket UID has 48 bits of randomness (not guessable), but it's bad practice and would need a coordinated frontend change (`TicketVerifyPage.tsx` currently calls it as a GET).

**5. LOW — Login flow allows account-existence enumeration.** A locked account returns "Account locked until {time}," while wrong-password/no-such-email both return a generic "Invalid credentials" — the difference lets an attacker distinguish "this email exists and is locked" from "it doesn't exist." (`backend/apps/users/serializers.py:20-28`, `views.py:18-46`.)

**6. LOW — No IP/request-based rate limiting on auth endpoints**, only per-account lockout (`backend/apps/users/models.py:96-103`, `MAX_LOGIN_ATTEMPTS`). A distributed brute-forcer isn't slowed by anything global. `REST_FRAMEWORK` has no `DEFAULT_THROTTLE_CLASSES` configured (`backend/config/settings/base.py:167-186`).

### Explicitly checked and confirmed fine (no action needed)
- JWT config (60 min access / 7 day refresh, rotation + blacklist-after-rotation, logout blacklists the token) — good practice.
- No raw SQL / `eval()` / `exec()` / unsafe deserialization anywhere in scope.
- `rbac` module's own authorization (`IsCompanyAdmin` + audit log on every mutation) — good pattern.
- `complaints` module's public `create` endpoint is intentionally `AllowAny` (matches the public complaints form) — correct by design.
- The couple of `schema_context()` calls that accept a tenant identifier from the client (`backend/apps/tenants/views.py:113-120`, `backend/apps/platform/views.py:356-360`) are `IsSuperAdmin`-gated only — out of the tenant-portal threat model, not itself a new finding.

---

## 6. Other known issues (functional, non-security)

- **`backend.apps.inventory` has the same "missing from `urls.py`" bug that `rbac` had**, but its frontend page (`InventoryPage.tsx`) isn't routed either — so it's currently invisible dead code on both ends. Fix both together if/when Inventory becomes a real feature; fixing only the backend half would do nothing visible.
- **Docker/Django restart requirement**: `daphne` runs without `--reload`. Every backend Python change requires `docker compose restart django` from the `docker/` directory. This tripped up verification more than once this session — always check `docker inspect docker-django-1 --format '{{.State.StartedAt}}'` against your file edit times if a fix "isn't working."
- **django-tenants doesn't auto-drop PostgreSQL schemas on `Tenant.delete()`** (a safety default) — deleting a tenant leaves an orphaned, empty schema behind unless you also run `DROP SCHEMA "<name>" CASCADE` manually via psql. Confirmed safe to do (the leftover schema only ever contains Django's own auto-generated tables, never business data, when a tenant was created but never actually used) — but always check row counts first before dropping.

---

## 7. Pre-existing, unrelated TypeScript baseline noise

These `tsc --noEmit` errors existed before this session and are unrelated to any of the above work — don't mistake them for regressions:
- Various `TS6133 'X' is declared but its value is never read` (unused imports) across `FaresPage.tsx`, `SmartCardPage.tsx`, `SuperAdminLayout.tsx`, `AnalyticsPage.tsx`, `BillingPage.tsx`, `SmartCardsPage.tsx`, `TenantDetailPage.tsx`, `TenantsPage.tsx`, `UsersPage.tsx`, `TenantApp.tsx`, `DashboardPage.tsx`, `DriversPage.tsx`, `TripsPage.tsx`, `tenantService.ts`.
- `TS2345` type mismatches in `TenantsPage.tsx` (`CreateTenantForm` vs `TenantCreatePayload`), `BillingPage.tsx` (invoice payload type), `TenantDetailPage.tsx` (`commission_rate` doesn't exist on `Tenant`), `TenantsPage.tsx` (`Property 'commission_rate' does not exist`).
- Test files (`src/__tests__/*`) show many errors because `@types/jest` isn't installed — tests were never run/configured with type support; not something touched this session.

---

## 8. Quick reference — where things live

- Translation files: `frontend/src/i18n/{en,ne}/{common,public,platform,tenant}.json`
- Nepali calendar utils: `frontend/src/utils/nepaliDate.ts` (BS↔AD conversion, `toNepaliDigits`, `formatNPR`, `formatDate`)
- Nepali-aware form components: `frontend/src/components/shared/{NepaliDateInput,NepaliTimeInput,NepaliInput}.tsx`
- Tenant middleware (security-critical): `backend/config/tenant_middleware.py`
- Tenant creation logic: `backend/apps/tenants/serializers.py` (`TenantSerializer.create()`)
- Role/permission classes: `backend/apps/users/permissions.py`
- Two URL configs: `backend/config/urls.py` (real tenants) / `backend/config/urls_public.py` (public schema only) — **keep these in sync when adding a new app to `TENANT_APPS`**
- RBAC permission catalogue seed data: `backend/apps/rbac/management/commands/seed_permissions.py`

---

## 9. Suggested next steps, in order

1. Finish Tenant Portal translation — start with `OperationsDashboardPage.tsx` (highest traffic), then `FleetPage.tsx` (smallest remaining gap), per §4.
2. Fix file-upload validation (Finding #3, §5) — add `FileExtensionValidator`/size limits to the document/photo/logo fields listed.
3. Convert `VerifyTicketView` to `POST` (Finding #4) — coordinate with the frontend call site.
4. Consider rate limiting (Finding #6) if this is heading toward production traffic.
5. Decide whether `inventory` becomes a real feature; if so, wire up both the backend URL and a frontend route/sidebar entry together.

---

## 10. Session update (2026-09-16) — Route/Group Rotation engine + NamastePay payment integration groundwork

A later, separate work session. Sections 1–9 above are still accurate as architecture/history; this section covers everything built since.

### Chronological summary

1. **QA regression pass** — worked a spreadsheet of 10 failing test tickets; verified most were already fixed by commits predating this session, confirmed the rest live (created real data, tested through the actual UI rather than trusting commit messages). One (#4) stayed blocked pending reporter clarification — unrelated to this session's code.
2. **Accounting data repair** — found 4 pre-existing `JournalEntry` rows on the `mayurbus` tenant with zero `JournalEntryLine`s (created before that tenant's Chart of Accounts existed). Backfilled locally and wrote a generalized, idempotent script for production: `backend/scripts/backfill_journal_lines.py` (commit `e2aceabf`). **Not yet run in production** — the exact command is in that commit's file header.
3. **Route & Group Rotation subsystem** — a full new feature area, built against a client-supplied spec doc (`/home/aadarsha/Documents/Sha-requirements/route-group-rotation-documentation.docx`) in 4 slices matching the doc's own P0–P2 phase plan. See the dedicated subsection below.
4. **NamastePay payment integration (credentials + gateway plumbing only)** — per-tenant encrypted payment-gateway credentials, a gateway client, and a settings page. See dedicated subsection below. Verified live against NamastePay's real TEST API (see below).

### Route & Group Rotation — what it is and what's built

A vehicle-group rostering system: operators define vehicle *categories* (e.g. "Deluxe AC 35-seat"), group vehicles into *groups* (the actual unit assigned to a route, not individual buses), configure which categories a route needs and how many slots per day-type, then generate/publish a dated roster of which group runs which route on which day.

| Slice | Doc phase | What it adds | Commit | Status |
|---|---|---|---|---|
| 1 | Foundation | `VehicleCategory`, `VehicleGroup` (+ derived capability profile, composition rules), `RouteRequirement`/`RouteDemand`, eligibility check, balance check | `aafd71f0` | Deployed to prod: **no** |
| 2 | P0 | New `roster` app: `RosterPeriod`/`Duty`/`DutyOverride`/`VehicleSubstitution`, manual roster grid, publish/override workflow, day-of vehicle substitution, reserve surge-fill, driver "my roster" view | `89db8321` | Deployed to prod: **no** |
| 3 | P1 | Slot-ring + daily-shift auto-rotation, 3 week patterns (keep-rotating/repeat-week/rotating-repeat), same-weekday (hard) + cooldown (soft) validation feeding the conflict panel | `173d133f` | Deployed to prod: **no** |
| 4 | P2 | Hand-written O(n³) Hungarian min-cost bipartite matching (no matching library exists in this stack), full weighted cost model, sequential day-by-day solve with proactive same-weekday prevention, bounded pairwise-swap repair pass, per-duty "explain" endpoint, fair-share report | `f0b887f7` | Deployed to prod: **yes** |
| 5 | P3 (partial) | Depot proximity: `VehicleGroup.home_latitude/longitude`, `RotationPolicy.depot_proximity_weight` (default 0/off), haversine cost term dropped into the existing cost function, UI for both the group's depot coordinates and the new policy weight | pending | Deployed to prod: **no** |
| — | P3 (rest) | Reserve automation beyond simple LRU, crew hours, shared/syndicate routes | — | **Not built** — crew-hours needs a policy decision that hasn't been made; shared/syndicate routes are explicitly out of scope per the doc's own v1 boundary. Surge-from-ticketing-data turns out **not** to be buildable yet either — `Ticket` has no `route_id` field at all (confirmed by reading the actual issuance code, not assumed), so there's no way today to count tickets sold per route/day. The one buildable piece (adding `route_id` to `Ticket` and having the POS form send it) is scoped and ready to build, but hasn't been started. |

All 4 slices were built through a full plan→implement→verify cycle each (Django shell unit tests for the pure-math pieces, full API-level integration tests via Django's test `Client`, and real-browser click-through for the frontend). The complete design reasoning, scoping decisions, and verification steps for all 4 slices are preserved in `/home/aadarsha/.claude/plans/proud-wobbling-pike.md` — read that before extending this feature further, it explains *why* each slice is shaped the way it is (e.g. why the ring/shift math from P1 becomes just one weighted term in P2's cost function rather than being thrown away).

**Two real bugs found and fixed during this work, worth knowing about if debugging nearby code:**
- The repair pass in Slice 4 originally called the full `_compute_conflicts()` (several DB queries including a cross-schema route lookup) once per candidate swap — with up to ~30 candidates × ~30 iterations, this made `rotate()` take *minutes*. Rewritten to search entirely in memory against a working copy of the period's assignments, with only one DB read up front.
- That same in-memory rewrite initially only screened candidate swaps against the same-weekday rule, and could silently introduce a *double-booking* (same group, two duties, one date) since it never checked that. Fixed by screening every candidate against a live `group_id → set of dates` index before it's ever tried, not just measuring the outcome after the fact.

**New app**: `backend/apps/roster/` — a new `TENANT_APP`. Confirms this document's own §1 warning about the two URL configs independently: `roster`'s endpoints 404'd through the browser (while working fine via a direct Django test `Client`) until registered in **both** `backend/config/urls.py` and `backend/config/urls_public.py` — exactly the class of bug already flagged here for `rbac`/`inventory`. `roster` is correctly registered in both now; if a future app hits the same silent-404 symptom, check this first.

**Where the rotation logic lives**: `backend/apps/roster/services.py` holds the pure math (ring layout, shift-per-date formulas, the Hungarian solver, the per-day cost-based solve) — deliberately kept free of request/view concerns so it's unit-testable from a plain shell. `backend/apps/roster/views.py` holds the HTTP layer and the sequential day-by-day orchestration (`RosterPeriodViewSet.rotate()`), plus the conflict-detection (`_compute_conflicts()`) and repair (`_repair_period()`) logic. `RotationPolicy` (one row per tenant, fetched-or-created lazily) holds every configurable weight/threshold.

**Slice 5 (P3 depot proximity)** — the one P3 item that turned out to be genuinely buildable without new data sources: `VehicleGroup.home_latitude`/`home_longitude` (nullable, matches `platform.Stop`'s existing lat/lng convention — not a separate `Depot` model) and `RotationPolicy.depot_proximity_weight` (default 0/off, matching the doc's own default). A `haversine_meters()` helper feeds a new `depot_proximity` term into the existing cost `components` dict in `solve_day_assignment` — no other change needed since `total = sum(components.values())` already picks up any new key, same mechanism that made every prior weight addition a one-line change. Zero cost (and never blocks) when a group has no coordinates set or the route has no `start_stop`. Verified: a Django-shell integration test confirmed the Hungarian solver actually prefers the depot-proximate group when the weight is on, and a real-browser check confirmed both new UI pieces (the depot-location form on `VehicleGroupsPage.tsx`'s Manage modal, and the sixth weight input on `RosterGridPage.tsx`'s Rotation Policy panel) round-trip correctly through the real API.

### NamastePay payment integration — what it is and what's built

Each tenant (bus operator) gets their own NamastePay merchant account and must supply their own API key; all tenants call the *same* NamastePay API (shared base URLs, shared request/response shapes) — only the key differs per tenant. Scope for this pass, confirmed with the user: **credentials + gateway plumbing only** — no customer-facing checkout flow yet, because a codebase survey found `ticketing` today is issue-immediately (conductor/POS issues a ticket on the spot; `payment_method` is just a descriptive tag recorded afterward) with no passenger-facing purchase UI anywhere to hook a checkout into. That's a separate, later design question.

**Auth scheme corrected against NamastePay's real docs (2026-09-17)**: this was originally built as a guess (HTTP Basic with `client_id`/`client_secret`) before any real NamastePay documentation existed. The user later supplied NamastePay's actual checkout docs and Swagger UI, which showed a v1→v2 migration notice; fetching the real OpenAPI spec directly (`https://testpay.namastepay.com/api/v2/openapi.json`) confirmed auth is a single API key sent as the `X-API-KEY` header (generated via NamastePay's merchant portal), and that `initiate` takes `amount` (integer paisa, not decimal NPR), `reference_id`, `remarks`, and optional `amount_breakdown` — no `order_id`, `return_url`, or `customer` field exists on their side. `NamastePayConfig.client_id`/`client_secret` were renamed to a single `api_key` field (no real credentials were ever saved under the old ones, so this was a clean rename, not a data migration). Re-verified live: a dummy key now produces a real `403 Forbidden` from the correct `/api/v2/initiate` endpoint (previously got a `401` from what turned out to be the wrong, soon-to-be-deprecated v1 endpoint with the wrong auth scheme entirely).

Built (all in `backend/apps/ticketing/` except the settings entry):
- `NamastePayConfig` model — per-tenant singleton, `api_key` encrypted at rest via `django-encrypted-model-fields` (was an installed-but-unused dependency; now used for the first time in this codebase — confirmed the raw DB column is real Fernet ciphertext, not plaintext, via direct SQL inspection).
- `FIELD_ENCRYPTION_KEY` setting (`backend/config/settings/base.py`) — **has a real, working default value committed to this repo** so local dev works out of the box. **Production must override this via env var before any real NamastePay credentials are ever saved**, or the encryption provides no actual protection to anyone with repo read access. This is the single most important thing to do before this feature goes anywhere near production data.
- `namastepay.py` — the gateway client (`initiate_checkout`/`enquire_checkout`, `POST /api/v2/initiate`, `GET /api/v2/enquire/{checkout_id}`), auth via `X-API-KEY` header — confirmed against NamastePay's real OpenAPI v2 spec, not a guess anymore. `initiate_checkout` takes `amount` in NPR and converts to integer paisa internally, plus `reference_id`/`remarks`/optional `amount_breakdown` (no `return_url`/`customer` — NamastePay doesn't accept either; where a passenger lands post-payment is apparently a merchant-portal-side setting, worth confirming once a real account exists). Re-verified live: a dummy key produces a real `403 Forbidden` from `/api/v2/initiate`.
- Settings page **"Payment Integration"** (`frontend/src/apps/tenant-portal/pages/PaymentIntegrationPage.tsx`) — single API Key field, Environment/Active fields, a "Test Connection" button that does a real (tiny, throwaway) `initiate_checkout` call so a tenant can verify their own key the moment they have one. The key field is write-only end to end: the API never echoes the real value back (only `api_key_set: true/false`), and the frontend confirmed this holds across a real page reload in the browser.
- Endpoint gated `IsCompanyAdmin` (stricter than the general company-info settings page's `IsOperationsRole`, since this is payment credentials) — confirmed a non-admin role gets a clean `403`.
- `Ticket.PaymentMethod` and `accounting/signals.py`'s revenue-recognition map both already have a `NAMASTEPAY` entry, so a future purchase-flow implementation has nothing left to touch in the accounting layer.

Committed alongside Slice 5 in this update (was local-only as of the prior write-up).

**Important design constraint if/when the purchase flow gets built later**: `accounting/signals.py`'s `on_ticket_created` fires revenue recognition the instant *any* `ticketing.Ticket` row is created, unconditionally — there is no "pending payment" concept in `Ticket` today. Whatever builds the actual checkout flow must not create the `Ticket` row until `enquire_checkout()` confirms success server-side (never trust the `return_url` redirect's query-string status alone) — otherwise a merely-attempted or failed NamastePay payment would immediately post fake revenue.

### Production deploy status

**Everything through this update is deployed and live**, including Slice 5 (depot proximity), NamastePay, and the ticket reconciliation export — `git pull` → `docker compose -f docker-compose.prod.yml up -d --build django frontend` → `migrate_schemas` (applied `fleet.0008`, `roster.0004`, `ticketing.0003` cleanly) → `docker restart docker-nginx-1`, all confirmed clean, plus an external `curl` check confirming the site actually serves post-restart.

**`FIELD_ENCRYPTION_KEY` is now set correctly in production** — a real key was generated (`Fernet.generate_key()`, never left the server), added to `docker/.env`, and confirmed live via `docker exec docker-django-1 printenv FIELD_ENCRYPTION_KEY`. One real gap found and fixed while wiring this up: the key was in `.env` but not declared under `docker-compose.prod.yml`'s django service `environment:` block, so the container was silently ignoring it and falling back to the repo's committed dev default — fixed in `d2f54c77`, now also documented in `.env.example`. **Lesson for next time a new env var is added**: setting it in `.env` alone does nothing; it must also be added to the relevant service's `environment:` list in the compose file, and `docker compose up -d <service>` must report "Started"/"Recreated" (not just "Running") to confirm the container actually picked up the change.

**The earlier outbound-HTTPS TLS blocker on the production server is resolved** (was external to the server itself — a network/firewall issue between the box and the internet, not code, not this server's own firewall config; fixed outside of this session's actions). `git pull` and the full deploy sequence above completed successfully once it cleared. If it recurs, the same verification one-liner still applies:
```bash
for host in github.com google.com; do curl -sSf --max-time 15 -o /dev/null "https://$host" && echo "$host: OK" || echo "$host: FAILED"; done
```

**One real migration-state scare during that deploy, resolved safely**: after the rebuild, `migrate_schemas` hit `DuplicateTable: relation "fleet_vehiclegroup" already exists` on the 2nd of 4 tenant schemas and crashed. Rather than force anything, a read-only diagnostic (comparing `django_migrations` rows against `information_schema.tables` per schema) confirmed all 3 tenant schemas were already fully consistent — Postgres's transactional DDL had rolled the failed attempt back cleanly, and a re-run of `migrate_schemas` came back clean (4× "No migrations to apply"). Worth knowing if this symptom ever recurs: check consistency read-only before assuming corruption.

**Local dev container naming note**: this session's local dev stack uses container names prefixed `kvbms-` (`kvbms-django-1`, `kvbms-frontend-1`, etc.) — different from the `docker-` prefix (`docker-django-1`, `docker-nginx-1`) used in every production deploy command throughout this session and in this document's own §2. Both are correct, just for different compose projects (local dev vs. production) — don't mix them up when copy-pasting a command. Two stray `kvbms-`-prefixed containers (`kvbms-nginx-1`, `kvbms-frontend-1`) were also spotted sitting alongside the real `docker-*` production containers on the prod box itself — flagged, not yet investigated; worth checking whether they're leftover cruft from an earlier deploy attempt or something actually in use.

### Next steps

1. Get a real NamastePay TEST API key from their merchant portal (`https://testpay.namastepay.com/merchant`, login-only, no self-signup — contact `itd@ndpc.com.np` per their docs) to do one real end-to-end `initiate`/`enquire` call and confirm nothing else about the request shape was missed. The auth scheme and request/response fields are now confirmed against NamastePay's real OpenAPI v2 spec, not a guess.
2. Decide/scope the actual customer-facing ticket-purchase flow that would consume the NamastePay plumbing — needs a decision on where/how a passenger triggers a purchase in the first place, since no such UI exists anywhere today. Separately: Yatroo passengers will **not** use this — per `docs/YATROO_INTEGRATION_STATUS.md`, Yatroo collects payment on their own side and just sends us a `payment_reference`, already fully built. NamastePay is only relevant for a possible future KVBMS-native purchase flow, independent of Yatroo.
3. Remaining P3 items (crew hours, shared/syndicate routes) stay unscoped — crew-hours needs a policy decision, shared routes are out of v1 scope per the doc itself.
4. Add `route_id` to `Ticket` (nullable, same bare-UUID convention as `from_stop_id`/`trip_id`) and have the one POS issuance form (`TicketingPage.tsx`) send the route it already has selected — small, safe, additive. Doesn't give surge detection immediately (needs weeks of accumulated data once it starts capturing), but unblocks that clock and has standalone reporting value.
5. Investigate the two stray `kvbms-*` containers on the production box (see note above) — confirmed still running as of this deploy.
6. Yatroo integration: the code side is complete and tested (see `docs/YATROO_INTEGRATION_STATUS.md`) — the one blocker is an auth-design decision only Yatroo's team can make (§5 of that doc). Not actionable from this side until they respond.
