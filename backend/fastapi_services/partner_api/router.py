"""
/public-api/v1/partner/ -- server-to-server endpoint(s) for external partner
backends (Yatroo first, more later). Mounted under the same /public-api/v1/
URL prefix as the consumer-facing Master API purely for deployment
convenience -- nginx's mobile-api.citybus.com.np catch-all already rewrites
everything under that prefix to reach FastAPI, so this needed zero nginx
changes to go live (see docker/nginx/nginx.conf's history this same week for
exactly how costly a nginx path mismatch is to debug). It is NOT part of the
Master API's trust boundary: every request here is authenticated by an HMAC
signature, never a passenger/conductor JWT, and this router's tag ("Partner
Integration") is kept separate from "Public API" in the OpenAPI schema so
the two are never confused by a reader of /docs.

Wire format -- our own proposal, sent to Yatroo for confirmation, not yet
verified against a real signed request from their side:

  Headers: X-Partner, X-Signature, X-Timestamp, X-Nonce
  Body:    {"external_user_id": "...", "email": "...", "name": "..."}

  canonical_string = f"{timestamp}\\n{nonce}\\n{compact_json_body}"
  compact_json_body = json.dumps(body, sort_keys=True, separators=(",", ":"))
  signature = hex(HMAC_SHA256(secret_for(x_partner), canonical_string))

secret_for() is a lookup into settings.PARTNER_HMAC_SECRETS (one JSON env
var, {"yatroo": "...", ...}) -- adding a second partner is a config change
plus telling them to send their own X-Partner value, not a code change. The
Django-side account (apps.users.views.PartnerProvisionView) already stores
a generic "partner" column and was never Yatroo-specific.
"""
import hashlib
import hmac
import json
import logging
import time
from typing import Optional

import httpx
import redis.asyncio as aioredis
from fastapi import APIRouter, Body, Depends, Header, HTTPException
from jose import jwt as jose_jwt

from ..config import settings
from ..dependencies import get_redis

router = APIRouter()
logger = logging.getLogger(__name__)


def _canonical_string(timestamp: str, nonce: str, body: dict) -> str:
    compact = json.dumps(body, sort_keys=True, separators=(",", ":"))
    return f"{timestamp}\n{nonce}\n{compact}"


def _log(partner: str, success: bool, reason: str, external_user_id: str = "") -> None:
    """One line per attempt, exactly what's asked for (partner, outcome, reason)
    and nothing that shouldn't be there -- never the secret, the signature, or
    the access_token. external_user_id is logged (it's an identifier, not a
    credential) since it's the only thing that makes a failed attempt
    traceable back to a specific partner-side user during support/debugging."""
    level = logger.info if success else logger.warning
    level(
        "federated_login partner=%s success=%s reason=%s external_user_id=%s",
        partner or "<missing>", success, reason, external_user_id or "<unknown>",
    )


@router.post("/federated-login")
async def federated_login(
    body: dict = Body(...),
    x_partner: Optional[str] = Header(None),
    x_signature: Optional[str] = Header(None),
    x_timestamp: Optional[str] = Header(None),
    x_nonce: Optional[str] = Header(None),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Server-to-server only -- called by a partner's own backend, never by a
    mobile app directly. Verifies the HMAC-signed request (per-partner
    signature, a bounded timestamp window, and a one-time nonce), provisions
    or looks up a scoped passenger identity for the given external_user_id,
    and returns a normal passenger JWT -- indistinguishable downstream from a
    token issued by a real login, so every existing Master API endpoint just
    works against it unchanged."""
    external_user_id = str(body.get("external_user_id") or "").strip()

    if not (x_partner and x_signature and x_timestamp and x_nonce):
        _log(x_partner or "", False, "missing required headers", external_user_id)
        raise HTTPException(status_code=401, detail="Missing X-Partner/X-Signature/X-Timestamp/X-Nonce headers.")

    secret = settings.PARTNER_HMAC_SECRETS.get(x_partner)
    if not secret:
        _log(x_partner, False, "unknown partner", external_user_id)
        raise HTTPException(status_code=401, detail="Unknown partner.")

    try:
        ts = int(x_timestamp)
    except ValueError:
        _log(x_partner, False, "malformed timestamp", external_user_id)
        raise HTTPException(status_code=401, detail="X-Timestamp must be a Unix epoch integer.")
    if abs(time.time() - ts) > settings.FEDERATED_LOGIN_TIMESTAMP_WINDOW_SECONDS:
        _log(x_partner, False, "timestamp outside window", external_user_id)
        raise HTTPException(status_code=401, detail="Timestamp outside the allowed window.")

    # Constant-time compare -- never a plain ==, so response timing can't be
    # used to guess the correct signature one byte at a time.
    expected = hmac.new(
        secret.encode(), _canonical_string(x_timestamp, x_nonce, body).encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, x_signature):
        _log(x_partner, False, "invalid signature", external_user_id)
        raise HTTPException(status_code=401, detail="Invalid signature.")

    # Nonce replay protection -- fails CLOSED on a Redis outage (unlike the
    # ticket-idempotency system elsewhere in this stack, which deliberately
    # fails open): idempotency is a UX nicety, replay protection on an auth
    # endpoint is a security control, and those two situations call for
    # opposite defaults.
    nonce_key = f"federated_login:nonce:{x_partner}:{x_nonce}"
    try:
        claimed = await redis.set(nonce_key, "1", nx=True, ex=settings.FEDERATED_LOGIN_NONCE_TTL_SECONDS)
    except Exception:
        _log(x_partner, False, "replay-protection store unavailable", external_user_id)
        raise HTTPException(status_code=503, detail="Replay-protection store unavailable -- try again.")
    if not claimed:
        _log(x_partner, False, "nonce already used", external_user_id)
        raise HTTPException(status_code=401, detail="Nonce already used.")

    if not external_user_id:
        _log(x_partner, False, "missing external_user_id", external_user_id)
        raise HTTPException(status_code=400, detail="external_user_id is required.")
    email = str(body.get("email") or "").strip()
    name = str(body.get("name") or "").strip()

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{settings.DJANGO_INTERNAL_BASE_URL}/api/v1/auth/partner-provision/",
            headers={"X-Internal-Service-Key": settings.INTERNAL_SERVICE_KEY},
            json={"partner": x_partner, "external_partner_id": external_user_id, "email": email, "name": name},
        )
    if resp.status_code >= 400:
        _log(x_partner, False, "account provisioning failed", external_user_id)
        raise HTTPException(status_code=502, detail="Account provisioning failed.")
    try:
        user_id = resp.json()["data"]["user_id"]
    except (ValueError, KeyError, TypeError):
        _log(x_partner, False, "malformed provisioning response", external_user_id)
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

    _log(x_partner, True, "issued", external_user_id)

    # Deliberately NOT the {success, data, message, errors} envelope every
    # other endpoint in this codebase uses -- Yatroo's own spec (step 4d)
    # names this exact flat shape as what CityBus returns, and their backend
    # will presumably parse response.access_token directly, not
    # response.data.access_token.
    return {"access_token": access_token, "expires_in": expiry_seconds, "citybus_user_id": user_id}
