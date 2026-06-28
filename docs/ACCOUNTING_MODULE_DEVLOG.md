# Accounting Module — Development Log
**Project:** KVBMS (Kathmandu Valley Bus Management System)  
**Date:** 2026-06-21  
**Scope:** Full-stack accounting module — backend Django app + React frontend

---

## 1. What Was Built

A production-grade **double-entry accounting module** fully integrated with all bus operational events (ticketing, fuel, maintenance, salaries). Every transaction auto-generates balanced journal entries via Django signals.

---

## 2. Backend — Django App (`backend/apps/accounting/`)

### 2.1 Files Created

| File | Purpose |
|------|---------|
| `__init__.py` | App package init |
| `apps.py` | AppConfig — registers signals in `ready()` |
| `models.py` | 4 models: COA, JournalEntry, JournalEntryLine, SalaryPayment |
| `signals.py` | Auto-journal entry triggers from operational events |
| `serializers.py` | DRF serializers with validation |
| `views.py` | ViewSets + 8 report API views |
| `urls.py` | Router + report URL patterns |
| `migrations/0001_initial.py` | Hand-written initial migration |
| `migrations/0002_rename_*.py` | Auto-generated index rename (Django format) |
| `management/commands/seed_coa.py` | Seeds 53 accounts across all tenant schemas |

### 2.2 Models

#### `ChartOfAccount`
```
UUID pk · code (unique) · name · account_type (ASSET/LIABILITY/EQUITY/INCOME/EXPENSE)
parent (self FK, PROTECT) · is_system · is_active · balance (Decimal, cached)
```
- `is_debit_normal` property → True for ASSET & EXPENSE

#### `JournalEntry`
```
UUID pk · entry_no (auto: "JE-20240101-0001") · date · description
status (DRAFT/POSTED/REVERSED) · source_type (MANUAL/TICKET/FUEL/MAINTENANCE/SALARY/…)
source_id (UUID nullable) · reference_no · reversed_entry (OneToOne self)
```

#### `JournalEntryLine`
```
UUID pk · journal_entry (FK) · account (FK COA) · description
debit (Decimal) · credit (Decimal) · vehicle_id (UUID) · route_id (UUID)
```

#### `SalaryPayment`
```
UUID pk · employee_id · employee_name · employee_type (DRIVER/CONDUCTOR/STAFF)
period_from · period_to · payment_date · basic_salary · total_allowances
deductions · net_pay · payment_method · status (DRAFT/PAID) · journal_entry (OneToOne)
```

### 2.3 Auto-Journaling Signal Map

| Trigger | Dr | Cr |
|---------|----|----|
| `ticketing.Ticket` saved (cash) | Cash in Hand (1110) | Ticket Revenue (4100) |
| `ticketing.Ticket` saved (digital) | Cash at Bank (1120) | Ticket Revenue (4100) |
| `fuel.FuelCost` saved | Fuel Expense (5100) | AP – Fuel Supplier (2110) |
| `maintenance.ServiceRecord` completed | Maintenance (5200) | AP – Vendor (2120) |
| `SalaryPayment` → PAID (Driver) | Driver Salary (5300) + Allowances (5310) | Cash (1110) ± Salaries Payable (2130) |
| `SalaryPayment` → PAID (Conductor) | Conductor Salary (5400) + Allowances (5410) | Cash (1110) ± Salaries Payable (2130) |

### 2.4 API Endpoints

```
GET/POST   /api/v1/accounting/accounts/
GET        /api/v1/accounting/accounts/tree/
GET        /api/v1/accounting/accounts/by_type/
GET/POST   /api/v1/accounting/journal-entries/
POST       /api/v1/accounting/journal-entries/{id}/post/
POST       /api/v1/accounting/journal-entries/{id}/reverse/
GET/POST   /api/v1/accounting/salary-payments/
POST       /api/v1/accounting/salary-payments/{id}/pay/
GET        /api/v1/accounting/dashboard/
GET        /api/v1/accounting/reports/general-ledger/
GET        /api/v1/accounting/reports/trial-balance/
GET        /api/v1/accounting/reports/profit-loss/
GET        /api/v1/accounting/reports/balance-sheet/
GET        /api/v1/accounting/reports/cash-flow/
GET        /api/v1/accounting/reports/income-by-route/
GET        /api/v1/accounting/reports/expense-analysis/
```

### 2.5 Chart of Accounts (53 accounts seeded)

