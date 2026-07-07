# KVBMS System Handover

**Kathmandu Valley Bus Management System** — a multi-tenant SaaS for bus operators, with a public-facing site, a platform Super Admin portal, and a per-operator Tenant Portal. This document captures the state of the project after an extended work session so a future session can continue without re-deriving context.

Written: 2026-07-06.

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
