"""
Tests for POST /public-api/v1/tickets/ accepting the brief's camelCase field
names (boardingStopId, droppingStopId, passengerPhone, documentId) as
aliases for this API's own snake_case ones (closes part of gap C5 — field
casing was a documented, unreconciled deviation from the spec).

This is a normalization shim, not a second schema: after issue_ticket()'s
top-of-function alias pass, only the snake_case keys exist anywhere
downstream — these tests assert on what gets forwarded to Django and what
gets passed to tenant_db.store_passenger_details, both of which only ever
see snake_case.

Mocks tenant_db/_proxy_to_django — no live Postgres/Django needed. The
passenger_phone/document_id side-table itself (storage + retrieval) is
covered separately, against real Postgres, in test_passenger_details.py.
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
SCHEMA = "tenant_a"


class FakeDjangoResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _conductor_token(schema=SCHEMA):
    return jose_jwt.encode(
        {"user_id": "conductor-1", "role": "CONDUCTOR", "tenant_schema": schema}, JWT_SECRET, algorithm=JWT_ALG
    )


@pytest.fixture
def client():
    return TestClient(app)


def test_camelcase_stop_ids_are_forwarded_as_snake_case(client):
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
            json={"boardingStopId": "stop-1", "droppingStopId": "stop-2", "fare_paid": "25.00"},
            headers={"Authorization": f"Bearer {_conductor_token()}"},
        )

    assert resp.status_code == 201, resp.text
    sent = mock_proxy.await_args.kwargs["json_body"]
    assert sent["from_stop_id"] == "stop-1"
    assert sent["to_stop_id"] == "stop-2"
    assert "boardingStopId" not in sent
    assert "droppingStopId" not in sent


def test_snake_case_wins_if_caller_sends_both(client):
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
            json={"boardingStopId": "wrong-stop", "from_stop_id": "right-stop", "fare_paid": "25.00"},
            headers={"Authorization": f"Bearer {_conductor_token()}"},
        )

    assert resp.status_code == 201, resp.text
    sent = mock_proxy.await_args.kwargs["json_body"]
    assert sent["from_stop_id"] == "right-stop"


def test_camelcase_passenger_phone_and_document_id_are_stored(client):
    with patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        public_api_router,
        "_proxy_to_django",
        new=AsyncMock(
            return_value=FakeDjangoResponse(
                201, {"success": True, "data": {"ticket_uid": "TKT-ALIAS1"}, "message": "Ticket issued.", "errors": None}
            )
        ),
    ), patch.object(
        public_api_router.tenant_db, "store_passenger_details", new=AsyncMock()
    ) as mock_store:
        resp = client.post(
            "/public-api/v1/tickets/",
            json={
                "route_id": "r1",
                "passengerPhone": "+9779800000001",
                "documentId": "CITZ-123",
                "fare_paid": "25.00",
            },
            headers={"Authorization": f"Bearer {_conductor_token()}"},
        )

    assert resp.status_code == 201, resp.text
    mock_store.assert_awaited_once_with("TKT-ALIAS1", SCHEMA, "+9779800000001", "CITZ-123")


def test_no_passenger_details_means_no_store_call(client):
    """No phone, no document ID -> never even attempt a write. Matches
    store_payment_reference's own precedent of not writing an empty row."""
    with patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        public_api_router,
        "_proxy_to_django",
        new=AsyncMock(
            return_value=FakeDjangoResponse(
                201, {"success": True, "data": {"ticket_uid": "TKT-NOPHONE"}, "message": "Ticket issued.", "errors": None}
            )
        ),
    ), patch.object(
        public_api_router.tenant_db, "store_passenger_details", new=AsyncMock()
    ) as mock_store:
        resp = client.post(
            "/public-api/v1/tickets/",
            json={"route_id": "r1", "fare_paid": "25.00"},
            headers={"Authorization": f"Bearer {_conductor_token()}"},
        )

    assert resp.status_code == 201, resp.text
    mock_store.assert_not_called()
