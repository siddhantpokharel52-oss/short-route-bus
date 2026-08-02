"""
Tests for the payment_reference field on POST /tickets/, GET /tickets/{id}/,
and GET /tickets/my/ (closes gap C5).

Unlike the rest of tests/backend/test_public_api/, this file deliberately
does NOT mock tenant_db.store_payment_reference / enrich_payment_references
— the whole point is proving the new public.public_api_ticket_payment_ref
side-table genuinely persists and retrieves a value end-to-end, not just
that the router calls a mock correctly. Everything else this API can't
reach without a full tenant+ticket fixture (_proxy_to_django,
find_ticket_by_id, find_tickets_for_passenger, domain lookup) is still
mocked, same as the rest of the suite.

Tests that make multiple HTTP calls use httpx.AsyncClient + ASGITransport
inside a single asyncio.run(), not the sync TestClient — TestClient's
sync-to-async bridge can hand consecutive calls to different event loops,
which the real (non-mocked) async SQLAlchemy engine used here doesn't
tolerate (a cached engine/connection pool is bound to whichever loop
created it). A single asyncio.run() guarantees one consistent loop for
every call in a test, matching how the app actually runs in production
(uvicorn, one loop, indefinitely) — this is a test-harness detail, not
anything the router or storage code needs to account for.

Requires a real DATABASE_URL pointing at a reachable Postgres — e.g. the
project's own dev container (localhost:5435). Will fail with a connection
error without one, unlike its sibling test files in this directory.
"""
import asyncio
import uuid
from pathlib import Path
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
    """Each asyncio.run() call below spins up (and tears down) its own fresh event
    loop, but tenant_db.get_engine() caches its AsyncEngine at module level, bound to
    whichever loop first created it. Without resetting this between tests, the second
    test's asyncio.run() loop inherits a connection pool tied to the first test's
    already-closed loop and every query in it fails. Not a production concern — a real
    uvicorn process has exactly one loop for its whole lifetime — purely a test-harness
    detail from running multiple independent asyncio.run() calls in one process."""
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
        "payment_method": "ESEWA",
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


def test_payment_reference_persists_and_is_returned_by_get_ticket_and_my_tickets():
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
                issue_resp = await _post(
                    ac,
                    "/tickets/",
                    {"route_id": "r1", "payment_reference": "ESEWA-TXN-998877"},
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
            assert get_resp.json()["data"]["payment_reference"] == "ESEWA-TXN-998877"

            with patch.object(
                public_api_router.tenant_db,
                "find_tickets_for_passenger",
                new=AsyncMock(return_value=[_base_ticket(ticket_uid, passenger_id)]),
            ):
                my_resp = await _get(ac, "/tickets/my/", _passenger_token(passenger_id))
            assert my_resp.status_code == 200, my_resp.text
            assert my_resp.json()["data"][0]["payment_reference"] == "ESEWA-TXN-998877"

    asyncio.run(_run())


def test_issuing_without_payment_reference_still_works_and_returns_null():
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
                # no payment_reference at all — existing-caller shape
                issue_resp = await _post(ac, "/tickets/", {"route_id": "r1"}, _conductor_token("tenant_a"))
            assert issue_resp.status_code == 201, issue_resp.text
            # confirms this endpoint behaves exactly as before for callers who don't use
            # the new field — nothing extra was even sent to Django
            assert "payment_reference" not in mock_proxy.await_args.kwargs["json_body"]

            stored_ticket = _base_ticket(ticket_uid, passenger_id, payment_method="CASH")
            with patch.object(
                public_api_router.tenant_db,
                "find_ticket_by_id",
                new=AsyncMock(return_value=("tenant_a", stored_ticket)),
            ):
                get_resp = await _get(ac, "/tickets/tkt-row-2/", _passenger_token(passenger_id))
            assert get_resp.status_code == 200, get_resp.text
            assert get_resp.json()["data"]["payment_reference"] is None

    asyncio.run(_run())


def test_payment_reference_ignored_when_not_a_string():
    """A malformed payload (e.g. payment_reference as a number) should be treated the
    same as "not provided" — never crash ticket issuance over a bad optional field."""
    ticket_uid = _unique_ticket_uid()
    django_ticket_response = {
        "success": True,
        "data": {"id": "tkt-row-3", "ticket_uid": ticket_uid, "status": "VALID"},
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
                resp = await _post(
                    ac, "/tickets/", {"route_id": "r1", "payment_reference": 12345}, _conductor_token("tenant_a")
                )
            assert resp.status_code == 201, resp.text

    asyncio.run(_run())


def test_ticketing_model_not_modified_for_payment_reference():
    """apps.ticketing is off-limits — payment_reference must never be added to the
    Django Ticket model. Plain text check (no Django import needed) so this test runs
    in the same lightweight, Django-free harness as the rest of this suite."""
    models_path = Path(__file__).resolve().parents[3] / "backend" / "apps" / "ticketing" / "models.py"
    content = models_path.read_text()
    for forbidden in ("payment_reference", "external_reference", "gateway_ref"):
        assert forbidden not in content, f"apps/ticketing/models.py must not gain a {forbidden!r} field"
