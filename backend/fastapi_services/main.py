"""KVBMS FastAPI Microservices — GPS, Live Ops, Public API."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from .gps.router import router as gps_router
from .live_ops.router import router as live_ops_router
from .public_api.router import router as public_router

# Explicit order for the Swagger/ReDoc tag sections (no description text — see
# docs/API.md for the real reference instead). Without this, tags default to
# whatever order routers happen to be include_router()'d in below — "Public API"
# (the master consumer API the Yatroo mobile app actually integrates against)
# is the one external clients care about, so it goes first; the rest are
# internal/staff-facing and follow.
openapi_tags = [
    {"name": "Public API"},
    {"name": "GPS & Live Operations"},
    {"name": "Live Operations"},
]

app = FastAPI(
    title="KVBMS FastAPI Services",
    description="Real-time GPS tracking, Live operations, and Public API for Kathmandu Valley Bus Management System",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    openapi_tags=openapi_tags,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Instrumentator().instrument(app).expose(app, endpoint="/metrics")

# Registration order also matches openapi_tags above (Public API first) —
# redundant with the explicit tag order once set, but keeps the two in sync
# for anyone skimming just this file.
app.include_router(public_router, prefix="/public-api/v1", tags=["Public API"])
app.include_router(gps_router, prefix="/api/v1/live", tags=["GPS & Live Operations"], include_in_schema=False)
app.include_router(live_ops_router, prefix="/api/v1/live", tags=["Live Operations"], include_in_schema=False)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "kvbms-fastapi"}
