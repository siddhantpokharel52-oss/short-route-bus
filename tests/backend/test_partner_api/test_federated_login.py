"""
Tests for POST /public-api/v1/partner/federated-login (backend/fastapi_services/
partner_api/router.py) -- the Yatroo token-exchange endpoint.

Same style as the rest of this suite: FastAPI app via TestClient, the Django
provisioning call mocked (httpx.AsyncClient), Redis swapped via FastAPI's own
dependency_overrides for get_redis (same mechanism test_ticket_idempotency.py
uses). No live Postgres/Redis/Django required.

The signature helper here (_sign) independently reimplements the router's
canonical-string logic rather than importing it, so these tests actually
prove the real implementation matches a from-scratch equivalent -- importing
the router's own _canonical_string() would let a bug in that function pass
silently since the test would be validating itself.
"""
import hashlib
import hmac
import json
import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt as jose_jwt

from backend.fastapi_services.config import settings as fastapi_settings
from backend.fastapi_services.dependencies import get_redis
from backend.fastapi_services.main import app
from backend.fastapi_services.partner_api import router as partner_api_router

SECRET = fastapi_settings.YATROO_HMAC_SECRET
JWT_SECRET = fastapi_settings.JWT_SECRET_KEY
JWT_ALG = fastapi_settings.JWT_ALGORITHM


def _sign(timestamp: str, nonce: str, body: dict, secret: str = SECRET) -> str:
    compact = json.dumps(body, sort_keys=True, separators=(",", ":"))
    canonical = f"{timestamp}\n{nonce}\n{compact}"
    return hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()


def _headers(body: dict, timestamp=None, nonce="test-nonce-1", secret=SECRET):
    ts = str(timestamp if timestamp is not None else int(time.time()))
    return {
        "X-Signature": _sign(ts, nonce, body, secret),
        "X-Timestamp": ts,
        "X-Nonce": nonce,
        "Content-Type": "application/json",
    }


class FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}

    async def set(self, key, value, ex=None, nx=False):
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True


class BrokenRedis:
    async def set(self, *args, **kwargs):
        raise ConnectionError("redis down")


class _MockDjangoResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _MockAsyncClient:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, *args, **kwargs):
        return self._response


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _fresh_redis():
    fr = FakeRedis()
    app.dependency_overrides[get_redis] = lambda: fr
    yield
    app.dependency_overrides.pop(get_redis, None)


def _django_ok(user_id="11111111-1111-1111-1111-111111111111", created=True):
    return _MockAsyncClient(_MockDjangoResponse(
        201 if created else 200,
        {"success": True, "data": {"user_id": user_id, "created": created}, "message": "", "errors": None},
    ))


