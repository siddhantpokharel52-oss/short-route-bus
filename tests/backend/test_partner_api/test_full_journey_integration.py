"""
End-to-end integration test: proves a SINGLE token minted by
POST /partner/federated-login works across the entire passenger journey --
not just one endpoint (that's already covered in test_federated_login.py's
interoperability test), but the whole real-world sequence a Yatroo passenger
actually goes through: search a stop, search a route, check the fare, buy a
ticket, look it up, see it in "my tickets", and cancel it.

Every Master API call below is mocked at exactly the same seam the rest of
this suite already uses (tenant_db functions, _proxy_to_django) -- nothing
here re-verifies those endpoints' own internal correctness (that's each
endpoint's own test file's job). The one thing genuinely under test here is
that federated-login's token is accepted, without any special-casing,
by every step of the real journey in sequence.
"""
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
CITYBUS_USER_ID = "33333333-3333-3333-3333-333333333333"
ROUTE_ID = "route-journey-1"
SCHEMA = "mayurbus"


class FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}

    async def set(self, key, value, ex=None, nx=False):
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True

    async def get(self, key):
        return self.store.get(key)

    async def delete(self, key):
        self.store.pop(key, None)


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


def _sign_and_login(client, external_user_id="yatroo-journey-user"):
    import hashlib
    import hmac
    import json
    import time

    body = {"external_user_id": external_user_id, "email": "journey@example.com", "name": "Journey Rider"}
    ts = str(int(time.time()))
    nonce = "journey-nonce-1"
    compact = json.dumps(body, sort_keys=True, separators=(",", ":"))
    canonical = f"{ts}\n{nonce}\n{compact}"
    signature = hmac.new(SECRET.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    headers = {"X-Signature": signature, "X-Timestamp": ts, "X-Nonce": nonce}

    django_ok = _MockAsyncClient(_MockDjangoResponse(
        201, {"success": True, "data": {"user_id": CITYBUS_USER_ID, "created": True}, "message": "", "errors": None}
    ))
    with patch.object(partner_api_router.httpx, "AsyncClient", return_value=django_ok):
        resp = client.post("/public-api/v1/partner/federated-login", json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def test_full_passenger_journey_with_one_federated_login_token(client):
    token = _sign_and_login(client)
    auth = {"Authorization": f"Bearer {token}"}

    # 1. Search for a stop (no auth actually required on this endpoint, but the
    #    app would send the token anyway -- confirms it's harmless either way).
    with patch.object(
        public_api_router.tenant_db, "search_stops",
        new=AsyncMock(return_value=[{"id": "stop-1", "stop_code": "TEST-STOP-A", "name_en": "Ratnapark", "name_ne": "", "latitude": 27.7, "longitude": 85.3}]),
    ):
        resp = client.get("/public-api/v1/stops/autocomplete/?q=Ratna", headers=auth)
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"][0]["stop_code"] == "TEST-STOP-A"

    # 2. Search for a route between two stops.
    with patch.object(
        public_api_router.tenant_db, "fetch_routes_by_stop_pair",
        new=AsyncMock(return_value=[{
            "id": ROUTE_ID, "route_code": "22", "name_en": "Journey Route", "name_ne": "",
            "start_stop_id": None, "end_stop_id": None, "distance_km": "12.00", "route_type": "EXCLUSIVE",
            "status": "APPROVED", "geojson_path": "", "created_at": None, "updated_at": None,
            "from_sequence_no": 1, "to_sequence_no": 2,
        }]),
    ):
        resp = client.get("/public-api/v1/routes/?from_stop=TEST-STOP-A&to_stop=TEST-STOP-B", headers=auth)
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"][0]["id"] == ROUTE_ID

    # 3. Check the fare.
    with patch.object(
        public_api_router.tenant_db, "fetch_fares",
        new=AsyncMock(return_value=[{
            "id": "fare-1", "route_id": ROUTE_ID, "zone_from": "", "zone_to": "",
            "base_fare": "25.00", "peak_fare": "30.00", "student_fare": "15.00",
            "ticket_type_id": "tt-1", "ticket_type_code": "ADULT", "ticket_type_name": "Adult",
        }]),
    ):
        resp = client.get(
            f"/public-api/v1/fares/?route_id={ROUTE_ID}&from_stop=TEST-STOP-A&to_stop=TEST-STOP-B", headers=auth
        )
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"][0]["base_fare"] == "25.00"

    # 4. Buy the ticket (self-service -- no conductor present, matches the real
    #    Yatroo flow: Yatroo's own gateway already collected payment).
    ticket_uid = "TKT-JOURNEY1"
    with patch.object(
        public_api_router.tenant_db, "get_route_operator_schemas", new=AsyncMock(return_value=[SCHEMA])
    ), patch.object(
        public_api_router.tenant_db, "get_or_create_self_service_account", new=AsyncMock(return_value="svc-1")
    ), patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value=f"{SCHEMA}.citybus.com.np")
    ), patch.object(
        public_api_router,
        "_proxy_to_django",
        new=AsyncMock(return_value=_MockDjangoResponse(
            201,
            {"success": True, "data": {"id": "ticket-1", "ticket_uid": ticket_uid, "passenger_id": CITYBUS_USER_ID, "issued_by": "MOBILE", "status": "VALID"}, "message": "Ticket issued.", "errors": None},
        )),
    ) as mock_issue:
        resp = client.post(
            "/public-api/v1/tickets/",
            json={
                "route_id": ROUTE_ID, "from_stop_id": "stop-1", "to_stop_id": "stop-2",
                "fare_paid": "25.00", "payment_method": "ESEWA", "payment_reference": "ESEWA-TXN-JOURNEY-1",
                "idempotency_key": "journey-ticket-1",
            },
            headers=auth,
        )
    assert resp.status_code == 201, resp.text
    ticket_id = resp.json()["data"]["id"]
    assert resp.json()["data"]["passenger_id"] == CITYBUS_USER_ID
    # Confirm it really was OUR federated-login user_id driving this, not some
    # placeholder -- the passenger_id Django was told to attach the ticket to.
    sent_payload = mock_issue.await_args.kwargs["json_body"]
    assert sent_payload["passenger_id"] == CITYBUS_USER_ID

    # 5. Look the ticket up directly.
    ticket_row = {
        "id": ticket_id, "ticket_uid": ticket_uid, "tenant_schema": SCHEMA,
        "passenger_id": CITYBUS_USER_ID, "status": "VALID", "from_stop_id": "stop-1", "to_stop_id": "stop-2",
    }
    with patch.object(
        public_api_router.tenant_db, "find_ticket_by_id", new=AsyncMock(return_value=(SCHEMA, ticket_row))
    ), patch.object(
        public_api_router.tenant_db, "enrich_stop_names", new=AsyncMock()
    ), patch.object(
        public_api_router.tenant_db, "enrich_payment_references", new=AsyncMock()
    ), patch.object(
        public_api_router.tenant_db, "enrich_passenger_details", new=AsyncMock()
    ):
        resp = client.get(f"/public-api/v1/tickets/{ticket_id}/", headers=auth)
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"]["status"] == "VALID"

    # 6. "My tickets" shows it.
    with patch.object(
        public_api_router.tenant_db, "find_tickets_for_passenger", new=AsyncMock(return_value=[ticket_row])
    ) as mock_my, patch.object(
        public_api_router.tenant_db, "enrich_stop_names", new=AsyncMock()
    ), patch.object(
        public_api_router.tenant_db, "enrich_payment_references", new=AsyncMock()
    ), patch.object(
        public_api_router.tenant_db, "enrich_passenger_details", new=AsyncMock()
    ):
        resp = client.get("/public-api/v1/tickets/my/", headers=auth)
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["data"]) == 1
    assert mock_my.await_args.args[0] == CITYBUS_USER_ID

    # 7. Cancel it.
    with patch.object(
        public_api_router.tenant_db, "find_ticket_by_id", new=AsyncMock(return_value=(SCHEMA, ticket_row))
    ), patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value=f"{SCHEMA}.citybus.com.np")
    ), patch.object(
        public_api_router.tenant_db, "get_or_create_self_service_account", new=AsyncMock(return_value="svc-1")
    ), patch.object(
        public_api_router,
        "_proxy_to_django",
        new=AsyncMock(return_value=_MockDjangoResponse(
            200,
            {"success": True, "data": {"id": ticket_id, "status": "CANCELLED", "passenger_id": CITYBUS_USER_ID}, "message": "Ticket cancelled.", "errors": None},
        )),
    ):
        resp = client.post(f"/public-api/v1/tickets/{ticket_id}/cancel/", headers=auth)
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"]["status"] == "CANCELLED"
