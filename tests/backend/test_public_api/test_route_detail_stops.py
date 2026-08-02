"""
Tests for GET /public-api/v1/routes/{route_id}/ embedding the ordered stop
list (closes gap C3) while GET /public-api/v1/routes/{route_id}/stops/
remains available on its own.

Mocks tenant_db.fetch_route/fetch_route_stops — no live Postgres needed.
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.fastapi_services.main import app
from backend.fastapi_services.public_api import router as public_api_router

ROUTE_ID = "aaaaaaaa-1111-1111-1111-111111111111"

ROUTE = {
    "id": ROUTE_ID,
    "route_code": "22",
    "name_en": "Ratnapark - Kalanki",
    "name_ne": "",
    "start_stop_id": "stop-1",
    "end_stop_id": "stop-3",
    "distance_km": "12.50",
    "route_type": "EXCLUSIVE",
    "status": "APPROVED",
    "geojson_path": "",
    "created_at": None,
    "updated_at": None,
}

STOPS = [
    {
        "route_stop_id": "rs-1",
        "sequence_no": 1,
        "estimated_time_from_start": 0,
        "stop_id": "stop-1",
        "stop_code": "KV001",
        "name_en": "Ratnapark",
        "name_ne": "",
        "latitude": 27.7172,
        "longitude": 85.3240,
    },
    {
        "route_stop_id": "rs-2",
        "sequence_no": 2,
        "estimated_time_from_start": 20,
        "stop_id": "stop-2",
        "stop_code": "KV002",
        "name_en": "Jamal",
        "name_ne": "",
        "latitude": 27.7120,
        "longitude": 85.3100,
    },
    {
        "route_stop_id": "rs-3",
        "sequence_no": 3,
        "estimated_time_from_start": 45,
        "stop_id": "stop-3",
        "stop_code": "KV003",
        "name_en": "Kalanki",
        "name_ne": "",
        "latitude": 27.6990,
        "longitude": 85.2700,
    },
]


@pytest.fixture
def client():
    return TestClient(app)


def test_route_detail_embeds_ordered_stop_list_matching_dedicated_endpoint(client):
    with patch.object(
        public_api_router.tenant_db, "fetch_route", new=AsyncMock(return_value=ROUTE)
    ), patch.object(
        public_api_router.tenant_db, "fetch_route_stops", new=AsyncMock(return_value=STOPS)
    ) as mock_stops:
        detail_resp = client.get(f"/public-api/v1/routes/{ROUTE_ID}/")
        list_resp = client.get(f"/public-api/v1/routes/{ROUTE_ID}/stops/")

    assert detail_resp.status_code == 200, detail_resp.text
    assert list_resp.status_code == 200, list_resp.text

    detail_body = detail_resp.json()["data"]
    list_body = list_resp.json()["data"]

    # The detail endpoint still returns every existing route field...
    assert detail_body["id"] == ROUTE_ID
    assert detail_body["route_code"] == "22"
    assert detail_body["distance_km"] == "12.50"

    # ...plus a populated, correctly ordered "stops" array...
    assert "stops" in detail_body
    assert len(detail_body["stops"]) == 3
    assert [s["sequence_no"] for s in detail_body["stops"]] == [1, 2, 3]
    assert [s["stop_code"] for s in detail_body["stops"]] == ["KV001", "KV002", "KV003"]

    # ...that matches exactly what the separate /stops/ endpoint returns independently
    # for the same route (both call fetch_route_stops — same underlying data either way).
    assert detail_body["stops"] == list_body

    # Both endpoints actually called fetch_route_stops — confirms the dedicated endpoint
    # wasn't quietly removed or changed as a side effect of adding the embedded version.
    assert mock_stops.await_count == 2


def test_route_detail_stops_endpoint_unchanged_shape(client):
    """GET /routes/{id}/stops/ on its own still returns a bare array, not the full
    route object — confirms it's untouched, not just still present."""
    with patch.object(
        public_api_router.tenant_db, "fetch_route", new=AsyncMock(return_value=ROUTE)
    ), patch.object(public_api_router.tenant_db, "fetch_route_stops", new=AsyncMock(return_value=STOPS)):
        resp = client.get(f"/public-api/v1/routes/{ROUTE_ID}/stops/")

    body = resp.json()["data"]
    assert isinstance(body, list)
    assert len(body) == 3
    assert "route_code" not in body[0]  # a stop entry, not a route entry


def test_route_detail_404_skips_stops_lookup(client):
    """A nonexistent route shouldn't trigger a second (wasted) query for its stops."""
    with patch.object(
        public_api_router.tenant_db, "fetch_route", new=AsyncMock(return_value=None)
    ), patch.object(public_api_router.tenant_db, "fetch_route_stops", new=AsyncMock()) as mock_stops:
        resp = client.get(f"/public-api/v1/routes/{ROUTE_ID}/")

    assert resp.status_code == 404
    mock_stops.assert_not_called()
