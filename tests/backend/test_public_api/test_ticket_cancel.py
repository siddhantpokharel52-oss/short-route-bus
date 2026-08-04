"""
Tests for POST /public-api/v1/tickets/{id}/cancel/ (backend/fastapi_services/
public_api/router.py cancel_ticket()) — the void/cancel endpoint closing the gap
flagged in the Yatroo brief §8 ("the corresponding void/cancel is posted to your
platform" after Yatroo processes a refund on its own gateway).

Same style as test_ticket_proxy.py: FastAPI app via TestClient, tenant_db and the
Django proxy call mocked out, no live Postgres/Django required. What's actually
under test here is the authorization check (ticket owner or issuing-tenant staff)
running *before* any proxy call — mock.assert_not_called() on _proxy_to_django is
the load-bearing assertion in the negative cases.

Run (no live DB needed): from the repo root,
    DATABASE_URL=postgresql+asyncpg://u:p@localhost/db \\
    REDIS_URL=redis://localhost:6379/0 \\
    JWT_SECRET_KEY=test \\
    pytest tests/backend/test_public_api/test_ticket_cancel.py -p no:django -v
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt as jose_jwt

from backend.fastapi_services.config import settings as fastapi_settings
from backend.fastapi_services.main import app
from backend.fastapi_services.public_api import router as public_api_router

JWT_SECRET = fastapi_settings.JWT_SECRET_KEY
JWT_ALG = fastapi_settings.JWT_ALGORITHM

TICKET_ID = "11111111-1111-1111-1111-111111111111"
PASSENGER_ID = "22222222-2222-2222-2222-222222222222"

BASE_TICKET = {
    "id": TICKET_ID,
    "ticket_uid": "TKT-AAA111",
    "passenger_id": PASSENGER_ID,
    "status": "VALID",
    "tenant_schema": "tenant_a",
}


class FakeDjangoResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _token(role, tenant_schema="", **extra_claims):
    payload = {"user_id": "user-1", "role": role, "tenant_schema": tenant_schema, **extra_claims}
    return jose_jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def _passenger_token(user_id=PASSENGER_ID):
    return _token("PASSENGER", "", user_id=user_id)


def _conductor_token(schema="tenant_a"):
    return _token("CONDUCTOR", schema)


@pytest.fixture
def client():
    return TestClient(app)


def _cancelled_django_response(passenger_id=PASSENGER_ID):
    return FakeDjangoResponse(
        200,
        {
            "success": True,
            "data": {**BASE_TICKET, "status": "CANCELLED", "passenger_id": passenger_id},
            "message": "Ticket cancelled.",
            "errors": None,
        },
    )


def test_ticket_owner_can_cancel_own_ticket(client):
    ticket = {**BASE_TICKET}
    with patch.object(
        public_api_router.tenant_db, "find_ticket_by_id", new=AsyncMock(return_value=("tenant_a", ticket))
    ), patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        public_api_router, "_proxy_to_django", new=AsyncMock(return_value=_cancelled_django_response())
    ) as mock_proxy:
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/cancel/",
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 200, resp.text
    assert resp.json()["success"] is True
    mock_proxy.assert_awaited_once()
    assert mock_proxy.await_args.args[0] == "POST"
    assert mock_proxy.await_args.args[1] == f"/api/v1/ticketing/tickets/{ticket['ticket_uid']}/cancel/"
    assert mock_proxy.await_args.args[2] == "tenant_a"


def test_issuing_tenant_staff_can_cancel_ticket(client):
    ticket = {**BASE_TICKET, "passenger_id": "someone-else"}
    with patch.object(
        public_api_router.tenant_db, "find_ticket_by_id", new=AsyncMock(return_value=("tenant_a", ticket))
    ), patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        public_api_router, "_proxy_to_django", new=AsyncMock(return_value=_cancelled_django_response("someone-else"))
    ) as mock_proxy:
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/cancel/",
            headers={"Authorization": f"Bearer {_conductor_token('tenant_a')}"},
        )

    assert resp.status_code == 200, resp.text
    mock_proxy.assert_awaited_once()


def test_non_owner_non_staff_cannot_cancel_ticket(client):
    ticket = {**BASE_TICKET, "passenger_id": "someone-else"}
    with patch.object(
        public_api_router.tenant_db, "find_ticket_by_id", new=AsyncMock(return_value=("tenant_a", ticket))
    ), patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock()
    ) as mock_domain, patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/cancel/",
            headers={"Authorization": f"Bearer {_passenger_token(user_id='not-the-owner')}"},
        )

    assert resp.status_code == 403, resp.text
    assert resp.json()["success"] is False
    mock_domain.assert_not_called()
    mock_proxy.assert_not_called()


def test_conductor_from_other_tenant_cannot_cancel_ticket(client):
    ticket = {**BASE_TICKET, "tenant_schema": "tenant_b", "passenger_id": "someone-else"}
    with patch.object(
        public_api_router.tenant_db, "find_ticket_by_id", new=AsyncMock(return_value=("tenant_b", ticket))
    ), patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock()
    ) as mock_domain, patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/cancel/",
            headers={"Authorization": f"Bearer {_conductor_token('tenant_a')}"},
        )

    assert resp.status_code == 403, resp.text
    mock_domain.assert_not_called()
    mock_proxy.assert_not_called()


def test_cancel_nonexistent_ticket_returns_404(client):
    with patch.object(
        public_api_router.tenant_db, "find_ticket_by_id", new=AsyncMock(return_value=None)
    ), patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/cancel/",
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 404, resp.text
    mock_proxy.assert_not_called()


def test_cancel_broadcasts_ticket_cancelled_over_websocket(client):
    ticket = {**BASE_TICKET}
    with patch.object(
        public_api_router.tenant_db, "find_ticket_by_id", new=AsyncMock(return_value=("tenant_a", ticket))
    ), patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        public_api_router, "_proxy_to_django", new=AsyncMock(return_value=_cancelled_django_response())
    ), patch.object(
        public_api_router.ticket_ws_manager, "broadcast", new=AsyncMock()
    ) as mock_broadcast:
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/cancel/",
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 200, resp.text
    mock_broadcast.assert_awaited_once()
    event, kwargs = mock_broadcast.await_args.args, mock_broadcast.await_args.kwargs
    assert event[0]["event"] == "ticket_cancelled"
    assert kwargs["group"] == f"passenger_{PASSENGER_ID}"


def test_broadcast_failure_does_not_break_cancellation(client):
    """Same rule as ticket issuance: a WS send raising must never surface as a
    failed cancel — the ticket is already voided in Django by the time this runs."""
    ticket = {**BASE_TICKET}
    with patch.object(
        public_api_router.tenant_db, "find_ticket_by_id", new=AsyncMock(return_value=("tenant_a", ticket))
    ), patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        public_api_router, "_proxy_to_django", new=AsyncMock(return_value=_cancelled_django_response())
    ), patch.object(
        public_api_router.ticket_ws_manager, "broadcast", new=AsyncMock(side_effect=RuntimeError("boom"))
    ):
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/cancel/",
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 200, resp.text
    assert resp.json()["success"] is True


def test_no_broadcast_when_django_response_has_no_passenger_id(client):
    ticket = {**BASE_TICKET}
    with patch.object(
        public_api_router.tenant_db, "find_ticket_by_id", new=AsyncMock(return_value=("tenant_a", ticket))
    ), patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        public_api_router,
        "_proxy_to_django",
        new=AsyncMock(
            return_value=FakeDjangoResponse(
                200,
                {"success": True, "data": {"ticket_uid": "TKT-AAA111", "status": "CANCELLED"}, "message": "Ticket cancelled.", "errors": None},
            )
        ),
    ), patch.object(public_api_router.ticket_ws_manager, "broadcast", new=AsyncMock()) as mock_broadcast:
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/cancel/",
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 200, resp.text
    mock_broadcast.assert_not_called()


def test_cancel_failure_response_from_django_is_passed_through(client):
    """E.g. Django rejects because the ticket was already USED — the proxy must
    surface that status/body as-is, not swallow or reshape it."""
    ticket = {**BASE_TICKET}
    with patch.object(
        public_api_router.tenant_db, "find_ticket_by_id", new=AsyncMock(return_value=("tenant_a", ticket))
    ), patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        public_api_router,
        "_proxy_to_django",
        new=AsyncMock(
            return_value=FakeDjangoResponse(
                400,
                {"success": False, "data": None, "message": "Cannot cancel a ticket that has already been used.", "errors": None},
            )
        ),
    ), patch.object(public_api_router.ticket_ws_manager, "broadcast", new=AsyncMock()) as mock_broadcast:
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/cancel/",
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 400, resp.text
    assert resp.json()["success"] is False
    mock_broadcast.assert_not_called()
