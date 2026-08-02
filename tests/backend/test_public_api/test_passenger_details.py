"""
Tests for passenger_phone/document_id on POST /tickets/, GET /tickets/{id}/,
and GET /tickets/my/ (closes the "integrator-supplied passenger details"
part of gap C5). Same side-table pattern, and same real-Postgres testing
discipline, as test_payment_reference.py — deliberately does NOT mock
tenant_db.store_passenger_details/enrich_passenger_details, since the whole
point is proving the new public.public_api_ticket_passenger_details table
genuinely persists and retrieves values end-to-end, not just that the
router calls a mock correctly.

Requires a real DATABASE_URL pointing at a reachable Postgres, same as
test_payment_reference.py.
"""
import asyncio
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt as jose_jwt

from backend.fastapi_services.config import settings as fastapi_settings
from backend.fastapi_services.main import app
from backend.fastapi_services.public_api import router as public_api_router

JWT_SECRET = fastapi_settings.JWT_SECRET_KEY
JWT_ALG = fastapi_settings.JWT_ALGORITHM


@pytest.fixture(autouse=True)
def _reset_engine():
    """See test_payment_reference.py's identical fixture for why this is needed."""
    public_api_router.tenant_db._engine = None
    yield
    public_api_router.tenant_db._engine = None


class FakeDjangoResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _conductor_token(schema):
    return jose_jwt.encode(
        {"user_id": "conductor-1", "role": "CONDUCTOR", "tenant_schema": schema}, JWT_SECRET, algorithm=JWT_ALG
    )


def _passenger_token(user_id):
    return jose_jwt.encode({"user_id": user_id, "role": "PASSENGER", "tenant_schema": ""}, JWT_SECRET, algorithm=JWT_ALG)


def _unique_ticket_uid():
    return f"TKT-TEST{uuid.uuid4().hex[:12].upper()}"


def _base_ticket(ticket_uid, passenger_id, **overrides):
    ticket = {
        "id": "tkt-row-" + uuid.uuid4().hex[:8],
        "ticket_uid": ticket_uid,
        "tenant_schema": "tenant_a",
        "ticket_type_id": None,
        "trip_id": None,
        "passenger_id": passenger_id,
        "passenger_name": "Test Passenger",
        "conductor_id": "conductor-1",
        "issued_at": "2026-07-26T10:00:00Z",
        "issued_by": "CONDUCTOR",
        "valid_until": "2026-07-26T23:59:59Z",
        "fare_paid": "30.00",
        "payment_method": "CASH",
        "status": "VALID",
        "from_stop_id": None,
        "to_stop_id": None,
    }
    ticket.update(overrides)
    return ticket


async def _post(ac, path, json_body, token):
    return await ac.post(f"/public-api/v1{path}", json=json_body, headers={"Authorization": f"Bearer {token}"})


async def _get(ac, path, token):
    return await ac.get(f"/public-api/v1{path}", headers={"Authorization": f"Bearer {token}"})


def test_passenger_details_persist_and_are_returned_by_get_ticket_and_my_tickets():
    ticket_uid = _unique_ticket_uid()
    passenger_id = "passenger-" + uuid.uuid4().hex[:8]
    django_ticket_response = {
        "success": True,
        "data": {"id": "tkt-row-1", "ticket_uid": ticket_uid, "status": "VALID"},
        "message": "Ticket issued successfully.",
        "errors": None,
    }

    async def _run():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            with patch.object(
                public_api_router.tenant_db,
                "get_domain_for_schema",
                new=AsyncMock(return_value="tenant-a.kvbms.com.np"),
            ), patch.object(
                public_api_router,
                "_proxy_to_django",
                new=AsyncMock(return_value=FakeDjangoResponse(201, django_ticket_response)),
            ):
                # camelCase, on purpose -- exercises the field-alias shim end-to-end,
                # all the way through to the real side-table.
                issue_resp = await _post(
                    ac,
                    "/tickets/",
                    {"route_id": "r1", "passengerPhone": "+9779811112222", "documentId": "CITZ-998877"},
                    _conductor_token("tenant_a"),
                )
            assert issue_resp.status_code == 201, issue_resp.text

            stored_ticket = _base_ticket(ticket_uid, passenger_id)
            with patch.object(
                public_api_router.tenant_db,
                "find_ticket_by_id",
                new=AsyncMock(return_value=("tenant_a", stored_ticket)),
            ):
                get_resp = await _get(ac, "/tickets/tkt-row-1/", _passenger_token(passenger_id))
            assert get_resp.status_code == 200, get_resp.text
            assert get_resp.json()["data"]["passenger_phone"] == "+9779811112222"
            assert get_resp.json()["data"]["document_id"] == "CITZ-998877"

            with patch.object(
                public_api_router.tenant_db,
                "find_tickets_for_passenger",
                new=AsyncMock(return_value=[_base_ticket(ticket_uid, passenger_id)]),
            ):
                my_resp = await _get(ac, "/tickets/my/", _passenger_token(passenger_id))
            assert my_resp.status_code == 200, my_resp.text
            assert my_resp.json()["data"][0]["passenger_phone"] == "+9779811112222"
            assert my_resp.json()["data"][0]["document_id"] == "CITZ-998877"

    asyncio.run(_run())


def test_issuing_without_passenger_details_still_works_and_returns_null():
    ticket_uid = _unique_ticket_uid()
    passenger_id = "passenger-" + uuid.uuid4().hex[:8]
    django_ticket_response = {
        "success": True,
        "data": {"id": "tkt-row-2", "ticket_uid": ticket_uid, "status": "VALID"},
        "message": "Ticket issued successfully.",
        "errors": None,
    }

    async def _run():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            with patch.object(
                public_api_router.tenant_db,
                "get_domain_for_schema",
                new=AsyncMock(return_value="tenant-a.kvbms.com.np"),
            ), patch.object(
                public_api_router,
                "_proxy_to_django",
                new=AsyncMock(return_value=FakeDjangoResponse(201, django_ticket_response)),
            ) as mock_proxy:
                issue_resp = await _post(ac, "/tickets/", {"route_id": "r1"}, _conductor_token("tenant_a"))
            assert issue_resp.status_code == 201, issue_resp.text
            # confirms nothing extra was even sent to Django for a caller who never
            # supplied either field
            assert "passenger_phone" not in mock_proxy.await_args.kwargs["json_body"]
            assert "document_id" not in mock_proxy.await_args.kwargs["json_body"]

            stored_ticket = _base_ticket(ticket_uid, passenger_id)
            with patch.object(
                public_api_router.tenant_db,
                "find_ticket_by_id",
                new=AsyncMock(return_value=("tenant_a", stored_ticket)),
            ):
                get_resp = await _get(ac, "/tickets/tkt-row-2/", _passenger_token(passenger_id))
            assert get_resp.status_code == 200, get_resp.text
            assert get_resp.json()["data"]["passenger_phone"] is None
            assert get_resp.json()["data"]["document_id"] is None

    asyncio.run(_run())


def test_ticketing_model_not_modified_for_passenger_details():
    """apps.ticketing is off-limits -- passenger_phone/document_id must never be added
    to the Django Ticket model. Plain text check (no Django import needed), mirroring
    test_payment_reference.py's identical guard, so this runs in the same lightweight,
    Django-free harness as the rest of this suite."""
    from pathlib import Path

    models_path = Path(__file__).resolve().parents[3] / "backend" / "apps" / "ticketing" / "models.py"
    content = models_path.read_text()
    for forbidden in ("passenger_phone", "document_id"):
        assert forbidden not in content, f"apps/ticketing/models.py must not gain a {forbidden!r} field"
