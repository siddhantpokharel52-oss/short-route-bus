"""
Tests for the `since` filter on GET /tickets/my/ — the "conductor issues
ticket → shows in Yatroo app" flow. No push/WebSocket delivery is built here
(deliberately deferred, see docs/API.md §1.4); instead this makes
short-interval client-side polling cheap: pass `since` and only newly issued
tickets come back, instead of the passenger's whole ticket history every
poll.

Critical regression covered here: `since` must reach tenant_db as a real
datetime, not the raw query-string. asyncpg raises DataError on a string
bound against a timestamptz comparison — and because
find_tickets_for_passenger's per-schema query is wrapped in a broad
try/except (by design, so one schema's transient failure doesn't kill a
cross-schema scan), that error is silently swallowed rather than surfaced,
so the bug reads as "since always returns an empty list", not a crash. This
was caught with a real Postgres smoke test before these mocked tests were
even written — mocking tenant_db here would not have caught it, since the
mock doesn't care what type it's called with. router._parse and the type
conversion it's paired with is the actual fix; these tests guard the
call-shape (that a datetime, not a string, is what tenant_db receives).
"""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt as jose_jwt

from backend.fastapi_services.config import settings as fastapi_settings
from backend.fastapi_services.main import app
from backend.fastapi_services.public_api import router as public_api_router

JWT_SECRET = fastapi_settings.JWT_SECRET_KEY
JWT_ALG = fastapi_settings.JWT_ALGORITHM


def _passenger_token(user_id):
    return jose_jwt.encode({"user_id": user_id, "role": "PASSENGER", "tenant_schema": ""}, JWT_SECRET, algorithm=JWT_ALG)


@pytest.fixture
def client():
    return TestClient(app)


def test_my_tickets_without_since_passes_none(client):
    with patch.object(
        public_api_router.tenant_db, "find_tickets_for_passenger", new=AsyncMock(return_value=[])
    ) as mock_find, patch.object(
        public_api_router.tenant_db, "enrich_stop_names", new=AsyncMock()
    ), patch.object(public_api_router.tenant_db, "enrich_payment_references", new=AsyncMock()), patch.object(
        public_api_router.tenant_db, "enrich_passenger_details", new=AsyncMock()
    ):
        resp = client.get(
            "/public-api/v1/tickets/my/", headers={"Authorization": f"Bearer {_passenger_token('pax-1')}"}
        )

    assert resp.status_code == 200, resp.text
    mock_find.assert_awaited_once_with("pax-1", since=None)


def test_my_tickets_with_since_passes_a_real_datetime_not_a_string(client):
    with patch.object(
        public_api_router.tenant_db, "find_tickets_for_passenger", new=AsyncMock(return_value=[])
    ) as mock_find, patch.object(
        public_api_router.tenant_db, "enrich_stop_names", new=AsyncMock()
    ), patch.object(public_api_router.tenant_db, "enrich_payment_references", new=AsyncMock()), patch.object(
        public_api_router.tenant_db, "enrich_passenger_details", new=AsyncMock()
    ):
        resp = client.get(
            "/public-api/v1/tickets/my/?since=2026-08-02T05:00:00Z",
            headers={"Authorization": f"Bearer {_passenger_token('pax-1')}"},
        )

    assert resp.status_code == 200, resp.text
    mock_find.assert_awaited_once()
    called_since = mock_find.await_args.kwargs["since"]
    # The load-bearing assertion: a datetime instance, never the raw query string —
    # this is exactly what asyncpg rejects if it's still a str.
    assert isinstance(called_since, datetime), f"expected a datetime, got {type(called_since)}"
    assert called_since == datetime(2026, 8, 2, 5, 0, 0, tzinfo=timezone.utc)


def test_my_tickets_with_invalid_since_returns_400_before_querying(client):
    with patch.object(
        public_api_router.tenant_db, "find_tickets_for_passenger", new=AsyncMock()
    ) as mock_find:
        resp = client.get(
            "/public-api/v1/tickets/my/?since=not-a-timestamp",
            headers={"Authorization": f"Bearer {_passenger_token('pax-1')}"},
        )

    assert resp.status_code == 400, resp.text
    assert resp.json()["success"] is False
    mock_find.assert_not_called()
