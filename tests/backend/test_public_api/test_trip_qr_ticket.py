"""
Tests for "passenger self-books by scanning the conductor's QR":
  - GET /public-api/v1/trips/{trip_id}/qr/  (conductor-only, mints a trip_qr_token)
  - POST /public-api/v1/tickets/            (extended: a PASSENGER-role caller may
    supply trip_qr_token instead of a conductor identity)

Both new endpoints/paths reuse the existing shared JWT secret (jose, HS256) rather
than a new auth mechanism — see the module note in router.py above _passthrough()
for the full design rationale. These tests exercise the FastAPI app directly via
TestClient, mocking tenant_db's DB access and the Django HTTP proxy call, so no
live Postgres/Django is required.

The load-bearing assertions throughout are less "did this return 200/403" and more
"was _proxy_to_django ever called, and with which bearer token/schema/payload" —
mirroring the discipline in test_ticket_proxy.py, since the actual security
property here is that a passenger's own JWT is never forwarded to Django, and that
an invalid/expired/foreign QR token can never reach the proxy call at all.
"""
import time
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt as jose_jwt

from backend.fastapi_services.config import settings as fastapi_settings
from backend.fastapi_services.main import app
from backend.fastapi_services.public_api import router as public_api_router

JWT_SECRET = fastapi_settings.JWT_SECRET_KEY
JWT_ALG = fastapi_settings.JWT_ALGORITHM

TRIP_ID = "44444444-4444-4444-4444-444444444444"
CONDUCTOR_ID = "33333333-3333-3333-3333-333333333333"
OTHER_CONDUCTOR_ID = "55555555-5555-5555-5555-555555555555"
PASSENGER_ID = "22222222-2222-2222-2222-222222222222"
SCHEMA = "tenant_a"

BASE_TRIP = {
    "id": TRIP_ID,
    "trip_code": "TRP-001",
    "route_id": "66666666-6666-6666-6666-666666666666",
    "conductor_id": CONDUCTOR_ID,
    "vehicle_id": "77777777-7777-7777-7777-777777777777",
    "date": "2026-08-02",
    "scheduled_departure_time": "08:00:00",
    "scheduled_arrival_time": "09:00:00",
    "status": "IN_PROGRESS",
}


class FakeDjangoResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _token(role, tenant_schema="", user_id="user-1", **extra_claims):
    payload = {"user_id": user_id, "role": role, "tenant_schema": tenant_schema, **extra_claims}
    return jose_jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def _conductor_token(schema=SCHEMA, user_id=CONDUCTOR_ID):
    return _token("CONDUCTOR", schema, user_id=user_id)


def _passenger_token(user_id=PASSENGER_ID):
    return _token("PASSENGER", "", user_id=user_id)


def _trip_qr_token(trip_id=TRIP_ID, schema=SCHEMA, conductor_id=CONDUCTOR_ID, **extra_claims):
    now = int(time.time())
    payload = {
        "purpose": "trip_ticket_scan",
        "trip_id": trip_id,
        "tenant_schema": schema,
        "conductor_id": conductor_id,
        "iat": now,
        "exp": now + 3600,
        **extra_claims,
    }
    return jose_jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


@pytest.fixture
def client():
    return TestClient(app)


# ─────────────────────────────────────────────────────────────────────────────
# GET /trips/{trip_id}/qr/
# ─────────────────────────────────────────────────────────────────────────────