def test_valid_request_returns_scoped_token(client):
    body = {"external_user_id": "yatroo-user-1", "email": "rider@example.com", "name": "Test Rider"}
    with patch.object(partner_api_router.httpx, "AsyncClient", return_value=_django_ok()):
        resp = client.post(
            "/public-api/v1/partner/federated-login",
            json=body,
            headers=_headers(body),
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["citybus_user_id"] == "11111111-1111-1111-1111-111111111111"
    assert data["expires_in"] == fastapi_settings.FEDERATED_LOGIN_TOKEN_EXPIRY_SECONDS
    claims = jose_jwt.decode(data["access_token"], JWT_SECRET, algorithms=[JWT_ALG])
    assert claims["role"] == "PASSENGER"
    assert claims["tenant_schema"] == ""
    assert claims["user_id"] == "11111111-1111-1111-1111-111111111111"


def test_missing_signature_headers_rejected(client):
    resp = client.post(
        "/public-api/v1/partner/federated-login",
        json={"external_user_id": "u1"},
    )
    assert resp.status_code == 401


def test_tampered_body_rejected_before_django_call(client):
    body = {"external_user_id": "u1", "email": "a@b.com", "name": "A"}
    headers = _headers(body)
    tampered_body = {**body, "email": "attacker@evil.com"}
    with patch.object(partner_api_router.httpx, "AsyncClient") as mock_client:
        resp = client.post("/public-api/v1/partner/federated-login", json=tampered_body, headers=headers)
    assert resp.status_code == 401
    mock_client.assert_not_called()


def test_wrong_secret_rejected(client):
    body = {"external_user_id": "u1"}
    headers = _headers(body, secret="not-the-real-secret")
    resp = client.post("/public-api/v1/partner/federated-login", json=body, headers=headers)
    assert resp.status_code == 401


def test_stale_timestamp_rejected(client):
    body = {"external_user_id": "u1"}
    old_ts = int(time.time()) - (fastapi_settings.FEDERATED_LOGIN_TIMESTAMP_WINDOW_SECONDS + 30)
    headers = _headers(body, timestamp=old_ts)
    resp = client.post("/public-api/v1/partner/federated-login", json=body, headers=headers)
    assert resp.status_code == 401
    assert "window" in resp.json()["detail"].lower()


def test_non_integer_timestamp_rejected(client):
    body = {"external_user_id": "u1"}
    headers = _headers(body)
    headers["X-Timestamp"] = "not-a-number"
    # Signature was computed against the real timestamp, so this also fails
    # signature verification -- but the timestamp-format check runs first.
    resp = client.post("/public-api/v1/partner/federated-login", json=body, headers=headers)
    assert resp.status_code == 401


def test_nonce_replay_rejected(client):
    body = {"external_user_id": "u1", "email": "a@b.com", "name": "A"}
    headers = _headers(body, nonce="reused-nonce")
    with patch.object(partner_api_router.httpx, "AsyncClient", return_value=_django_ok()):
        first = client.post("/public-api/v1/partner/federated-login", json=body, headers=headers)
        second = client.post("/public-api/v1/partner/federated-login", json=body, headers=headers)

    assert first.status_code == 200, first.text
    assert second.status_code == 401
    assert "nonce" in second.json()["detail"].lower()


def test_redis_outage_fails_closed(client):
    app.dependency_overrides[get_redis] = lambda: BrokenRedis()
    body = {"external_user_id": "u1"}
    headers = _headers(body)
    with patch.object(partner_api_router.httpx, "AsyncClient", return_value=_django_ok()):
        resp = client.post("/public-api/v1/partner/federated-login", json=body, headers=headers)
    assert resp.status_code == 503


def test_missing_external_user_id_rejected(client):
    body = {"email": "a@b.com", "name": "A"}
    headers = _headers(body)
    resp = client.post("/public-api/v1/partner/federated-login", json=body, headers=headers)
    assert resp.status_code == 400


def test_django_provisioning_failure_returns_502(client):
    body = {"external_user_id": "u1"}
    headers = _headers(body)
    failing_client = _MockAsyncClient(_MockDjangoResponse(500, {"success": False}))
    with patch.object(partner_api_router.httpx, "AsyncClient", return_value=failing_client):
        resp = client.post("/public-api/v1/partner/federated-login", json=body, headers=headers)
    assert resp.status_code == 502


def test_malformed_django_response_returns_502(client):
    body = {"external_user_id": "u1"}
    headers = _headers(body)
    malformed_client = _MockAsyncClient(_MockDjangoResponse(200, {"success": True, "data": {}}))
    with patch.object(partner_api_router.httpx, "AsyncClient", return_value=malformed_client):
        resp = client.post("/public-api/v1/partner/federated-login", json=body, headers=headers)
    assert resp.status_code == 502


def test_repeat_call_same_external_user_id_returns_same_citybus_user_id(client):
    """Not a full guarantee (that's Django's job, see test_partner_provision.py-
    style coverage on that side) -- this just confirms the FastAPI layer passes
    through whatever Django says without minting a new identity itself."""
    body = {"external_user_id": "u1", "email": "a@b.com", "name": "A"}
    with patch.object(partner_api_router.httpx, "AsyncClient", return_value=_django_ok(created=True)):
        first = client.post(
            "/public-api/v1/partner/federated-login", json=body, headers=_headers(body, nonce="n1")
        )
    with patch.object(partner_api_router.httpx, "AsyncClient", return_value=_django_ok(created=False)):
        second = client.post(
            "/public-api/v1/partner/federated-login", json=body, headers=_headers(body, nonce="n2")
        )

    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["data"]["citybus_user_id"] == second.json()["data"]["citybus_user_id"]