```
1000  Assets
  1100  Current Assets
    1110  Cash in Hand
    1120  Cash at Bank
    1130  AR – Ticket Agents
    1140  AR – Corporate Clients
    1150  Fuel Inventory
    1160  Spare Parts Inventory
    1170  Prepaid Expenses
  1200  Fixed Assets
    1210  Bus Fleet – Cost
    1220  Accum. Depreciation – Bus Fleet
    1230  Office Equipment
    1240  Depot & Building
    1250  Furniture & Fixtures

2000  Liabilities
  2100  Current Liabilities
    2110  AP – Fuel Suppliers
    2120  AP – Maintenance Vendors
    2130  Salaries Payable
    2140  Tax Payable
    2150  Advance Fares Collected
  2200  Long-Term Liabilities
    2210  Loan – Bus Purchase
    2220  Lease Obligations

3000  Equity
  3100  Owner's Capital
  3200  Retained Earnings
  3300  Current Year Earnings
  3400  Drawings

4000  Income
  4100  Ticket Sales Revenue
  4200  Monthly Pass Revenue
  4300  Daily Pass Revenue
  4400  Student Pass Revenue
  4500  Smart Card Revenue
  4600  Advertising Revenue
  4700  Charter & Rental Income
  4800  Government Subsidy Income
  4900  Other Income

5000  Expenses
  5100  Fuel Expenses
  5200  Bus Maintenance & Repairs
  5300  Driver Salaries
  5310  Driver Allowances
  5400  Conductor Salaries
  5410  Conductor Allowances
  5500  Depreciation – Bus Fleet
  5600  Depot Operating Costs
  5700  Insurance Expenses
  5800  Administrative Expenses
  5900  Finance Charges
  5910  Tax Expense
```

### 2.6 Seed Command

```bash
# Seed all active tenants
docker exec kvbms_django python manage.py seed_coa --all-tenants

# Seed a specific tenant
docker exec kvbms_django python manage.py seed_coa --schema=sajha_yatayat
```

### 2.7 Settings Changes

**`backend/config/settings/base.py`** — added to `TENANT_APPS`:
```python
"backend.apps.accounting",
```

**`backend/config/urls.py`** — added:
```python
path("api/v1/accounting/", include("backend.apps.accounting.urls")),
```

---

## 3. Frontend — React (`frontend/src/apps/tenant-portal/pages/AccountingPage.tsx`)

### 3.1 Tabs

| Tab | Content |
|-----|---------|
| **Overview** | MTD hero banner (Revenue/Expenses/Net Profit) + 3 balance sheet KPI cards + Auto-journaling mapping cards |
| **Chart of Accounts** | Expandable tree table with code, name, type badge, balance, system flag |
| **Journal Entries** | Searchable table with expand-to-lines, Post & Reverse actions |
| **Salary Payments** | Employee table with avatar initials, salary breakdown, Mark Paid button |
| **Reports** | 6-card report type selector + date range + rendered output |

### 3.2 Reports Available

| Report | Endpoint | Date Params |
|--------|----------|-------------|
| Profit & Loss | `reports/profit-loss/` | `date_from`, `date_to` |
| Balance Sheet | `reports/balance-sheet/` | `date` (as-of) |
| Trial Balance | `reports/trial-balance/` | `date` (as-of) |
| Cash Flow | `reports/cash-flow/` | `date_from`, `date_to` |
| Expense Analysis | `reports/expense-analysis/` | `date_from`, `date_to` |
| General Ledger | `reports/general-ledger/` | `date_from`, `date_to`, `account_id` |

### 3.3 Router & Nav Integration

**`TenantApp.tsx`**
```tsx
import AccountingPage from './pages/AccountingPage'

// Role guard
'/tenant/accounting': ['COMPANY_ADMIN', 'COMPANY_MANAGER', 'FINANCE_OFFICER'],

// Route
<Route path="accounting" element={<AccountingPage />} />
```

**`TenantLayout.tsx`**
```tsx
import { BookOpen } from 'lucide-react'

{ to: '/tenant/accounting', icon: BookOpen, label: 'Accounting' }
// Added between Analytics and Settings
```

---

## 4. Bugs Fixed

### 4.1 `ReferenceError: Ticket is not defined` (runtime)
**File:** `AccountingPage.tsx`  
**Cause:** `Ticket` icon from `lucide-react` was used in the auto-journaling legend array but missing from the import statement.  
**Fix:** Added `Ticket` to the lucide-react import.

