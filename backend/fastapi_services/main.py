"""KVBMS FastAPI Microservices — GPS, Live Ops, Public API."""
from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
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
# include_in_schema=False here on purpose -- NamastePay is a different
# integration partner from Yatroo (who the rest of this file's docs are
# written for), and handing them a link to this combined /api/docs page
# would expose the whole Yatroo-facing API surface just to document the one
# endpoint they actually need. The real route stays exactly here, fully
# functional at this exact URL -- only its appearance in THIS doc is hidden.
# Its own dedicated doc is built separately below.
app.include_router(
    namastepay_router, prefix="/public-api/v1/namastepay",
    tags=["NamastePay Merchant Lookup"], include_in_schema=False,
)
app.include_router(gps_router, prefix="/api/v1/live", tags=["GPS & Live Operations"], include_in_schema=False)
app.include_router(live_ops_router, prefix="/api/v1/live", tags=["Live Operations"], include_in_schema=False)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "kvbms-fastapi"}


# ── NamastePay's own, separate Swagger doc ──────────────────────────────────
# A dedicated doc for a single partner so they only ever see their own
# endpoint -- never the Yatroo-facing API surface above.
#
# Can't build this from app.routes directly: get_openapi()'s own path builder
# checks each route's include_in_schema flag and silently skips it if False
# -- the same flag we set above to hide this route from the MAIN docs also
# hides it from any other schema built from that same route object. So this
# is a second, throwaway inclusion of the identical router at the identical
# prefix, with include_in_schema left at its default (True) -- never
# mounted onto `app` itself, used only as a source of correctly-prefixed
# route objects for this one schema to be generated from.
_namastepay_docs_router = APIRouter()
_namastepay_docs_router.include_router(
    namastepay_router, prefix="/public-api/v1/namastepay", tags=["NamastePay Merchant Lookup"],
)


@app.get("/namastepay-openapi.json", include_in_schema=False)
async def namastepay_openapi():
    schema = get_openapi(
        title="CityBus -- NamastePay Integration API",
        version="1.0.0",
        description=(
            "Server-to-server ticket lookup NamastePay calls to render its "
            "dynamic QR (route, bus, amount, payable status) before the "
            "customer pays. This is the only endpoint this integration needs."
        ),
        routes=_namastepay_docs_router.routes,
    )
    return JSONResponse(schema)


@app.get("/namastepay-docs", include_in_schema=False)
async def namastepay_docs():
    return get_swagger_ui_html(
        openapi_url="/namastepay-openapi.json", title="CityBus -- NamastePay API Docs",
    )
