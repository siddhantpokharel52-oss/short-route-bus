"""KVBMS FastAPI Microservices — GPS, Live Ops, Public API."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from .gps.router import router as gps_router
from .live_ops.router import router as live_ops_router
from .public_api.router import router as public_router

app = FastAPI(
    title="KVBMS FastAPI Services",
    description="Real-time GPS tracking, Live operations, and Public API for Kathmandu Valley Bus Management System",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Instrumentator().instrument(app).expose(app, endpoint="/metrics")

app.include_router(gps_router, prefix="/api/v1/live", tags=["GPS & Live Operations"])
app.include_router(live_ops_router, prefix="/api/v1/live", tags=["Live Operations"])
app.include_router(public_router, prefix="/public-api/v1", tags=["Public API"])


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "kvbms-fastapi"}
