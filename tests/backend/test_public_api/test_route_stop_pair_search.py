"""
Stop-pair route search tests for GET /public-api/v1/routes/?from_stop=&to_stop=.

City-bus journey step 1 ("passenger picks From stop / To stop directly, not
a route") had no dedicated endpoint before this — mocks
tenant_db.fetch_routes_by_stop_pair/fetch_routes/fetch_routes_near to confirm
GET /routes/ only takes the stop-pair path when both params are supplied,
and that it takes priority over (rather than combining with) the existing
lat/lon and plain-list paths.

The query itself (sequence_no ordering enforcing "in order", SELECT DISTINCT
+ ORDER BY needing an aliased expression under Postgres) was verified against
real data through the live stack before this file was written — see the
docstring on tenant_db.fetch_routes_by_stop_pair for the reasoning; these
tests are about the endpoint wiring, not re-proving the SQL.
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.fastapi_services.main import app
from backend.fastapi_services.public_api import router as public_api_router

STOP_PAIR_ROUTE = {
    "id": "route-1",
    "route_code": "22",
    "name_en": "Ratnapark - Kalanki",
    "name_ne": "",
    "start_stop_id": None,
    "end_stop_id": None,
    "distance_km": "12.50",
    "route_type": "EXCLUSIVE",
    "status": "APPROVED",
    "geojson_path": "",
    "created_at": None,
    "updated_at": None,
    "from_sequence_no": 1,
    "to_sequence_no": 3,
}


@pytest.fixture
def client():
    return TestClient(app)


def test_routes_with_stop_pair_returns_matched_route_with_sequence_numbers(client):
    with patch.object(
        public_api_router.tenant_db, "fetch_routes_by_stop_pair", new=AsyncMock(return_value=[STOP_PAIR_ROUTE])
    ) as mock_pair, patch.object(
        public_api_router.tenant_db, "fetch_routes", new=AsyncMock()
    ) as mock_all, patch.object(
        public_api_router.tenant_db, "fetch_routes_near", new=AsyncMock()
    ) as mock_near:
        resp = client.get("/public-api/v1/routes/?from_stop=KTM01&to_stop=KTM09")

    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert len(data) == 1
    assert data[0]["route_code"] == "22"
    assert data[0]["from_sequence_no"] == 1
    assert data[0]["to_sequence_no"] == 3
    mock_pair.assert_awaited_once_with("KTM01", "KTM09")
    mock_all.assert_not_called()
    mock_near.assert_not_called()


def test_routes_with_no_matching_stop_pair_returns_empty(client):
    with patch.object(public_api_router.tenant_db, "fetch_routes_by_stop_pair", new=AsyncMock(return_value=[])):
        resp = client.get("/public-api/v1/routes/?from_stop=KTM09&to_stop=KTM01")  # reverse direction

    assert resp.status_code == 200
    assert resp.json()["data"] == []


def test_routes_requires_both_from_stop_and_to_stop(client):
    resp = client.get("/public-api/v1/routes/?from_stop=KTM01")
    assert resp.status_code == 400
    assert resp.json()["success"] is False


def test_stop_pair_search_takes_priority_over_lat_lon(client):
    """If a caller somehow sends both, the stop-pair search wins — it's the more
    specific request. Not a scenario a real client should construct, but the
    precedence must be deterministic rather than accidental."""
    with patch.object(
        public_api_router.tenant_db, "fetch_routes_by_stop_pair", new=AsyncMock(return_value=[STOP_PAIR_ROUTE])
    ) as mock_pair, patch.object(public_api_router.tenant_db, "fetch_routes_near", new=AsyncMock()) as mock_near:
        resp = client.get("/public-api/v1/routes/?from_stop=KTM01&to_stop=KTM09&lat=27.7&lon=85.3")

    assert resp.status_code == 200, resp.text
    mock_pair.assert_awaited_once()
    mock_near.assert_not_called()


def test_routes_without_stop_pair_uses_existing_path_unchanged(client):
    with patch.object(
        public_api_router.tenant_db, "fetch_routes", new=AsyncMock(return_value=[])
    ) as mock_all, patch.object(
        public_api_router.tenant_db, "fetch_routes_by_stop_pair", new=AsyncMock()
    ) as mock_pair:
        resp = client.get("/public-api/v1/routes/?status=APPROVED")

    assert resp.status_code == 200
    mock_all.assert_awaited_once_with(status="APPROVED", route_type=None)
    mock_pair.assert_not_called()


def test_routes_with_single_stop_finds_routes_serving_it(client):
    """Yatroo's Search Destination flow: passenger picks one destination stop
    (no origin yet) — GET /routes/?stop= should find every route serving it,
    any position/direction, distinct from the from_stop+to_stop pair search."""
    with patch.object(
        public_api_router.tenant_db, "fetch_routes_by_single_stop", new=AsyncMock(return_value=[STOP_PAIR_ROUTE])
    ) as mock_single:
        resp = client.get("/public-api/v1/routes/?stop=KTM09")

    assert resp.status_code == 200, resp.text
    assert resp.json()["data"][0]["id"] == "route-1"
    mock_single.assert_awaited_once_with("KTM09")


def test_stop_pair_search_takes_priority_over_single_stop(client):
    """Same deterministic-precedence philosophy as the lat/lon case above --
    from_stop/to_stop wins if a caller somehow combines it with stop."""
    with patch.object(
        public_api_router.tenant_db, "fetch_routes_by_stop_pair", new=AsyncMock(return_value=[STOP_PAIR_ROUTE])
    ) as mock_pair, patch.object(
        public_api_router.tenant_db, "fetch_routes_by_single_stop", new=AsyncMock()
    ) as mock_single:
        resp = client.get("/public-api/v1/routes/?from_stop=KTM01&to_stop=KTM09&stop=KTM05")

    assert resp.status_code == 200, resp.text
    mock_pair.assert_awaited_once()
    mock_single.assert_not_called()
