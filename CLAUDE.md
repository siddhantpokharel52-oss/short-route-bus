# KVBMS — Kathmandu Valley Bus Management System

## Project Overview
Production-grade, multi-tenant SaaS ERP for managing public bus operations in Nepal's Kathmandu Valley. Built on a Pathao/Uber-style transit platform with a Government Transport Authority portal and a full ERP for each bus operator (tenant).

## Architecture

```
├── backend/               Django + DRF + Channels + Celery
│   ├── apps/              17 Django apps (tenants, users, fleet, staff, …)
│   ├── fastapi_services/  GPS ingest microservice (500 events/sec)
│   └── config/            Settings, ASGI, Celery, URLs
├── frontend/              React 18 + TypeScript + Vite + Tailwind
│   └── src/apps/
│       ├── super-admin/   Platform admin portal
│       ├── tenant-portal/ Operator ERP portal
│       └── public/        Passenger-facing views
├── docker/                docker-compose + nginx
├── tests/                 pytest + Cypress
└── scripts/               seed_data.sh, create_tenant.sh
```

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Backend | Django 4.2, DRF, django-tenants 3.6.1 |
| Multi-tenancy | PostgreSQL schema-based (one schema per operator) |
| Auth | JWT (simplejwt) + RBAC (18 roles) + 2FA (TOTP) |
| Real-time | Django Channels + WebSocket |
| Queue | Celery + Redis (4 named queues) |
| GPS microservice | FastAPI + uvicorn (500 events/sec) |
| Frontend | React 18 + TypeScript + Vite |
| State | Zustand (auth, UI) + TanStack Query (server) |
| i18n | react-i18next (English + Nepali) |
| Calendar | Bikram Sambat (BS) ↔ Gregorian converter built-in |
| Payments | eSewa, Khalti, Fonepay, ConnectIPS, Cash |
| Monitoring | Prometheus + Grafana + Sentry |

## Quick Start

```bash
# 1. Clone and set up environment
cp .env.example .env
# Fill in all required values (see .env.example)

# 2. Start all services
cd docker && docker-compose up -d

# 3. Initialize database
docker exec -it kvbms_django python manage.py migrate_schemas --shared
docker exec -it kvbms_django python manage.py migrate_schemas

# 4. Seed initial data
bash scripts/seed_data.sh

# 5. Create a tenant
bash scripts/create_tenant.sh "Sajha Yatayat" sajha-yatayat STANDARD

# 6. Access
# Super Admin: http://localhost/super-admin  (admin@kvbms.com.np / Admin@123456)
# Public portal: http://localhost/
# API docs: http://localhost/api/docs/
```

## Multi-tenancy
- Each bus operator gets a **PostgreSQL schema** (e.g. `sajha_yatayat`)
- Subdomain routing: `sajha.kvbms.com.np` → `sajha_yatayat` schema
- Shared data (routes, stops, smart cards) lives in the `public` schema
- Cross-schema FK references use UUIDField (not Django FK) to avoid ORM limitations

## Roles (18 total)
**Platform:** SUPER_ADMIN, TRANSPORT_AUTHORITY, PLATFORM_ANALYST  
**Tenant:** COMPANY_ADMIN, COMPANY_MANAGER, DISPATCHER, DRIVER, CONDUCTOR, FINANCE_OFFICER, HR_OFFICER, MAINTENANCE_OFFICER, INVENTORY_OFFICER  
**Public:** PUBLIC_USER

## Running Tests

```bash
# Backend
cd backend
pytest --cov=backend --cov-report=html

# Frontend
cd frontend
npm test -- --coverage

# E2E
npx cypress run
```

## CI/CD
- **CI** (`.github/workflows/ci.yml`): runs on every PR — pytest (85% coverage), frontend tests, Docker build
- **Deploy** (`.github/workflows/deploy.yml`): pushes to Docker Hub, SSH deploy, migrate

## Key Business Rules
- **Max 8 hours/day** per driver enforced in auto-scheduler (Nepal Labour Act 2074)
- **Account lockout**: 5 failed logins → locked for 15 minutes
- **Super Admin requires 2FA** (TOTP via django-otp)
- **Commission rates**: BASIC=8%, STANDARD=6%, ENTERPRISE=4%
- **Payment gateway abstraction**: ABC base class — eSewa, Khalti, Fonepay, ConnectIPS, Cash
- **Smart card recharge**: atomic transaction, debit only if sufficient balance
- **Exclusive route assignment**: validated at serializer level
- **Speed alert**: GPS > 60 km/h triggers emergency notification
- **Document expiry**: automated nightly check via Celery

## Nepali Localization
- `src/utils/nepaliDate.ts` — full BS ↔ AD converter with lookup tables
- All dates toggle between AD and BS via calendar toggle in navbar
- NPR currency formatting with Nepali digit option
- `ne/` i18n namespace with all UI strings in Devanagari script
- Font: Noto Sans Devanagari loaded from Google Fonts

## Environment Variables
See `.env.example` for all required variables. Never commit `.env`.

## Monitoring
- **Prometheus**: `/metrics` endpoint on Django
- **Grafana**: `http://localhost:3001` (admin/admin by default)
- **Sentry**: automatic error capture in production
- **Health check**: `GET /health/`
