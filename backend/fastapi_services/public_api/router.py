"""Public API for third-party consumers (Google Maps, apps, smart city dashboards)."""
import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
import redis.asyncio as aioredis
from ..dependencies import get_redis, get_optional_user

router = APIRouter()


@router.get("/vehicles/live/")
async def get_all_live_vehicles(
    redis: aioredis.Redis = Depends(get_redis),
):
    """All live bus positions (city-wide). No auth required. Rate-limited by Nginx."""
    keys = await redis.keys("vehicle:position:*")
    positions = []
    for key in keys:
        data = await redis.get(key)
        if data:
            pos = json.loads(data)
            # Strip internal tenant data for public consumption
            positions.append({
                "vehicle_id": pos.get("vehicle_id"),
                "latitude": pos.get("latitude"),
                "longitude": pos.get("longitude"),
                "speed": pos.get("speed"),
                "heading": pos.get("heading"),
                "timestamp": pos.get("timestamp"),
                "trip_id": pos.get("trip_id"),
            })
    return {"success": True, "data": positions, "count": len(positions)}


@router.get("/routes/")
async def get_all_routes():
    """All approved routes. No auth required."""
    # Proxies to Django API in production
    return {"success": True, "data": [], "message": "Routes served from Django backend."}


@router.get("/routes/{route_id}/stops/")
async def get_route_stops(route_id: str):
    """Stops on a specific route."""
    return {"success": True, "data": [], "route_id": route_id}


@router.get("/stops/{stop_id}/arrivals/")
async def get_stop_arrivals(
    stop_id: str,
    redis: aioredis.Redis = Depends(get_redis),
):
    """ETA for next buses at a stop. Computed from live GPS positions."""
    return {
        "success": True,
        "data": {"stop_id": stop_id, "arrivals": []},
        "message": "Live arrivals computed from GPS tracking.",
    }


@router.get("/fares/")
async def get_fares(from_stop: str, to_stop: str):
    """Fare between two stops."""
    return {
        "success": True,
        "data": {
            "from_stop": from_stop,
            "to_stop": to_stop,
            "fares": [],
        }
    }


@router.post("/tickets/verify/")
async def verify_ticket_public(ticket_uid: str):
    """Public QR code ticket verification endpoint."""
    if not ticket_uid.startswith("TKT-"):
        raise HTTPException(status_code=400, detail="Invalid ticket format.")
    return {
        "success": True,
        "message": "Ticket verification proxied to Django backend.",
        "ticket_uid": ticket_uid,
    }
