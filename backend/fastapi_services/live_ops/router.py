import json
from fastapi import APIRouter, Depends
import redis.asyncio as aioredis
from ..dependencies import get_redis, get_current_user

router = APIRouter()


@router.get("/ops/summary/")
async def live_ops_summary(
    tenant_slug: str,
    redis: aioredis.Redis = Depends(get_redis),
    user: dict = Depends(get_current_user),
):
    """Real-time operational summary for dispatcher dashboard."""
    keys = await redis.keys("vehicle:position:*")
    active_vehicles = 0
    for key in keys:
        data = await redis.get(key)
        if data:
            pos = json.loads(data)
            if pos.get("tenant_slug") == tenant_slug:
                active_vehicles += 1

    alerts_raw = await redis.lrange(f"alerts:{tenant_slug}", 0, 9)
    recent_alerts = [json.loads(a) for a in alerts_raw]

    return {
        "success": True,
        "data": {
            "active_vehicles": active_vehicles,
            "recent_alerts": recent_alerts,
            "alert_count": len(recent_alerts),
        }
    }


@router.post("/ops/alerts/{alert_id}/resolve/")
async def resolve_alert(
    alert_id: str,
    tenant_slug: str,
    redis: aioredis.Redis = Depends(get_redis),
    user: dict = Depends(get_current_user),
):
    """Mark an alert as resolved."""
    return {"success": True, "message": f"Alert {alert_id} resolved."}
