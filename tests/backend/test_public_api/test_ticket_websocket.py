"""
Tests for "conductor issues ticket -> shows in Yatroo app, instantly":
WS /public-api/v1/ws/tickets/ (backend/fastapi_services/public_api/router.py).

This is the WebSocket push upgrade on top of the pre-existing GET
/tickets/my/?since= polling path (still the reliable catch-up mechanism,
unchanged and untouched by this file). See the module comment in router.py
above the WS route for the full design (query-param JWT auth, in-memory
ConnectionManager, why a broadcast failure never fails ticket issuance).

Uses FastAPI's TestClient WebSocket test support (a real, in-process
WebSocket handshake — not a mock of the ASGI layer) combined with mocking
tenant_db/_proxy_to_django exactly like test_ticket_proxy.py, so no live
Postgres/Redis/Django is required.
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

PASSENGER_ID = "22222222-2222-2222-2222-222222222222"
OTHER_PASSENGER_ID = "99999999-9999-9999-9999-999999999999"
SCHEMA = "tenant_a"


class FakeDjangoResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _token(role, tenant_schema="", user_id="user-1", **extra_claims):
    payload = {"user_id": user_id, "role": role, "tenant_schema": tenant_schema, **extra_claims}
    return jose_jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def _passenger_token(user_id=PASSENGER_ID):
    return _token("PASSENGER", "", user_id=user_id)


def _conductor_token(schema=SCHEMA, user_id="conductor-1"):
    return _token("CONDUCTOR", schema, user_id=user_id)


@pytest.fixture
def client():
    return TestClient(app)


def test_passenger_can_connect_and_receives_ticket_on_issuance(client):
    with client.websocket_connect(f"/public-api/v1/ws/tickets/?token={_passenger_token()}") as ws:
        with patch.object(
            public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
        ), patch.object(
            public_api_router,
            "_proxy_to_django",
            new=AsyncMock(
                return_value=FakeDjangoResponse(
                    201,
                    {
                        "success": True,
                        "data": {"ticket_uid": "TKT-WS1", "passenger_id": PASSENGER_ID, "qr_code": "base64=="},
                        "message": "Ticket issued.",
                        "errors": None,
                    },
                )
            ),
        ):
            resp = client.post(
                "/public-api/v1/tickets/",
                json={"route_id": "r1"},
                headers={"Authorization": f"Bearer {_conductor_token()}"},
            )
        assert resp.status_code == 201, resp.text

        pushed = ws.receive_json()

    assert pushed["event"] == "ticket_issued"
    assert pushed["data"]["ticket_uid"] == "TKT-WS1"
    assert pushed["data"]["passenger_id"] == PASSENGER_ID


def test_passenger_never_receives_another_passengers_ticket(client):
    with client.websocket_connect(f"/public-api/v1/ws/tickets/?token={_passenger_token(PASSENGER_ID)}") as ws:
        with patch.object(
            public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
        ), patch.object(
            public_api_router,
            "_proxy_to_django",
            new=AsyncMock(
                return_value=FakeDjangoResponse(
                    201,
                    {
                        "success": True,
                        "data": {"ticket_uid": "TKT-OTHER", "passenger_id": OTHER_PASSENGER_ID},
                        "message": "Ticket issued.",
                        "errors": None,
                    },
                )
            ),
        ):
            resp = client.post(
                "/public-api/v1/tickets/",
                json={"route_id": "r1"},
                headers={"Authorization": f"Bearer {_conductor_token()}"},
            )
        assert resp.status_code == 201, resp.text

        # Nothing was broadcast to *this* passenger's group -- confirm the
        # connection is still open and simply has nothing queued, by racing a
        # fresh, unrelated ticket for this exact passenger and checking THAT
        # is what arrives (not the other passenger's ticket, and not a stale
        # queued message from the wrong group).
        with patch.object(
            public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
        ), patch.object(
            public_api_router,
            "_proxy_to_django",
            new=AsyncMock(
                return_value=FakeDjangoResponse(
                    201,
                    {
                        "success": True,
                        "data": {"ticket_uid": "TKT-MINE", "passenger_id": PASSENGER_ID},
                        "message": "Ticket issued.",
                        "errors": None,
                    },
                )
            ),
        ):
            resp2 = client.post(
                "/public-api/v1/tickets/",
                json={"route_id": "r1"},
                headers={"Authorization": f"Bearer {_conductor_token()}"},
            )
        assert resp2.status_code == 201, resp2.text

        pushed = ws.receive_json()

    assert pushed["data"]["ticket_uid"] == "TKT-MINE"


def test_connect_rejected_without_token(client):
    from starlette.websockets import WebSocketDisconnect as ClientWebSocketDisconnect

    with pytest.raises(ClientWebSocketDisconnect) as exc_info:
        with client.websocket_connect("/public-api/v1/ws/tickets/"):
            pass
    assert exc_info.value.code == 1008


def test_connect_rejected_with_garbage_token(client):
    from starlette.websockets import WebSocketDisconnect as ClientWebSocketDisconnect

    with pytest.raises(ClientWebSocketDisconnect) as exc_info:
        with client.websocket_connect("/public-api/v1/ws/tickets/?token=not-a-real-jwt"):
            pass
    assert exc_info.value.code == 1008


def test_connect_rejected_for_conductor_role(client):
    """This channel is passenger-only -- a conductor token (even though it's a
    perfectly valid, unexpired token) must not be able to listen on it."""
    from starlette.websockets import WebSocketDisconnect as ClientWebSocketDisconnect

    with pytest.raises(ClientWebSocketDisconnect) as exc_info:
        with client.websocket_connect(f"/public-api/v1/ws/tickets/?token={_conductor_token()}"):
            pass
    assert exc_info.value.code == 1008


def test_connect_rejected_for_expired_token(client):
    from starlette.websockets import WebSocketDisconnect as ClientWebSocketDisconnect

    expired = _token("PASSENGER", "", user_id=PASSENGER_ID, exp=int(time.time()) - 10)
    with pytest.raises(ClientWebSocketDisconnect) as exc_info:
        with client.websocket_connect(f"/public-api/v1/ws/tickets/?token={expired}"):
            pass
    assert exc_info.value.code == 1008


def test_broadcast_failure_does_not_break_ticket_issuance(client):
    """A WS send raising must never surface as a failed POST /tickets/ -- the ticket
    is already committed in Django by the time the broadcast runs."""
    with client.websocket_connect(f"/public-api/v1/ws/tickets/?token={_passenger_token()}"):
        with patch.object(
            public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
        ), patch.object(
            public_api_router,
            "_proxy_to_django",
            new=AsyncMock(
                return_value=FakeDjangoResponse(
                    201,
                    {
                        "success": True,
                        "data": {"ticket_uid": "TKT-BOOM", "passenger_id": PASSENGER_ID},
                        "message": "Ticket issued.",
                        "errors": None,
                    },
                )
            ),
        ), patch.object(
            public_api_router.ticket_ws_manager, "broadcast", new=AsyncMock(side_effect=RuntimeError("boom"))
        ):
            resp = client.post(
                "/public-api/v1/tickets/",
                json={"route_id": "r1"},
                headers={"Authorization": f"Bearer {_conductor_token()}"},
            )

    assert resp.status_code == 201, resp.text
    assert resp.json()["success"] is True


def test_no_broadcast_when_ticket_has_no_passenger_id(client):
    """A POS/no-passenger ticket (issued_by defaults to POS in Django when there's no
    passenger_id) must not attempt a broadcast at all -- there's no group to send to."""
    with patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        public_api_router,
        "_proxy_to_django",
        new=AsyncMock(
            return_value=FakeDjangoResponse(
                201,
                {"success": True, "data": {"ticket_uid": "TKT-NOPAX"}, "message": "Ticket issued.", "errors": None},
            )
        ),
    ), patch.object(public_api_router.ticket_ws_manager, "broadcast", new=AsyncMock()) as mock_broadcast:
        resp = client.post(
            "/public-api/v1/tickets/",
            json={"route_id": "r1"},
            headers={"Authorization": f"Bearer {_conductor_token()}"},
        )

    assert resp.status_code == 201, resp.text
    mock_broadcast.assert_not_called()
