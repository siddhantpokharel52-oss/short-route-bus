"""
Cross-tenant authorization tests for the /public-api/v1/tickets/ proxy path
(backend/fastapi_services/public_api/router.py).

These exercise the FastAPI app directly (via TestClient, no Django ORM
involved) and mock out tenant_db's DB access plus the Django HTTP proxy call,
so no live Postgres/Django is required to run them. What they're actually
checking is authorization *before* a proxy call is made — i.e. that a
cross-tenant attempt never reaches _proxy_to_django in the first place, not
just that Django would have rejected it if it had. mock.assert_not_called()
on _proxy_to_django is therefore the load-bearing assertion in the negative
cases, not just the resulting HTTP status code.

Run (no live DB needed): from the repo root,
    DATABASE_URL=postgresql+asyncpg://u:p@localhost/db \\
    REDIS_URL=redis://localhost:6379/0 \\
    JWT_SECRET_KEY=test \\
    pytest tests/backend/test_public_api/test_ticket_proxy.py -p no:django -v
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

TICKET_ID = "11111111-1111-1111-1111-111111111111"

BASE_TICKET = {
    "id": TICKET_ID,
    "ticket_uid": "TKT-AAA111",
    "ticket_type_id": None,
    "trip_id": None,
    "passenger_id": "22222222-2222-2222-2222-222222222222",
    "passenger_name": "Test Passenger",
    "conductor_id": "33333333-3333-3333-3333-333333333333",
    "issued_at": "2026-07-19T10:00:00Z",
    "issued_by": "CONDUCTOR",
    "valid_until": "2026-07-19T23:59:59Z",
    "fare_paid": "30.00",
    "payment_method": "CASH",
    "status": "VALID",
    "from_stop_id": None,
    "to_stop_id": None,
}


class FakeDjangoResponse:
    """Stands in for httpx.Response — _passthrough() only needs .status_code and .json()."""

    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _token(role, tenant_schema="", **extra_claims):
    payload = {"user_id": "user-1", "role": role, "tenant_schema": tenant_schema, **extra_claims}
    return jose_jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def _conductor_token(schema):
    return _token("CONDUCTOR", schema)


def _passenger_token():
    return _token("PASSENGER", "")


@pytest.fixture
def client():
    return TestClient(app)


# ─────────────────────────────────────────────────────────────────────────────
# 1. Valid conductor token, own tenant's ticket → succeeds, proxied to the
#    conductor's own schema.
# ─────────────────────────────────────────────────────────────────────────────

def test_conductor_can_validate_own_tenant_ticket(client):
    ticket = {**BASE_TICKET, "tenant_schema": "tenant_a"}
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
                {"success": True, "data": {"status": "USED"}, "message": "Ticket valid and marked as used.", "errors": None},
            )
        ),
    ) as mock_proxy:
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/validate/",
            headers={"Authorization": f"Bearer {_conductor_token('tenant_a')}"},
        )

    assert resp.status_code == 200, resp.text
    assert resp.json()["success"] is True
    mock_proxy.assert_awaited_once()
    assert mock_proxy.await_args.args[2] == "tenant_a"  # routed to the conductor's own schema


# ─────────────────────────────────────────────────────────────────────────────
# 1b. Optional boarding_stop_id check (closes gap C6) — a ticket bought for
#     one stop can no longer be silently validated as if boarded at another,
#     when the conductor's app actually sends where the passenger boarded.
#     Caught live: the mismatch path originally 500'd (ticket["from_stop_id"]
#     is a raw uuid.UUID from asyncpg, not JSON-serializable) rather than
#     cleanly 403ing — these tests use string stop ids (as every mocked test
#     in this suite does), so they wouldn't have caught that particular bug;
#     it was only visible against the real asyncpg row shape.
# ─────────────────────────────────────────────────────────────────────────────

def test_validate_with_matching_boarding_stop_id_succeeds(client):
    ticket = {**BASE_TICKET, "tenant_schema": "tenant_a", "from_stop_id": "stop-A"}
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
                {"success": True, "data": {"status": "USED"}, "message": "Ticket valid and marked as used.", "errors": None},
            )
        ),
    ) as mock_proxy:
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/validate/",
            json={"boarding_stop_id": "stop-A"},
            headers={"Authorization": f"Bearer {_conductor_token('tenant_a')}"},
        )

    assert resp.status_code == 200, resp.text
    mock_proxy.assert_awaited_once()


def test_validate_with_mismatched_boarding_stop_id_rejected_before_proxy(client):
    ticket = {**BASE_TICKET, "tenant_schema": "tenant_a", "from_stop_id": "stop-A"}
    with patch.object(
        public_api_router.tenant_db, "find_ticket_by_id", new=AsyncMock(return_value=("tenant_a", ticket))
    ), patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock()
    ) as mock_domain, patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/validate/",
            json={"boarding_stop_id": "stop-B"},
            headers={"Authorization": f"Bearer {_conductor_token('tenant_a')}"},
        )

    assert resp.status_code == 403, resp.text
    assert resp.json()["success"] is False
    assert resp.json()["errors"]["expected_boarding_stop_id"] == "stop-A"
    # never even resolves the tenant's domain -- the mismatch is rejected before any
    # proxy call could mark the ticket USED
    mock_domain.assert_not_called()
    mock_proxy.assert_not_called()


def test_validate_without_boarding_stop_id_keeps_existing_behavior(client):
    """Backward compatibility: a conductor app that hasn't been updated to send
    boarding_stop_id must keep working exactly as before -- exists/unused/unexpired
    only, same as this endpoint behaved before gap C6 was closed."""
    ticket = {**BASE_TICKET, "tenant_schema": "tenant_a", "from_stop_id": "stop-A"}
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
                {"success": True, "data": {"status": "USED"}, "message": "Ticket valid and marked as used.", "errors": None},
            )
        ),
    ) as mock_proxy:
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/validate/",
            headers={"Authorization": f"Bearer {_conductor_token('tenant_a')}"},
        )

    assert resp.status_code == 200, resp.text
    mock_proxy.assert_awaited_once()


# ─────────────────────────────────────────────────────────────────────────────
# 2. Conductor from tenant A tries to validate a ticket owned by tenant B →
#    rejected, and — critically — the Django proxy is never even called.
# ─────────────────────────────────────────────────────────────────────────────

def test_conductor_cannot_validate_other_tenants_ticket(client):
    ticket = {**BASE_TICKET, "tenant_schema": "tenant_b"}
    with patch.object(
        public_api_router.tenant_db, "find_ticket_by_id", new=AsyncMock(return_value=("tenant_b", ticket))
    ), patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock()
    ) as mock_domain, patch.object(
        public_api_router, "_proxy_to_django", new=AsyncMock()
    ) as mock_proxy:
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/validate/",
            headers={"Authorization": f"Bearer {_conductor_token('tenant_a')}"},
        )

    assert resp.status_code == 403, resp.text
    assert resp.json()["success"] is False
    mock_domain.assert_not_called()  # short-circuited before even resolving where tenant_b lives
    mock_proxy.assert_not_called()  # never routed anywhere — not "routed and Django rejected it"


# ─────────────────────────────────────────────────────────────────────────────
# 3. Invalid / expired bearer token → rejected before the route handler (and
#    therefore before any DB lookup or Django proxy call) ever runs.
# ─────────────────────────────────────────────────────────────────────────────

def test_garbage_token_rejected_before_proxy(client):
    with patch.object(
        public_api_router.tenant_db, "find_ticket_by_id", new=AsyncMock()
    ) as mock_find, patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/validate/",
            headers={"Authorization": "Bearer not-a-real-jwt"},
        )

    assert resp.status_code == 401, resp.text
    mock_find.assert_not_called()
    mock_proxy.assert_not_called()


def test_expired_token_rejected_before_proxy(client):
    expired = _token("CONDUCTOR", "tenant_a", exp=int(time.time()) - 10)
    with patch.object(
        public_api_router.tenant_db, "find_ticket_by_id", new=AsyncMock()
    ) as mock_find, patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/validate/",
            headers={"Authorization": f"Bearer {expired}"},
        )

    assert resp.status_code == 401, resp.text
    mock_find.assert_not_called()
    mock_proxy.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# 4. Non-conductor role attempting the conductor-only endpoints → rejected.
# ─────────────────────────────────────────────────────────────────────────────

def test_passenger_cannot_issue_ticket(client):
    """A passenger with neither a trip_qr_token (scan-to-book) nor a route_id
    (self-service purchase, see test_self_service_ticket.py) has no valid path into
    this endpoint at all -- deliberately payload-free so this test can't be confused
    with either of those two newer, legitimate passenger paths."""
    with patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json={},
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 403, resp.text
    mock_proxy.assert_not_called()


def test_passenger_cannot_validate_ticket(client):
    with patch.object(
        public_api_router.tenant_db, "find_ticket_by_id", new=AsyncMock()
    ) as mock_find, patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            f"/public-api/v1/tickets/{TICKET_ID}/validate/",
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 403, resp.text
    mock_find.assert_not_called()
    mock_proxy.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# Bonus: the Host-header-swap proxy technique is driven entirely by the
# server-verified JWT tenant_schema claim — a caller-supplied schema/tenant
# value, in either the JSON body or a spoofed X-Tenant-Slug header, must not
# influence which tenant the request gets routed to.
# ─────────────────────────────────────────────────────────────────────────────

def test_issue_ticket_ignores_client_supplied_schema_fields(client):
    with patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ) as mock_domain, patch.object(
        public_api_router,
        "_proxy_to_django",
        new=AsyncMock(
            return_value=FakeDjangoResponse(201, {"success": True, "data": {}, "message": "Ticket issued.", "errors": None})
        ),
    ) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json={"route_id": "r1", "tenant_schema": "tenant_b", "schema": "tenant_b"},
            headers={
                "Authorization": f"Bearer {_conductor_token('tenant_a')}",
                "X-Tenant-Slug": "tenant_b",
            },
        )

    assert resp.status_code == 201, resp.text
    mock_domain.assert_awaited_once_with("tenant_a")
    assert mock_proxy.await_args.args[2] == "tenant_a"  # routed to the JWT's tenant, not the spoofed one