def test_conductor_can_get_qr_for_own_trip(client):
    with patch.object(
        public_api_router.tenant_db, "fetch_trip_for_conductor", new=AsyncMock(return_value=BASE_TRIP)
    ) as mock_fetch:
        resp = client.get(
            f"/public-api/v1/trips/{TRIP_ID}/qr/",
            headers={"Authorization": f"Bearer {_conductor_token()}"},
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["trip_id"] == TRIP_ID
    assert body["data"]["trip_code"] == "TRP-001"
    mock_fetch.assert_awaited_once_with(SCHEMA, TRIP_ID, CONDUCTOR_ID)

    decoded = jose_jwt.decode(body["data"]["trip_qr_token"], JWT_SECRET, algorithms=[JWT_ALG])
    assert decoded["purpose"] == "trip_ticket_scan"
    assert decoded["trip_id"] == TRIP_ID
    assert decoded["tenant_schema"] == SCHEMA
    assert decoded["conductor_id"] == CONDUCTOR_ID


def test_conductor_cannot_get_qr_for_foreign_or_missing_trip(client):
    with patch.object(
        public_api_router.tenant_db, "fetch_trip_for_conductor", new=AsyncMock(return_value=None)
    ) as mock_fetch:
        resp = client.get(
            f"/public-api/v1/trips/{TRIP_ID}/qr/",
            headers={"Authorization": f"Bearer {_conductor_token()}"},
        )

    assert resp.status_code == 404, resp.text
    assert resp.json()["success"] is False
    mock_fetch.assert_awaited_once_with(SCHEMA, TRIP_ID, CONDUCTOR_ID)


def test_passenger_cannot_get_trip_qr(client):
    with patch.object(
        public_api_router.tenant_db, "fetch_trip_for_conductor", new=AsyncMock()
    ) as mock_fetch:
        resp = client.get(
            f"/public-api/v1/trips/{TRIP_ID}/qr/",
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 403, resp.text
    mock_fetch.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# POST /tickets/ with a passenger-supplied trip_qr_token
# ─────────────────────────────────────────────────────────────────────────────

def test_passenger_with_valid_trip_qr_token_issues_ticket_as_the_real_conductor(client):
    with patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ) as mock_domain, patch.object(
        public_api_router,
        "_proxy_to_django",
        new=AsyncMock(
            return_value=FakeDjangoResponse(
                201,
                {"success": True, "data": {"ticket_uid": "TKT-XYZ"}, "message": "Ticket issued.", "errors": None},
            )
        ),
    ) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json={
                "trip_qr_token": _trip_qr_token(),
                "from_stop_id": "s1",
                "to_stop_id": "s2",
            },
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 201, resp.text
    mock_domain.assert_awaited_once_with(SCHEMA)
    mock_proxy.assert_awaited_once()

    args = mock_proxy.await_args.args
    # args = (method, path, schema, domain, bearer_token) ; json_body is a kwarg
    assert args[2] == SCHEMA
    used_bearer = args[4]
    decoded = jose_jwt.decode(used_bearer, JWT_SECRET, algorithms=[JWT_ALG])
    assert decoded["role"] == "CONDUCTOR"
    assert decoded["user_id"] == CONDUCTOR_ID
    assert decoded["tenant_schema"] == SCHEMA
    # never the passenger's own token
    assert used_bearer != _passenger_token()

    sent_payload = mock_proxy.await_args.kwargs["json_body"]
    assert sent_payload["trip_id"] == TRIP_ID
    assert sent_payload["passenger_id"] == PASSENGER_ID
    assert sent_payload["from_stop_id"] == "s1"
    assert "trip_qr_token" not in sent_payload


def test_passenger_with_garbage_trip_qr_token_rejected_before_proxy(client):
    with patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json={"trip_qr_token": "not-a-real-jwt"},
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 403, resp.text
    mock_proxy.assert_not_called()


def test_passenger_with_expired_trip_qr_token_rejected_before_proxy(client):
    now = int(time.time())
    expired = jose_jwt.encode(
        {
            "purpose": "trip_ticket_scan",
            "trip_id": TRIP_ID,
            "tenant_schema": SCHEMA,
            "conductor_id": CONDUCTOR_ID,
            "iat": now - 100,
            "exp": now - 10,
        },
        JWT_SECRET,
        algorithm=JWT_ALG,
    )
    with patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json={"trip_qr_token": expired},
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 403, resp.text
    mock_proxy.assert_not_called()


def test_passenger_with_wrong_purpose_token_rejected_before_proxy(client):
    # An ordinary passenger access token presented where a trip_qr_token belongs.
    wrong_purpose = _passenger_token()
    with patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json={"trip_qr_token": wrong_purpose},
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 403, resp.text
    mock_proxy.assert_not_called()


def test_passenger_without_any_trip_qr_token_still_rejected(client):
    """Regression: extending the passenger path must not loosen the default-deny —
    a passenger with no trip_qr_token at all is still a plain 403, exactly as before
    this feature existed."""
    with patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json={"from_stop_id": "s1"},
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 403, resp.text
    mock_proxy.assert_not_called()


def test_conductor_direct_issue_path_unaffected_by_trip_qr_feature(client):
    """Regression: the pre-existing conductor-direct issuance path (no trip_qr_token
    involved at all) must still route with the conductor's own bearer token, not a
    minted service token."""
    conductor_bearer = _conductor_token()
    with patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        public_api_router,
        "_proxy_to_django",
        new=AsyncMock(
            return_value=FakeDjangoResponse(201, {"success": True, "data": {}, "message": "Ticket issued.", "errors": None})
        ),
    ) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json={"route_id": "r1"},
            headers={"Authorization": f"Bearer {conductor_bearer}"},
        )

    assert resp.status_code == 201, resp.text
    assert mock_proxy.await_args.args[4] == conductor_bearer
    sent_payload = mock_proxy.await_args.kwargs["json_body"]
    assert "trip_id" not in sent_payload
    assert "passenger_id" not in sent_payload