### 4.2 Migration index name mismatch
**Cause:** Hand-written `0001_initial.py` used custom index names (`accounting_coa_type_idx`). Django's `check` detected mismatch.  
**Fix:** Ran `makemigrations accounting` → Django auto-generated `0002_rename_*.py` with proper rename operations.

### 4.3 `relation "accounting_chartofaccount" does not exist` (seed command)
**Cause:** `seed_coa --all-tenants` looped over all tenants including `public` schema which has no accounting tables.  
**Fix:** Added `.exclude(schema_name="public")` filter to the tenant queryset in the seed command.

### 4.4 `apiClient` import path error (Vite build)
**Cause:** Import was `@services/apiClient` but the file is `@services/api`.  
**Fix:** Changed to `import apiClient from '@services/api'`.

---

## 5. UI Design Decisions

### Color System
- **All primary action buttons:** `bg-primary-600` (system blue) — matches existing "Add Route" button
- **Icon containers:** `bg-primary-600` with `text-white` — used consistently everywhere
- **Card backgrounds:** White (`bg-white`) — no colored card backgrounds
- **Text:** Black / `text-gray-900` for values, `text-gray-400` for labels
- **Status badges:** Semantic colors kept (emerald=Posted/Paid, amber=Draft, gray=Reversed)
- **Dr/Cr ledger columns:** Blue for debit, emerald for credit (accounting convention)

### Modal Design
- **Journal Entry modal:** `from-primary-600 to-primary-700` gradient header
- **Salary modal:** Same `from-primary-600 to-primary-700` gradient header (changed from violet)
- **Net Pay box:** `bg-primary-50` / `border-primary-200` (changed from violet)
- Line items in a bordered table container; debit fields highlight blue when filled, credit fields highlight emerald

### Overview Tab Layout
```
┌──────────────────────────────────────────────────┐
│  MTD Summary (white card)                         │
│  [📈 Icon] Revenue | [📉 Icon] Expenses | [📊 Icon] Net Profit │
└──────────────────────────────────────────────────┘
┌──────────┐  ┌──────────────────┐  ┌──────────────┐
│ [💼] Cash│  │ [↕] AR           │  │ [💳] AP      │
│ Balance  │  │ Receivable       │  │ Payable      │
└──────────┘  └──────────────────┘  └──────────────┘
┌──────────────────────────────────────────────────┐
│  Automatic Journal Entry Mapping                  │
│  [🎟️] Ticket Sale  [⛽] Fuel  [🔧] Maintenance  [👥] Salary │
│  Dr → ...          Dr → ...   Dr → ...           Dr → ...   │
│  Cr → ...          Cr → ...   Cr → ...           Cr → ...   │
└──────────────────────────────────────────────────┘
```

---

## 6. Key Business Rules Implemented

- **Double-entry enforced:** Serializer validates `sum(debit) == sum(credit)` on every journal entry
- **Duplicate JE guard:** Signals check `source_id` before creating to prevent double-booking on repeated saves
- **Salary signal guard:** Uses `.update()` (not `.save()`) when linking JE back to SalaryPayment to avoid re-triggering the signal
- **System accounts protected:** COA `destroy()` blocks deletion of `is_system=True` accounts
- **Posted entries immutable:** Only DRAFT entries can be posted; only POSTED entries can be reversed

---

## 7. Run Commands Reference

```bash
# Apply migrations to all tenant schemas
docker exec kvbms_django python manage.py migrate_schemas --tenant

# Seed COA for all tenants
docker exec kvbms_django python manage.py seed_coa --all-tenants

# Frontend build check
cd frontend && npx vite build

# Frontend dev server
cd frontend && npm run dev
```

---

## 8. File Index

```
backend/apps/accounting/
├── __init__.py
├── apps.py
├── models.py
├── serializers.py
├── signals.py
├── urls.py
├── views.py
├── migrations/
│   ├── 0001_initial.py
│   └── 0002_rename_indexes.py
└── management/commands/
    └── seed_coa.py

frontend/src/apps/tenant-portal/
├── pages/AccountingPage.tsx          ← Main file (all 5 tabs)
├── TenantApp.tsx                     ← Route + role guard added
└── components/TenantLayout.tsx       ← Nav item added

backend/config/
├── settings/base.py                  ← TENANT_APPS updated
└── urls.py                           ← accounting URL included
```
