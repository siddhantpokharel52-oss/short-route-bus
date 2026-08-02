"""
Tests for the live money/ticket dashboard push: WS /api/v1/live/ws/tickets/
(backend/fastapi_services/live_ops/router.py).

This deliberately does NOT reimplement the ticket/revenue aggregation (that
logic lives once, in backend/apps/analytics/views.py, and is already
exercised by real-Postgres smoke testing there) -- it periodically calls the
existing Django analytics endpoint via _proxy_to_django and pushes whatever
comes back. So what's actually being tested here is the new glue: which
Django path/schema a token routes to (platform-wide vs one operator), that
the caller's original token (not something re-minted) is what's forwarded so
Django's own permission classes are the real gate, and that a non-2xx
response closes the connection instead of looping on the same rejection
forever.

_proxy_to_django and tenant_db are imported *by reference* into
live_ops.router's own namespace (`from ..public_api.router import
_proxy_to_django`), so mocks must patch them there, not on
public_api.router -- patching the origin module after the name's already
been bound into live_ops.router wouldn't affect what live_ops.router calls.
"""
import pytest
from fastapi.testclient import TestClient
from jose import jwt as jose_jwt
from unittest.mock import AsyncMock, patch

from backend.fastapi_services.config import settings as fastapi_settings
from backend.fastapi_services.main import app
from backend.fastapi_services.live_ops import router as live_ops_router

JWT_SECRET = fastapi_settings.JWT_SECRET_KEY
JWT_ALG = fastapi_settings.JWT_ALGORITHM


class FakeDjangoResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _token(role, tenant_schema="", user_id="staff-1", **extra):
    payload = {"user_id": user_id, "role": role, "tenant_schema": tenant_schema, **extra}
    return jose_jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


@pytest.fixture
def client():
    return TestClient(app)


def test_transport_authority_gets_city_wide_feed(client):
    with patch.object(
        live_ops_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="localhost")
    ), patch.object(
        live_ops_router,
        "_proxy_to_django",
        new=AsyncMock(
            return_value=FakeDjangoResponse(
                200, {"success": True, "data": {"ticket_count": 7}, "message": "Success", "errors": None}
            )
        ),
    ) as mock_proxy:
        token = _token("TRANSPORT_AUTHORITY_OFFICER", "")
        with client.websocket_connect(f"/api/v1/live/ws/tickets/?token={token}") as ws:
            pushed = ws.receive_json()

    assert pushed["data"]["ticket_count"] == 7
    assert mock_proxy.await_args.args[1] == "/api/v1/analytics/city/tickets/live/"
    assert mock_proxy.await_args.args[2] == "public"
    assert mock_proxy.await_args.args[4] == token  # the caller's own token, not a minted one


def test_operations_manager_gets_own_tenant_feed(client):
    with patch.object(
        live_ops_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        live_ops_router,
        "_proxy_to_django",
        new=AsyncMock(
            return_value=FakeDjangoResponse(
                200, {"success": True, "data": {"ticket_count": 3}, "message": "Success", "errors": None}
            )
        ),
    ) as mock_proxy:
        token = _token("OPERATIONS_MANAGER", "tenant_a")
        with client.websocket_connect(f"/api/v1/live/ws/tickets/?token={token}") as ws:
            pushed = ws.receive_json()

    assert pushed["data"]["ticket_count"] == 3
    assert mock_proxy.await_args.args[1] == "/api/v1/analytics/tickets/live/"
    assert mock_proxy.await_args.args[2] == "tenant_a"


def test_connect_rejected_without_token(client):
    from starlette.websockets import WebSocketDisconnect as ClientWebSocketDisconnect

    with pytest.raises(ClientWebSocketDisconnect) as exc_info:
        with client.websocket_connect("/api/v1/live/ws/tickets/"):
            pass
    assert exc_info.value.code == 1008


def test_connect_rejected_for_staff_with_no_tenant_and_non_authority_role(client):
    """A role that's neither city-dashboard-eligible nor tied to any tenant_schema has
    nowhere valid to route to -- must be rejected, not default to some fallback."""
    from starlette.websockets import WebSocketDisconnect as ClientWebSocketDisconnect

    token = _token("DRIVER", "")  # no tenant_schema, not a transport-authority role
    with pytest.raises(ClientWebSocketDisconnect) as exc_info:
        with client.websocket_connect(f"/api/v1/live/ws/tickets/?token={token}"):
            pass
    assert exc_info.value.code == 1008


def test_unresolvable_domain_closes_with_1011(client):
    with patch.object(live_ops_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value=None)):
        from starlette.websockets import WebSocketDisconnect as ClientWebSocketDisconnect

        token = _token("OPERATIONS_MANAGER", "ghost_tenant")
        with pytest.raises(ClientWebSocketDisconnect) as exc_info:
            with client.websocket_connect(f"/api/v1/live/ws/tickets/?token={token}"):
                pass
        assert exc_info.value.code == 1011


def test_django_permission_denial_is_relayed_then_connection_closes(client):
    """If Django rejects the forwarded token (e.g. a role that lost access mid-session),
    the client should see that one rejection, not get silently disconnected or looped
    on forever."""
    with patch.object(
        live_ops_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        live_ops_router,
        "_proxy_to_django",
        new=AsyncMock(
            return_value=FakeDjangoResponse(
                403,
                {"success": False, "data": None, "message": "Permission denied.", "errors": None},
            )
        ),
    ):
        from starlette.websockets import WebSocketDisconnect as ClientWebSocketDisconnect

        token = _token("OPERATIONS_MANAGER", "tenant_a")
        with pytest.raises(ClientWebSocketDisconnect):
            with client.websocket_connect(f"/api/v1/live/ws/tickets/?token={token}") as ws:
                pushed = ws.receive_json()
                assert pushed["message"] == "Permission denied."
                # server closes right after -- the next receive raises the disconnect
                ws.receive_json()
