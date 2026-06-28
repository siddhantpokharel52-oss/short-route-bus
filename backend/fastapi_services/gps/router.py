import json
import math
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import JSONResponse
import redis.asyncio as aioredis
from ..dependencies import get_redis, get_current_user, get_optional_user
from ..config import settings
from .schemas import GPSEvent, GPSEventResponse, VehiclePosition, LiveAlert

router = APIRouter()

# Connection manager for WebSocket broadcast
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, group: str):
        await websocket.accept()
        if group not in self.active_connections:
            self.active_connections[group] = []
        self.active_connections[group].append(websocket)

    def disconnect(self, websocket: WebSocket, group: str):
        if group in self.active_connections:
            self.active_connections[group].remove(websocket)

    async def broadcast(self, message: dict, group: str):
        if group not in self.active_connections:
            return
        dead = []
        for ws in self.active_connections[group]:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.active_connections[group].remove(ws)


manager = ConnectionManager()


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two GPS coordinates in meters."""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


@router.post("/gps/ingest/", response_model=GPSEventResponse)
async def ingest_gps(
    event: GPSEvent,
    redis: aioredis.Redis = Depends(get_redis),
):
    """GPS device pushes location data here. Rate: 500 events/sec target."""
    alerts = []

    # Store latest position in Redis
    position_key = f"vehicle:position:{event.vehicle_id}"
    position_data = {
        "vehicle_id": event.vehicle_id,
        "tenant_slug": event.tenant_slug,
        "latitude": event.latitude,
        "longitude": event.longitude,
        "speed": event.speed,
        "heading": event.heading,
        "timestamp": event.timestamp.isoformat(),
        "trip_id": event.trip_id,
    }
    await redis.setex(position_key, 300, json.dumps(position_data))

    # Store in time-series list
    ts_key = f"vehicle:ts:{event.vehicle_id}"
    await redis.lpush(ts_key, json.dumps(position_data))
    await redis.ltrim(ts_key, 0, 999)
    await redis.expire(ts_key, 86400)

    # Speed check
    if event.speed > settings.SPEED_ALERT_THRESHOLD_KMH:
        alert = {
            "type": "SPEEDING",
            "vehicle_id": event.vehicle_id,
            "speed": event.speed,
            "threshold": settings.SPEED_ALERT_THRESHOLD_KMH,
            "timestamp": event.timestamp.isoformat(),
        }
        await redis.lpush(f"alerts:{event.tenant_slug}", json.dumps(alert))
        alerts.append(f"SPEEDING: {event.speed:.1f} km/h")
        await manager.broadcast({"type": "alert", "data": alert}, f"fleet_{event.tenant_slug}")

    # Broadcast live position
    await manager.broadcast(position_data, f"fleet_{event.tenant_slug}")
    if event.trip_id:
        await manager.broadcast(position_data, f"trip_{event.trip_id}")

    return GPSEventResponse(
        success=True,
        message="GPS event recorded",
        alerts=alerts,
    )


@router.get("/vehicles/", response_model=List[VehiclePosition])
async def get_vehicle_positions(
    tenant_slug: Optional[str] = None,
    redis: aioredis.Redis = Depends(get_redis),
    user: dict = Depends(get_current_user),
):
    """Snapshot of all current vehicle positions."""
    pattern = f"vehicle:position:{tenant_slug}:*" if tenant_slug else "vehicle:position:*"
    keys = await redis.keys("vehicle:position:*")
    positions = []
    for key in keys:
        data = await redis.get(key)
        if data:
            pos = json.loads(data)
            if not tenant_slug or pos.get("tenant_slug") == tenant_slug:
                positions.append(VehiclePosition(**pos))
    return positions


@router.get("/alerts/active/")
async def get_active_alerts(
    tenant_slug: str,
    redis: aioredis.Redis = Depends(get_redis),
    user: dict = Depends(get_current_user),
):
    """Get active (unresolved) alerts for a tenant."""
    alerts_raw = await redis.lrange(f"alerts:{tenant_slug}", 0, 49)
    alerts = [json.loads(a) for a in alerts_raw]
    return {"success": True, "data": alerts, "count": len(alerts)}


@router.websocket("/ws/vehicles/{tenant_slug}/")
async def websocket_vehicle_positions(
    websocket: WebSocket,
    tenant_slug: str,
):
    """WebSocket: live vehicle positions for a tenant."""
    group = f"fleet_{tenant_slug}"
    await manager.connect(websocket, group)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, group)


@router.websocket("/ws/trips/{trip_id}/")
async def websocket_trip_tracking(
    websocket: WebSocket,
    trip_id: str,
):
    """WebSocket: single trip live tracking."""
    group = f"trip_{trip_id}"
    await manager.connect(websocket, group)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, group)


@router.post("/gps/simulate/")
async def simulate_gps(
    tenant_slug: str,
    vehicle_ids: List[str],
    route_coords: Optional[List[dict]] = None,
    redis: aioredis.Redis = Depends(get_redis),
):
    """
    Inject simulated GPS positions for demo/testing.
    Spreads vehicles along the given route coordinates.
    POST /api/v1/live/gps/simulate/?tenant_slug=sajha-yatayat
    Body: { vehicle_ids: ["uuid1","uuid2"], route_coords: [{lat,lng},...] }
    """
    import random
    from datetime import timezone as tz

    if not route_coords:
        # Default: simulate in Kathmandu Valley
        route_coords = [
            {"lat": 27.7172, "lng": 85.3240},  # Ratnapark
            {"lat": 27.7120, "lng": 85.3100},  # Jamal
            {"lat": 27.7080, "lng": 85.2940},  # Sorhakhutte
            {"lat": 27.7040, "lng": 85.2800},  # Balaju
            {"lat": 27.6990, "lng": 85.2700},  # Kalanki
        ]

    simulated = []
    n = len(route_coords)
    for i, vid in enumerate(vehicle_ids):
        coord_idx = (i * max(1, n // len(vehicle_ids))) % n
        coord = route_coords[coord_idx]
        # Add slight jitter
        lat = coord["lat"] + random.uniform(-0.001, 0.001)
        lng = coord["lng"] + random.uniform(-0.001, 0.001)
        speed = random.uniform(15, 45)
        heading = random.uniform(0, 360)

        position_data = {
            "vehicle_id": vid,
            "tenant_slug": tenant_slug,
            "latitude": lat,
            "longitude": lng,
            "speed": speed,
            "heading": heading,
            "timestamp": datetime.utcnow().replace(tzinfo=tz.utc).isoformat(),
            "trip_id": None,
        }
        key = f"vehicle:position:{vid}"
        await redis.setex(key, 300, json.dumps(position_data))
        # Append to time series
        ts_key = f"vehicle:ts:{vid}"
        await redis.lpush(ts_key, json.dumps(position_data))
        await redis.ltrim(ts_key, 0, 999)
        await redis.expire(ts_key, 86400)

        # Broadcast to fleet WebSocket group
        await manager.broadcast(position_data, f"fleet_{tenant_slug}")
        simulated.append({"vehicle_id": vid, "lat": lat, "lng": lng, "speed": speed})

    return {"success": True, "message": f"Simulated {len(simulated)} vehicles", "data": simulated}


@router.post("/geofences/")
async def create_geofence(
    zone_name: str,
    polygon_geojson: dict,
    zone_type: str,
    redis: aioredis.Redis = Depends(get_redis),
    user: dict = Depends(get_current_user),
):
    """Create a geofence zone."""
    key = f"geofence:{zone_name}"
    data = {"zone_name": zone_name, "polygon_geojson": polygon_geojson, "zone_type": zone_type}
    await redis.set(key, json.dumps(data))
    return {"success": True, "message": f"Geofence '{zone_name}' created."}
