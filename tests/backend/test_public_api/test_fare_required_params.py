"""
Tests for GET /public-api/v1/fares/ requiring route_id, from_stop, and
to_stop together (closes gap C4 — was previously accepting any subset,
including none of the three).

Mocks tenant_db.fetch_fares — no live Postgres needed. The stop-name-based fare
matching itself (from_stop/to_stop resolved to that stop's name_en, matched
against FareMatrix.zone_from/zone_to) lives in tenant_db.fetch_fares and is
verified against a live Postgres separately, not here; this file only tests
the required-params gate.
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.fastapi_services.main import app
from backend.fastapi_services.public_api import router as public_api_router

FARE = {
    "id": "fare-1",
    "route_id": "route-1",
    "zone_from": "A",
    "zone_to": "B",
    "base_fare": "30.00",
    "peak_fare": "35.00",
    "student_fare": "20.00",
    "ticket_type_id": "tt-1",
    "ticket_type_code": "REGULAR",
    "ticket_type_name": "Regular",
}


@pytest.fixture
def client():
    return TestClient(app)


def test_fares_with_all_three_params_succeeds(client):
    with patch.object(
        public_api_router.tenant_db, "fetch_fares", new=AsyncMock(return_value=[FARE])
    ) as mock_fetch:
        resp = client.get("/public-api/v1/fares/?route_id=route-1&from_stop=KTM01&to_stop=KTM09")

    assert resp.status_code == 200, resp.text
    assert resp.json()["data"][0]["route_id"] == "route-1"
    mock_fetch.assert_awaited_once_with(route_id="route-1", from_stop="KTM01", to_stop="KTM09")


def test_fares_surfaces_distance_and_time_when_present(client):
    """distance_km/time_minutes are computed by tenant_db.fetch_fares itself
    (route_id+from_stop+to_stop -> RouteStop delta, mocked away here) --
    this only confirms the router's serialization passes them through."""
    fare_with_distance = {**FARE, "distance_km": 9.2, "time_minutes": 35}
    with patch.object(
        public_api_router.tenant_db, "fetch_fares", new=AsyncMock(return_value=[fare_with_distance])
    ):
        resp = client.get("/public-api/v1/fares/?route_id=route-1&from_stop=KTM01&to_stop=KTM09")

    assert resp.status_code == 200, resp.text
    data = resp.json()["data"][0]
    assert data["distance_km"] == 9.2
    assert data["time_minutes"] == 35


def test_fares_missing_route_id_returns_400(client):
    with patch.object(public_api_router.tenant_db, "fetch_fares", new=AsyncMock()) as mock_fetch:
        resp = client.get("/public-api/v1/fares/?from_stop=KTM01&to_stop=KTM09")

    assert resp.status_code == 400, resp.text
    assert resp.json()["success"] is False
    mock_fetch.assert_not_called()


def test_fares_missing_from_stop_returns_400(client):
    with patch.object(public_api_router.tenant_db, "fetch_fares", new=AsyncMock()) as mock_fetch:
        resp = client.get("/public-api/v1/fares/?route_id=route-1&to_stop=KTM09")

    assert resp.status_code == 400, resp.text
    mock_fetch.assert_not_called()


def test_fares_missing_to_stop_returns_400(client):
    with patch.object(public_api_router.tenant_db, "fetch_fares", new=AsyncMock()) as mock_fetch:
        resp = client.get("/public-api/v1/fares/?route_id=route-1&from_stop=KTM01")

    assert resp.status_code == 400, resp.text
    mock_fetch.assert_not_called()


def test_fares_with_no_params_at_all_returns_400(client):
    with patch.object(public_api_router.tenant_db, "fetch_fares", new=AsyncMock()) as mock_fetch:
        resp = client.get("/public-api/v1/fares/")

    assert resp.status_code == 400, resp.text
    mock_fetch.assert_not_called()
