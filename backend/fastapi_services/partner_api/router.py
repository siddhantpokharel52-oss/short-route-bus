"""
/public-api/v1/partner/ -- server-to-server endpoint for Yatroo's own backend.
Mounted under the same /public-api/v1/ URL prefix as the consumer-facing
Master API purely for deployment convenience -- nginx's
mobile-api.citybus.com.np catch-all already rewrites everything under that
prefix to reach FastAPI, so this needed zero nginx changes to go live (see
docker/nginx/nginx.conf's history this same week for exactly how costly a
nginx path mismatch is to debug). It is NOT part of the Master API's trust
boundary: every request here is authenticated by an HMAC signature, never a
passenger/conductor JWT, and this router's tag ("Partner Integration") is
kept separate from "Public API" in the OpenAPI schema so the two are never
confused by a reader of /docs.

This is Yatroo-specific by design, not a generic multi-partner system --
there is exactly one partner today, and building out per-partner config for
a partner that doesn't exist yet would just be a second thing for Yatroo's
own implementation to get wrong for no present benefit. If a second partner
is ever actually onboarded, that's a small, well-scoped addition then (a
second secret + a partner-identifying header), not something to carry as
unused complexity now. The Django-side account
(apps.users.views.PartnerProvisionView) does still store a generic "partner"
column -- hardcoded to "yatroo" here -- so that future addition wouldn't
need a data-model change either.

Wire format -- confirmed against Yatroo's own implementation (their
2026-08-06 message): their canonical-string construction, JSON key-sorting,
and header names match this exactly, byte for byte -- no changes needed on
that front.

  Headers: X-Signature, X-Timestamp, X-Nonce
  Body:    {"external_user_id": "...", "email": "...", "phone": "...", "name": "..."}
            -- external_user_id required; email, phone, name all optional,
            but at least one of email/phone should be present so the
            provisioned account is reachable. Yatroo's own preference is to
            send phone (OTP-verified, unique) rather than email.

  canonical_string = f"{timestamp}\\n{nonce}\\n{compact_json_body}"
  compact_json_body = json.dumps(body, sort_keys=True, separators=(",", ":"))
  signature = hex(HMAC_SHA256(YATROO_HMAC_SECRET, canonical_string))

Client-facing URL on mobile-api.citybus.com.np: POST /partner/federated-login
(no /public-api/v1/ prefix -- nginx's catch-all adds that automatically. The
path shown here in Swagger, /public-api/v1/partner/federated-login, is the
*internal* FastAPI mount and also works, since nginx passes that prefix
through as-is too -- see docker/nginx/nginx.conf. Either path works; use
whichever this doc/Swagger shows you.)
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
from pydantic import BaseModel

from ..config import settings
from ..dependencies import get_redis

router = APIRouter()
logger = logging.getLogger(__name__)

PARTNER_NAME = "yatroo"


class FederatedLoginResponse(BaseModel):
    access_token: str
    expires_in: int
    citybus_user_id: str


def _canonical_string(timestamp: str, nonce: str, body: dict) -> str:
    compact = json.dumps(body, sort_keys=True, separators=(",", ":"))
    return f"{timestamp}\n{nonce}\n{compact}"


def _log(success: bool, reason: str, external_user_id: str = "") -> None:
    """One line per attempt (partner, outcome, reason) and nothing that
    shouldn't be there -- never the secret, the signature, or the
    access_token. external_user_id is logged (it's an identifier, not a
    credential) since it's the only thing that makes a failed attempt
    traceable back to a specific Yatroo user during support/debugging."""
    level = logger.info if success else logger.warning
    level(
        "federated_login partner=%s success=%s reason=%s external_user_id=%s",
        PARTNER_NAME, success, reason, external_user_id or "<unknown>",
    )


@router.post(
    "/federated-login",
    response_model=FederatedLoginResponse,
    summary="Federated login (Yatroo)",
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/json": {
                    "schema": {
                        "type": "object",
                        "required": ["external_user_id"],
                        "properties": {
                            "external_user_id": {"type": "string", "description": "Yatroo's permanent rider id -- the lookup key for the CityBus account."},
                            "phone": {"type": "string", "description": "Rider's phone number. Preferred over email (OTP-verified, unique)."},
                            "email": {"type": "string", "description": "Rider's email, if available."},
                            "name": {"type": "string", "description": "Rider's display name."},
                        },
                    },
                    "example": {"external_user_id": "yatroo-rider-123", "phone": "+9779800000000", "name": "Rider Name"},
                }
            },
        }
    },
)
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
    external_user_id = str(body.get("external_user_id") or "").strip()

    if not (x_signature and x_timestamp and x_nonce):
        _log(False, "missing required headers", external_user_id)
        raise HTTPException(status_code=401, detail="Missing X-Signature/X-Timestamp/X-Nonce headers.")

    try:
        ts = int(x_timestamp)
    except ValueError:
        _log(False, "malformed timestamp", external_user_id)
        raise HTTPException(status_code=401, detail="X-Timestamp must be a Unix epoch integer.")
    if abs(time.time() - ts) > settings.FEDERATED_LOGIN_TIMESTAMP_WINDOW_SECONDS:
        _log(False, "timestamp outside window", external_user_id)
        raise HTTPException(status_code=401, detail="Timestamp outside the allowed window.")

    # Constant-time compare -- never a plain ==, so response timing can't be
    # used to guess the correct signature one byte at a time.
    expected = hmac.new(
        settings.YATROO_HMAC_SECRET.encode(),
        _canonical_string(x_timestamp, x_nonce, body).encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, x_signature):
        _log(False, "invalid signature", external_user_id)
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
        _log(False, "replay-protection store unavailable", external_user_id)
        raise HTTPException(status_code=503, detail="Replay-protection store unavailable -- try again.")
    if not claimed:
        _log(False, "nonce already used", external_user_id)
        raise HTTPException(status_code=401, detail="Nonce already used.")

    if not external_user_id:
        _log(False, "missing external_user_id", external_user_id)
        raise HTTPException(status_code=400, detail="external_user_id is required.")
    email = str(body.get("email") or "").strip()
    phone = str(body.get("phone") or "").strip()
    name = str(body.get("name") or "").strip()

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{settings.DJANGO_INTERNAL_BASE_URL}/api/v1/auth/partner-provision/",
            headers={"X-Internal-Service-Key": settings.INTERNAL_SERVICE_KEY},
            json={"partner": PARTNER_NAME, "external_partner_id": external_user_id, "email": email, "phone": phone, "name": name},
        )
    if resp.status_code >= 400:
        _log(False, "account provisioning failed", external_user_id)
        raise HTTPException(status_code=502, detail="Account provisioning failed.")
    try:
        user_id = resp.json()["data"]["user_id"]
    except (ValueError, KeyError, TypeError):
        _log(False, "malformed provisioning response", external_user_id)
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

    _log(True, "issued", external_user_id)

    # Deliberately NOT the {success, data, message, errors} envelope every
    # other endpoint in this codebase uses -- Yatroo's own spec (step 4d)
    # names this exact flat shape as what CityBus returns, and their backend
    # will presumably parse response.access_token directly, not
    # response.data.access_token.
    return {"access_token": access_token, "expires_in": expiry_seconds, "citybus_user_id": user_id}
