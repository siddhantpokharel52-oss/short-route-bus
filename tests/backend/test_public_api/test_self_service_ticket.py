"""
Tests for city-bus journey step 4, "Ticket (optional, self-service)": a
PASSENGER-role caller may supply `route_id` (no trip_qr_token, no conductor
involved at all) plus a required `payment_reference` to buy a ticket ahead
of boarding. See router.py's issue_ticket() docstring and the module note
above _mint_self_service_token for the full design -- in short: proxies to
Django's TicketViewSet exactly like every other issuance path (no duplicated
ticket-creation logic), routed via a lazily-created, per-tenant, non-human
"self-service account" rather than a real conductor's identity, since there
is no staff member to borrow one from for this flow.

This exact flow -- including the real rest_framework_simplejwt requirement
that a forwarded token carry token_type="access" and jti, which a mocked
_proxy_to_django can never catch -- was verified against the live stack
(real Postgres, real Django, a real RouteAssignment row) before this file
was written; these are the mocked regression tests that lock the wiring in
going forward.
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt as jose_jwt

from backend.fastapi_services.config import settings as fastapi_settings
from backend.fastapi_services.dependencies import get_redis
from backend.fastapi_services.main import app
from backend.fastapi_services.public_api import router as public_api_router

JWT_SECRET = fastapi_settings.JWT_SECRET_KEY
JWT_ALG = fastapi_settings.JWT_ALGORITHM

PASSENGER_ID = "77777777-7777-7777-7777-777777777777"
ROUTE_ID = "route-abc-123"
SCHEMA_A = "tenant_a"
SCHEMA_B = "tenant_b"
SERVICE_ACCOUNT_ID = "svc-account-1"


class FakeDjangoResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class FakeRedis:
    """None of these tests exercise idempotency itself (see test_ticket_idempotency.py
    for that) -- this in-memory stand-in exists purely so issue_ticket()'s idempotency
    branch never reaches the real redis:// service. Without it, these tests would leak
    real keys into whatever Redis this process is configured against, and a later rerun
    could silently short-circuit on a stale cached result from a previous run instead of
    exercising the code path at all -- exactly what happened once while writing this
    file, caught by get_domain_for_schema unexpectedly showing zero calls."""

    def __init__(self):
        self.store: dict[str, str] = {}

    async def get(self, key):
        return self.store.get(key)

    async def set(self, key, value, ex=None, nx=False):
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True

    async def delete(self, key):
        self.store.pop(key, None)


def _passenger_token(user_id=PASSENGER_ID):
    return jose_jwt.encode(
        {"user_id": user_id, "role": "PASSENGER", "tenant_schema": ""}, JWT_SECRET, algorithm=JWT_ALG
    )


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def fake_redis():
    app.dependency_overrides[get_redis] = lambda: FakeRedis()
    yield
    app.dependency_overrides.pop(get_redis, None)


def _base_payload(**overrides):
    payload = {
        "route_id": ROUTE_ID,
        "from_stop_id": "stop-1",
        "to_stop_id": "stop-2",
        "fare_paid": "25.00",
        "payment_method": "ESEWA",
        "payment_reference": "ESEWA-TXN-001",
    }
    payload.update(overrides)
    return payload


def test_self_service_purchase_succeeds_for_single_operator_route(client):
    with patch.object(
        public_api_router.tenant_db, "get_route_operator_schemas", new=AsyncMock(return_value=[SCHEMA_A])
    ), patch.object(
        public_api_router.tenant_db, "get_or_create_self_service_account", new=AsyncMock(return_value=SERVICE_ACCOUNT_ID)
    ) as mock_account, patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ) as mock_domain, patch.object(
        public_api_router,
        "_proxy_to_django",
        new=AsyncMock(
            return_value=FakeDjangoResponse(
                201,
                {
                    "success": True,
                    "data": {"ticket_uid": "TKT-SELF1", "passenger_id": PASSENGER_ID, "issued_by": "MOBILE"},
                    "message": "Ticket issued.",
                    "errors": None,
                },
            )
        ),
    ) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json=_base_payload(),
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 201, resp.text
    mock_account.assert_awaited_once_with(SCHEMA_A)
    mock_domain.assert_awaited_once_with(SCHEMA_A)
    mock_proxy.assert_awaited_once()

    args = mock_proxy.await_args.args
    assert args[2] == SCHEMA_A  # schema
    used_bearer = args[4]
    decoded = jose_jwt.decode(used_bearer, JWT_SECRET, algorithms=[JWT_ALG])
    assert decoded["user_id"] == SERVICE_ACCOUNT_ID
    assert decoded["role"] == "PASSENGER"
    assert decoded["tenant_schema"] == SCHEMA_A
    assert decoded["token_type"] == "access"
    assert "jti" in decoded
    assert used_bearer != _passenger_token()  # never the passenger's own token

    sent_payload = mock_proxy.await_args.kwargs["json_body"]
    assert sent_payload["passenger_id"] == PASSENGER_ID
    assert sent_payload["issued_by"] == "MOBILE"
    assert sent_payload["from_stop_id"] == "stop-1"
    assert "route_id" not in sent_payload
    assert "tenant_schema" not in sent_payload
    assert "payment_reference" not in sent_payload
    assert "trip_id" not in sent_payload  # city-bus tickets are never tied to a trip


def test_self_service_purchase_with_ticket_type_resolves_and_forwards_id(client):
    """Yatroo's spec wants a ticket_type (e.g. ADULT/STUDENT) selectable at
    purchase time -- Ticket stores ticket_type_id (a FK), not the code, so
    this must resolve via tenant_db before reaching Django."""
    with patch.object(
        public_api_router.tenant_db, "get_route_operator_schemas", new=AsyncMock(return_value=[SCHEMA_A])
    ), patch.object(
        public_api_router.tenant_db, "get_or_create_self_service_account", new=AsyncMock(return_value=SERVICE_ACCOUNT_ID)
    ), patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        public_api_router.tenant_db, "resolve_ticket_type_id", new=AsyncMock(return_value="tt-adult-1")
    ) as mock_resolve, patch.object(
        public_api_router,
        "_proxy_to_django",
        new=AsyncMock(
            return_value=FakeDjangoResponse(
                201,
                {"success": True, "data": {"ticket_uid": "TKT-SELF2", "passenger_id": PASSENGER_ID}, "message": "", "errors": None},
            )
        ),
    ) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json=_base_payload(ticket_type="adult"),
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 201, resp.text
    mock_resolve.assert_awaited_once_with("ADULT")  # normalized to uppercase
    sent_payload = mock_proxy.await_args.kwargs["json_body"]
    assert sent_payload["ticket_type_id"] == "tt-adult-1"
    assert "ticket_type" not in sent_payload  # the code itself is never a real Ticket field


def test_self_service_purchase_with_unknown_ticket_type_returns_400(client):
    with patch.object(
        public_api_router.tenant_db, "get_route_operator_schemas", new=AsyncMock(return_value=[SCHEMA_A])
    ), patch.object(
        public_api_router.tenant_db, "get_or_create_self_service_account", new=AsyncMock()
    ) as mock_account, patch.object(
        public_api_router.tenant_db, "resolve_ticket_type_id", new=AsyncMock(return_value=None)
    ), patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json=_base_payload(ticket_type="NOT-A-REAL-TYPE"),
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 400, resp.text
    mock_account.assert_not_called()
    mock_proxy.assert_not_called()


def test_self_service_purchase_without_ticket_type_omits_it(client):
    """ticket_type stays optional -- existing callers that never send it keep working
    unchanged, with no ticket_type_id forced onto the Django payload."""
    with patch.object(
        public_api_router.tenant_db, "get_route_operator_schemas", new=AsyncMock(return_value=[SCHEMA_A])
    ), patch.object(
        public_api_router.tenant_db, "get_or_create_self_service_account", new=AsyncMock(return_value=SERVICE_ACCOUNT_ID)
    ), patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        public_api_router.tenant_db, "resolve_ticket_type_id", new=AsyncMock()
    ) as mock_resolve, patch.object(
        public_api_router,
        "_proxy_to_django",
        new=AsyncMock(
            return_value=FakeDjangoResponse(
                201,
                {"success": True, "data": {"ticket_uid": "TKT-SELF3", "passenger_id": PASSENGER_ID}, "message": "", "errors": None},
            )
        ),
    ) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json=_base_payload(),
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 201, resp.text
    mock_resolve.assert_not_called()
    assert "ticket_type_id" not in mock_proxy.await_args.kwargs["json_body"]


def test_self_service_purchase_requires_payment_reference(client):
    with patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy, patch.object(
        public_api_router.tenant_db, "get_route_operator_schemas", new=AsyncMock()
    ) as mock_schemas:
        resp = client.post(
            "/public-api/v1/tickets/",
            json=_base_payload(payment_reference=None),
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 400, resp.text
    assert "payment_reference" in resp.json()["message"]
    mock_schemas.assert_not_called()  # rejected before even resolving the route
    mock_proxy.assert_not_called()


def test_self_service_purchase_rejects_blank_payment_reference(client):
    with patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json=_base_payload(payment_reference="   "),
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 400, resp.text
    mock_proxy.assert_not_called()


def test_self_service_purchase_404s_for_route_with_no_operator(client):
    with patch.object(
        public_api_router.tenant_db, "get_route_operator_schemas", new=AsyncMock(return_value=[])
    ), patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json=_base_payload(),
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 404, resp.text
    mock_proxy.assert_not_called()


def test_self_service_purchase_requires_tenant_schema_for_shared_route(client):
    with patch.object(
        public_api_router.tenant_db, "get_route_operator_schemas", new=AsyncMock(return_value=[SCHEMA_A, SCHEMA_B])
    ), patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json=_base_payload(),  # no tenant_schema
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 400, resp.text
    body = resp.json()
    assert set(body["errors"]["operators"]) == {SCHEMA_A, SCHEMA_B}
    mock_proxy.assert_not_called()


def test_self_service_purchase_honors_explicit_tenant_schema_for_shared_route(client):
    with patch.object(
        public_api_router.tenant_db, "get_route_operator_schemas", new=AsyncMock(return_value=[SCHEMA_A, SCHEMA_B])
    ), patch.object(
        public_api_router.tenant_db, "get_or_create_self_service_account", new=AsyncMock(return_value=SERVICE_ACCOUNT_ID)
    ), patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-b.kvbms.com.np")
    ) as mock_domain, patch.object(
        public_api_router,
        "_proxy_to_django",
        new=AsyncMock(
            return_value=FakeDjangoResponse(201, {"success": True, "data": {}, "message": "Ticket issued.", "errors": None})
        ),
    ) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json=_base_payload(tenant_schema=SCHEMA_B),
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 201, resp.text
    mock_domain.assert_awaited_once_with(SCHEMA_B)
    assert mock_proxy.await_args.args[2] == SCHEMA_B


def test_self_service_purchase_rejects_tenant_schema_not_in_operator_list(client):
    with patch.object(
        public_api_router.tenant_db, "get_route_operator_schemas", new=AsyncMock(return_value=[SCHEMA_A, SCHEMA_B])
    ), patch.object(public_api_router, "_proxy_to_django", new=AsyncMock()) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json=_base_payload(tenant_schema="some_other_operator"),
            headers={"Authorization": f"Bearer {_passenger_token()}"},
        )

    assert resp.status_code == 400, resp.text
    mock_proxy.assert_not_called()


def test_conductor_direct_path_still_unaffected_by_self_service_feature(client):
    """Regression: adding the route_id-driven self-service branch to the PASSENGER arm
    must not change anything about the pre-existing CONDUCTOR-role path."""
    conductor_token = jose_jwt.encode(
        {"user_id": "conductor-1", "role": "CONDUCTOR", "tenant_schema": SCHEMA_A}, JWT_SECRET, algorithm=JWT_ALG
    )
    with patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        public_api_router.tenant_db, "get_route_operator_schemas", new=AsyncMock()
    ) as mock_schemas, patch.object(
        public_api_router,
        "_proxy_to_django",
        new=AsyncMock(
            return_value=FakeDjangoResponse(201, {"success": True, "data": {}, "message": "Ticket issued.", "errors": None})
        ),
    ) as mock_proxy:
        resp = client.post(
            "/public-api/v1/tickets/",
            json={"route_id": ROUTE_ID, "fare_paid": "25.00"},  # even with route_id present
            headers={"Authorization": f"Bearer {conductor_token}"},
        )

    assert resp.status_code == 201, resp.text
    assert mock_proxy.await_args.args[4] == conductor_token  # conductor's own token, not a minted one
    mock_schemas.assert_not_called()  # the self-service branch never runs for a CONDUCTOR token
