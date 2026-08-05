"""
/public-api/v1/partner/ -- server-to-server endpoint(s) for an external
partner's own backend (Yatroo first). Mounted under the same /public-api/v1/
URL prefix as the consumer-facing Master API purely for deployment
convenience -- nginx's mobile-api.citybus.com.np catch-all already rewrites
everything under that prefix to reach FastAPI, so this needed zero nginx
changes to go live (see docker/nginx/nginx.conf's history this same week for
exactly how costly a nginx path mismatch is to debug). It is NOT part of the
Master API's trust boundary: every request here is authenticated by an HMAC
signature (see _verify_signature), never a passenger/conductor JWT, and this
router's tag ("Partner Integration") is kept separate from "Public API" in
the OpenAPI schema so the two are never confused by a reader of /docs.

Wire format -- our own proposal, sent to Yatroo for confirmation, not yet
verified against a real signed request from their side:

  Headers: X-Signature, X-Timestamp, X-Nonce
  Body:    {"external_user_id": "...", "email": "...", "name": "..."}

  canonical_string = f"{timestamp}\\n{nonce}\\n{compact_json_body}"
  compact_json_body = json.dumps(body, sort_keys=True, separators=(",", ":"))
  signature = hex(HMAC_SHA256(YATROO_HMAC_SECRET, canonical_string))

Only one partner exists today (Yatroo), so the secret and the endpoint path
are both hardcoded to it rather than built out as a generic multi-partner
system nobody's asked for yet -- see settings.YATROO_HMAC_SECRET. The
Django-side account (apps.users.views.PartnerProvisionView) does store a
generic "partner" column, so adding a second partner later only means a new
secret + a second thin endpoint here, not a data-model change.
"""
import hashlib
import hmac
import json
import time
from typing import Optional

import httpx
import redis.asyncio as aioredis
from fastapi import APIRouter, Body, Depends, Header, HTTPException
from jose import jwt as jose_jwt

from ..config import settings
from ..dependencies import get_redis

router = APIRouter()


def _canonical_string(timestamp: str, nonce: str, body: dict) -> str:
    compact = json.dumps(body, sort_keys=True, separators=(",", ":"))
    return f"{timestamp}\n{nonce}\n{compact}"


@router.post("/federated-login")
async def federated_login(
    body: dict = Body(...),
    x_signature: Optional[str] = Header(None),
    x_timestamp: Optional[str] = Header(None),
    x_nonce: Optional[str] = Header(None),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Server-to-server only -- called by Yatroo's own backend, never by a
    mobile app directly. Verifies the HMAC-signed request (signature, a
    bounded timestamp window, and a one-time nonce), provisions or looks up
    a scoped passenger identity for the given external_user_id, and returns
    a normal passenger JWT -- indistinguishable downstream from a token
    issued by a real login, so every existing Master API endpoint just
    works against it unchanged."""
    if not (x_signature and x_timestamp and x_nonce):
        raise HTTPException(status_code=401, detail="Missing X-Signature/X-Timestamp/X-Nonce headers.")

    try:
        ts = int(x_timestamp)
    except ValueError:
        raise HTTPException(status_code=401, detail="X-Timestamp must be a Unix epoch integer.")
    if abs(time.time() - ts) > settings.FEDERATED_LOGIN_TIMESTAMP_WINDOW_SECONDS:
        raise HTTPException(status_code=401, detail="Timestamp outside the allowed window.")

    # Constant-time compare -- never a plain ==, so response timing can't be
    # used to guess the correct signature one byte at a time.
    expected = hmac.new(
        settings.YATROO_HMAC_SECRET.encode(),
        _canonical_string(x_timestamp, x_nonce, body).encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, x_signature):
        raise HTTPException(status_code=401, detail="Invalid signature.")

    # Nonce replay protection -- fails CLOSED on a Redis outage (unlike the
    # ticket-idempotency system elsewhere in this stack, which deliberately
    # fails open): idempotency is a UX nicety, replay protection on an auth
    # endpoint is a security control, and those two situations call for
    # opposite defaults.
    nonce_key = f"federated_login:nonce:{x_nonce}"
    try:
        claimed = await redis.set(nonce_key, "1", nx=True, ex=settings.FEDERATED_LOGIN_NONCE_TTL_SECONDS)
    except Exception:
        raise HTTPException(status_code=503, detail="Replay-protection store unavailable -- try again.")
    if not claimed:
        raise HTTPException(status_code=401, detail="Nonce already used.")

    external_user_id = str(body.get("external_user_id") or "").strip()
    if not external_user_id:
        raise HTTPException(status_code=400, detail="external_user_id is required.")
    email = str(body.get("email") or "").strip()
    name = str(body.get("name") or "").strip()

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{settings.DJANGO_INTERNAL_BASE_URL}/api/v1/auth/partner-provision/",
            headers={"X-Internal-Service-Key": settings.INTERNAL_SERVICE_KEY},
            json={"partner": "yatroo", "external_partner_id": external_user_id, "email": email, "name": name},
        )
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail="Account provisioning failed.")
    try:
        user_id = resp.json()["data"]["user_id"]
    except (ValueError, KeyError, TypeError):
        raise HTTPException(status_code=502, detail="Malformed response from account provisioning.")

    expiry_seconds = settings.FEDERATED_LOGIN_TOKEN_EXPIRY_SECONDS
    now = int(time.time())
    access_token = jose_jwt.encode(
        {
            "user_id": user_id,
            "role": "PASSENGER",
            "tenant_schema": "",
            "full_name": name,
            "language": "en",
            "iat": now,
            "exp": now + expiry_seconds,
        },
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )

    return {
        "success": True,
        "data": {"access_token": access_token, "expires_in": expiry_seconds, "citybus_user_id": user_id},
        "message": "Success",
        "errors": None,
    }
