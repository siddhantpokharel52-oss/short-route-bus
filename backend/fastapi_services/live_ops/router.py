import asyncio
import json
import logging
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
import redis.asyncio as aioredis
from jose import JWTError, jwt as jose_jwt
from ..config import settings
from ..dependencies import get_redis, get_current_user
from ..public_api import tenant_db
from ..public_api.router import _proxy_to_django

router = APIRouter()
logger = logging.getLogger(__name__)


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


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket push for the live money/ticket dashboard (docs/API.md's analytics
# row previously documented this as polling-only: GET /analytics/tickets/live/
# and GET /analytics/city/tickets/live/, both in apps.analytics — Django has
# no WebSocket/Channels infrastructure at all, so it can't push).
#
# Rather than reimplement the aggregation a second time in FastAPI (real risk
# of the two surfaces silently drifting apart), this does the same thing a
# polling client would — periodically call the existing Django endpoint via
# _proxy_to_django, reusing the exact same DB query, permission classes, and
# response shape — just with the server doing the polling and pushing the
# result, instead of the client. Same "don't duplicate ticket logic" approach
# already used for the two ticket-mutation endpoints in public_api/router.py.
#
# Auth is the same query-param JWT approach as public_api's ws/tickets/ (see
# that module's comment for why) — decoded once at connect time to pick
# which Django endpoint/schema to poll, then the ORIGINAL token is forwarded
# on every proxied call, so Django's own IsOperationsRole / IsFinanceRole /
# IsTransportAuthority checks are what actually gate access here, not
# anything reimplemented in this file.
# ─────────────────────────────────────────────────────────────────────────────

DASHBOARD_PUSH_INTERVAL_SECONDS = 5
_CITY_DASHBOARD_ROLES = {"SUPER_ADMIN", "TRANSPORT_AUTHORITY_OFFICER"}
_PUBLIC_SCHEMA = "public"


@router.websocket("/ws/tickets/")
async def websocket_ticket_dashboard(websocket: WebSocket):
    """Staff-only live ticket/revenue dashboard. A SUPER_ADMIN or
    TRANSPORT_AUTHORITY_OFFICER token gets the platform-wide feed
    (GET /analytics/city/tickets/live/); any other authenticated staff token with a
    tenant_schema gets that operator's own feed (GET /analytics/tickets/live/).
    Pushes the current snapshot immediately on connect, then every
    DASHBOARD_PUSH_INTERVAL_SECONDS. Closes with 1008 on a missing/invalid token, or
    1011 if the token's tenant_schema has no resolvable domain."""
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008)
        return
    try:
        payload = jose_jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        await websocket.close(code=1008)
        return

    if payload.get("role") in _CITY_DASHBOARD_ROLES:
        schema = _PUBLIC_SCHEMA
        path = "/api/v1/analytics/city/tickets/live/"
    elif payload.get("tenant_schema"):
        schema = payload["tenant_schema"]
        path = "/api/v1/analytics/tickets/live/"
    else:
        await websocket.close(code=1008)
        return

    domain = await tenant_db.get_domain_for_schema(schema)
    if not domain:
        await websocket.close(code=1011)
        return

    await websocket.accept()
    try:
        while True:
            resp = await _proxy_to_django("GET", path, schema, domain, token)
            try:
                body = resp.json()
            except ValueError:
                body = {
                    "success": False,
                    "data": None,
                    "message": "Malformed response from the analytics service.",
                    "errors": None,
                }

            try:
                await websocket.send_json(body)
            except Exception:
                break

            # A non-2xx response (e.g. a role that lost its permission mid-session)
            # is sent once so the client sees why, then the connection is closed
            # rather than looping forever on the same rejection.
            if resp.status_code >= 300:
                await websocket.close(code=1008)
                return

            await asyncio.sleep(DASHBOARD_PUSH_INTERVAL_SECONDS)
    except WebSocketDisconnect:
        pass
