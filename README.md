# KVBMS — Kathmandu Valley Bus Management System

A management platform for short-route bus operations: fleet, scheduling, dispatch, ticketing, billing, and more.

## Stack

- **Backend:** Django (ASGI via Daphne) + Django REST apps under `backend/apps/`
- **Realtime/async services:** FastAPI (`backend/fastapi_services`)
- **Task queue:** Celery + Celery Beat, backed by Redis
- **Database:** PostgreSQL
- **Frontend:** React + TypeScript + Vite
- **Reverse proxy:** Nginx
- **Orchestration:** Docker Compose

### Backend apps

`accounting`, `analytics`, `billing`, `complaints`, `dispatch`, `documents`, `fleet`, `fuel`, `incidents`, `inventory`, `maintenance`, `notifications`, `platform`, `procurement`, `rbac`, `scheduling`, `staff`, `tenants`, `ticketing`, `users`

## Getting started (Docker)

1. Copy the env template and fill in values:
   ```bash
   cp .env.example .env
   cp .env.example docker/.env   # docker compose reads docker/.env
   ```
2. Start the stack:
   ```bash
   cd docker
   docker compose up -d
   ```
3. Services (default local ports):
   - Frontend: http://localhost:3002
   - Django API: http://localhost:8002
   - FastAPI service: http://localhost:8001
   - Nginx (reverse proxy): http://localhost:8090
   - Postgres: localhost:5435
   - Redis: localhost:6381

   Ports for Postgres, Redis, Django, Frontend, and Nginx are remapped from their defaults to avoid clashing with services that may already be running locally (e.g. a system Postgres/Redis/Apache on the host).

4. Check container status: `docker compose ps`

For production, use `docker/docker-compose.prod.yml` instead. Note: `nginx.conf` expects a real wildcard TLS certificate already present on the host at `/etc/letsencrypt/live/citybus.com.np/` — nginx will fail to start without it, and nothing in this repo obtains or renews it automatically (a one-time `certbot` DNS-01 step on the host is required first).

## API documentation

See **[`docs/API.md`](docs/API.md)** for the full reference — the master consumer API (`/public-api/v1/`, used by the Yatroo mobile app) is documented first, followed by the Django REST API and the internal FastAPI GPS/live-ops service. Auto-generated interactive docs (Swagger/ReDoc) are also available once the stack is running — see that file for exact URLs.

## Environment variables

See `.env.example` for the full list (Django secret keys, database, Redis, JWT, email, SMS/payment gateway keys, S3, Sentry, Baato Maps). `.env` files are git-ignored — never commit real secrets.

## Repository layout

```
backend/     Django project, apps, FastAPI services, requirements
frontend/    React + Vite SPA
docker/      Dockerfiles, docker-compose files, nginx config
docs/        Module devlogs and design notes
scripts/     Utility scripts
tests/       Test suites
```

## Development notes

- Backend dependencies are split by environment: `backend/requirements/{base,development,production}.txt`.
- Frontend scripts: `npm run dev`, `npm run build`, `npm run test`, `npm run lint` (see `frontend/package.json`).
- Static/media files (`backend/staticfiles`, `backend/media`) and `frontend/node_modules`/`frontend/dist` are generated/installed artifacts and are git-ignored.
