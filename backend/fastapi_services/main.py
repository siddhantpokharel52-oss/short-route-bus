"""KVBMS FastAPI Microservices — GPS, Live Ops, Public API."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from .gps.router import router as gps_router
from .live_ops.router import router as live_ops_router
from .public_api.router import router as public_router
from .partner_api.router import router as partner_router
from .namastepay_api.router import router as namastepay_router

# Explicit order for the Swagger/ReDoc tag sections (no description text — see
# docs/API.md for the real reference instead). Without this, tags default to
# whatever order routers happen to be include_router()'d in below.
#
# public_router used to be registered as one flat "Public API" tag covering
# all 23 endpoints — unnavigable for anyone actually reading the docs. Each
# route there now carries its own "Public API — <domain>" tag instead (Auth,
# Routes & Fares, Trips, Tickets, NamastePay Payments, Reservations), listed
# explicitly here so they stay grouped together and in a sensible reading
# order rather than wherever FastAPI happens to encounter them first. These
# are the master consumer API the Yatroo mobile app actually integrates
# against, so they go first; Partner Integration and NamastePay Merchant
# Lookup are separate, narrower-audience routers and follow.
openapi_tags = [
    {"name": "Public API — Auth"},
    {"name": "Public API — Routes & Fares"},
    {"name": "Public API — Trips"},
    {"name": "Public API — Tickets"},
    {"name": "Public API — NamastePay Payments"},
    {"name": "Public API — Reservations"},
    {"name": "Partner Integration"},
    {"name": "NamastePay Merchant Lookup"},
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

# No tags= here -- every route inside public_api/router.py now sets its own
# "Public API — <domain>" tag (see that file). Adding a router-level tag on
# top would union with each route's own tag, making every operation show up
# twice in Swagger (once under this tag, once under its real one).
app.include_router(public_router, prefix="/public-api/v1")
# Same URL prefix as the Master API above -- deliberate, see partner_api/router.py's
# module docstring for why (avoids an nginx change to expose a second path shape).
# Separate tag keeps it visually distinct in /docs from the consumer-facing surface.
app.include_router(partner_router, prefix="/public-api/v1/partner", tags=["Partner Integration"])
# CB4 -- Namaste Pay's own server-to-server ticket lookup, see
# namastepay_api/router.py's module docstring for why this is a separate
# module rather than an addition to partner_api or public_api.
app.include_router(namastepay_router, prefix="/public-api/v1/namastepay", tags=["NamastePay Merchant Lookup"])
app.include_router(gps_router, prefix="/api/v1/live", tags=["GPS & Live Operations"], include_in_schema=False)
app.include_router(live_ops_router, prefix="/api/v1/live", tags=["Live Operations"], include_in_schema=False)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "kvbms-fastapi"}
