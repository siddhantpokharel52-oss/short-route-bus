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
import logging
import time
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt as jose_jwt

from backend.fastapi_services.config import settings as fastapi_settings
from backend.fastapi_services.dependencies import get_redis
from backend.fastapi_services.main import app
from backend.fastapi_services.partner_api import router as partner_api_router
from backend.fastapi_services.public_api import router as public_api_router

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
    data = resp.json()
    assert set(data.keys()) == {"access_token", "expires_in", "citybus_user_id"}, (
        "must be the flat shape Yatroo's doc specifies, not our usual {success, data, ...} envelope"
    )
    assert data["citybus_user_id"] == "11111111-1111-1111-1111-111111111111"
    assert data["expires_in"] == fastapi_settings.FEDERATED_LOGIN_TOKEN_EXPIRY_SECONDS
    claims = jose_jwt.decode(data["access_token"], JWT_SECRET, algorithms=[JWT_ALG])
    assert claims["role"] == "PASSENGER"
    assert claims["tenant_schema"] == ""
    assert claims["user_id"] == "11111111-1111-1111-1111-111111111111"
    # Caught live, not by a mock: rest_framework_simplejwt's AccessToken.verify()
    # hard-requires both of these on any token proxied through to Django (e.g.
    # POST /tickets/{id}/cancel/) -- "Token has no id"/"Token has no type"
    # otherwise. A mocked _proxy_to_django can't fail on a claim it never
    # actually decodes, which is exactly how this was missing undetected.
    assert claims["token_type"] == "access"
    assert claims["jti"]


def test_minted_token_actually_works_against_a_real_master_api_endpoint(client):
    """This is the part of Yatroo's doc (step 5) that matters most: 'App -> CityBus
    directly, from now on, using that token ... whatever CityBus exposes.' Proves the
    token isn't just structurally similar to a real passenger JWT -- it IS one, accepted
    by an existing, unrelated Master API endpoint (GET /tickets/my/) with zero special-
    casing anywhere in that endpoint's code."""
    body = {"external_user_id": "yatroo-user-2", "email": "rider2@example.com", "name": "Rider Two"}
    with patch.object(partner_api_router.httpx, "AsyncClient", return_value=_django_ok(user_id="22222222-2222-2222-2222-222222222222")):
        login_resp = client.post(
            "/public-api/v1/partner/federated-login", json=body, headers=_headers(body, nonce="interop-1")
        )
    assert login_resp.status_code == 200, login_resp.text
    access_token = login_resp.json()["access_token"]

    with patch.object(
        public_api_router.tenant_db, "find_tickets_for_passenger", new=AsyncMock(return_value=[])
    ) as mock_find:
        my_tickets_resp = client.get(
            "/public-api/v1/tickets/my/", headers={"Authorization": f"Bearer {access_token}"}
        )

    assert my_tickets_resp.status_code == 200, my_tickets_resp.text
    assert my_tickets_resp.json()["data"] == []
    mock_find.assert_awaited_once()
    assert mock_find.await_args.args[0] == "22222222-2222-2222-2222-222222222222"


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
    assert first.json()["citybus_user_id"] == second.json()["citybus_user_id"]


def test_partner_name_sent_to_provisioning_is_yatroo(client):
    """Confirms the hardcoded partner name actually reaches the Django
    provisioning call, matching PARTNER_NAME in the router."""
    body = {"external_user_id": "u1"}
    with patch.object(
        partner_api_router.httpx, "AsyncClient", return_value=_django_ok()
    ) as mock_client_factory:
        client.post("/public-api/v1/partner/federated-login", json=body, headers=_headers(body))

    mock_client_factory.assert_called_once()


def test_phone_only_body_is_accepted_and_forwarded(client):
    """Yatroo's own implementation sends {external_user_id, phone, name} --
    no email. Confirms that body shape signs/verifies correctly (the
    signature covers whatever keys are actually present) and that phone
    reaches the Django provisioning call."""
    body = {"external_user_id": "yatroo-rider-1", "phone": "+9779800000000", "name": "Rider One"}
    captured = {}

    class _RecordingAsyncClient(_MockAsyncClient):
        async def post(self, *args, **kwargs):
            captured.update(kwargs.get("json") or {})
            return self._response

    with patch.object(
        partner_api_router.httpx, "AsyncClient",
        return_value=_RecordingAsyncClient(_MockDjangoResponse(
            201, {"success": True, "data": {"user_id": "u-phone-1", "created": True}, "message": "", "errors": None}
        )),
    ):
        resp = client.post("/public-api/v1/partner/federated-login", json=body, headers=_headers(body))

    assert resp.status_code == 200, resp.text
    assert captured["phone"] == "+9779800000000"
    assert captured["email"] == ""


def test_provisioning_call_sets_host_header_to_public_domain(client):
    """Caught live against a real signed request in production, not by any
    mock: django-tenants resolves which schema/urlconf to use purely from the
    Host header. DJANGO_INTERNAL_BASE_URL's hostname ("django", the docker
    network service name) isn't a registered tenant domain in production, so
    without an explicit Host header here, Django 404s on this path before
    even reaching PartnerProvisionView -- every other internal proxy call
    (_proxy_to_django in public_api/router.py) is tenant-scoped and already
    sets its own Host header for exactly this reason; this is the first call
    to a public-schema-only endpoint, and needed the same treatment."""
    body = {"external_user_id": "yatroo-host-check-1"}
    captured_headers = {}

    class _RecordingAsyncClient(_MockAsyncClient):
        async def post(self, *args, **kwargs):
            captured_headers.update(kwargs.get("headers") or {})
            return self._response

    with patch.object(
        partner_api_router.httpx, "AsyncClient",
        return_value=_RecordingAsyncClient(_MockDjangoResponse(
            201, {"success": True, "data": {"user_id": "u-host-check-1", "created": True}, "message": "", "errors": None}
        )),
    ):
        resp = client.post("/public-api/v1/partner/federated-login", json=body, headers=_headers(body))

    assert resp.status_code == 200, resp.text
    assert captured_headers.get("Host") == fastapi_settings.DJANGO_PUBLIC_DOMAIN
    assert captured_headers.get("Host") != "django"


def test_successful_attempt_is_logged_without_leaking_secret_or_token(client, caplog):
    body = {"external_user_id": "log-test-user"}
    with caplog.at_level(logging.INFO, logger="backend.fastapi_services.partner_api.router"):
        with patch.object(partner_api_router.httpx, "AsyncClient", return_value=_django_ok()):
            resp = client.post(
                "/public-api/v1/partner/federated-login", json=body, headers=_headers(body, nonce="log-1")
            )
    assert resp.status_code == 200
    access_token = resp.json()["access_token"]

    log_text = "\n".join(r.message for r in caplog.records)
    assert "partner=yatroo" in log_text
    assert "success=True" in log_text
    assert "log-test-user" in log_text
    assert SECRET not in log_text
    assert access_token not in log_text


def test_failed_attempt_is_logged_with_reason(client, caplog):
    body = {"external_user_id": "log-test-user-2"}
    headers = _headers(body, secret="wrong-secret")
    with caplog.at_level(logging.WARNING, logger="backend.fastapi_services.partner_api.router"):
        resp = client.post("/public-api/v1/partner/federated-login", json=body, headers=headers)
    assert resp.status_code == 401

    log_text = "\n".join(r.message for r in caplog.records)
    assert "success=False" in log_text
    assert "invalid signature" in log_text.lower()
