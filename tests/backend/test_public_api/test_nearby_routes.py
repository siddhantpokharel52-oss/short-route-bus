"""
Nearby-route search tests for GET /public-api/v1/routes/?lat=&lon=&radius_km=.

_haversine_km is tested directly with known real-world coordinates — no DB
or mocking needed at all, since it's a pure function. The endpoint-level
tests mock tenant_db.fetch_routes_near/fetch_routes to confirm GET /routes/
only takes the proximity path when both lat and lon are supplied, and the
existing status/route_type path is otherwise untouched.
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.fastapi_services.main import app
from backend.fastapi_services.public_api import router as public_api_router
from backend.fastapi_services.public_api import tenant_db

RATNAPARK = (27.7172, 85.3240)  # Kathmandu — used only as a fixed, known coordinate pair


@pytest.fixture
def client():
    return TestClient(app)


# ─────────────────────────────────────────────────────────────────────────────
# _haversine_km — pure function, real coordinates, no mocking or DB involved.
# 1 degree of latitude is ~111.32 km everywhere on Earth, so a point exactly
# 0.01deg north of a known origin is an independently verifiable ~1.11 km away
# — this is the "known stop's coordinates ... within a small radius and
# excluded just outside it" check, expressed without needing a live database.
# ─────────────────────────────────────────────────────────────────────────────

def test_haversine_zero_distance_for_identical_points():
    d = tenant_db._haversine_km(*RATNAPARK, *RATNAPARK)
    assert d == pytest.approx(0.0, abs=1e-9)


def test_haversine_known_distance_within_and_outside_radius():
    lat, lon = RATNAPARK
    nearby_stop_lat = lat + 0.01  # ~1.11 km north of the search point
    d = tenant_db._haversine_km(lat, lon, nearby_stop_lat, lon)

    assert d == pytest.approx(1.112, abs=0.01)
    assert d <= 1.2  # a 1.2km-radius search would include this stop
    assert d > 1.0  # a 1.0km-radius search would exclude it


# ─────────────────────────────────────────────────────────────────────────────
# GET /routes/ wiring: only takes the proximity path when lat AND lon are given.
# ─────────────────────────────────────────────────────────────────────────────

NEAR_ROUTE = {
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
    "nearest_stop_distance_km": 0.05,
}


def test_routes_with_lat_lon_returns_nearby_route_with_labeled_distance(client):
    with patch.object(
        public_api_router.tenant_db, "fetch_routes_near", new=AsyncMock(return_value=[NEAR_ROUTE])
    ) as mock_near, patch.object(public_api_router.tenant_db, "fetch_routes", new=AsyncMock()) as mock_all:
        resp = client.get(f"/public-api/v1/routes/?lat={RATNAPARK[0]}&lon={RATNAPARK[1]}&radius_km=1")

    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert len(data) == 1
    assert data[0]["route_code"] == "22"
    assert data[0]["nearest_stop_distance_km"] == 0.05
    # distance_km (the route's own length) must stay distinct from the new field
    assert data[0]["distance_km"] == "12.50"
    mock_near.assert_awaited_once_with(
        lat=RATNAPARK[0], lon=RATNAPARK[1], radius_km=1.0, status=None, route_type=None
    )
    mock_all.assert_not_called()


def test_routes_outside_radius_returns_empty(client):
    with patch.object(public_api_router.tenant_db, "fetch_routes_near", new=AsyncMock(return_value=[])):
        resp = client.get(f"/public-api/v1/routes/?lat={RATNAPARK[0]}&lon={RATNAPARK[1]}&radius_km=0.01")

    assert resp.status_code == 200
    assert resp.json()["data"] == []


def test_routes_without_lat_lon_uses_existing_path_unchanged(client):
    with patch.object(
        public_api_router.tenant_db, "fetch_routes", new=AsyncMock(return_value=[])
    ) as mock_all, patch.object(public_api_router.tenant_db, "fetch_routes_near", new=AsyncMock()) as mock_near:
        resp = client.get("/public-api/v1/routes/?status=APPROVED")

    assert resp.status_code == 200
    mock_all.assert_awaited_once_with(status="APPROVED", route_type=None)
    mock_near.assert_not_called()


def test_routes_requires_both_lat_and_lon(client):
    resp = client.get(f"/public-api/v1/routes/?lat={RATNAPARK[0]}")
    assert resp.status_code == 400
    assert resp.json()["success"] is False
