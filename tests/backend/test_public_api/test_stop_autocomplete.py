"""
Tests for GET /public-api/v1/stops/autocomplete/ (backend/fastapi_services/
public_api/router.py autocomplete_stops()) — a new typeahead endpoint for
Yatroo's origin/destination stop picker, not part of the original brief's C1-C8
list but requested separately.

Mocks tenant_db.search_stops (the SQL itself — prefix/substring match with a
match-position relevance order — is Postgres-specific and was checked by eye
against the real query, same posture as fetch_routes_by_stop_pair's tests).
These tests are about endpoint wiring and validation, not re-proving the SQL.
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.fastapi_services.main import app
from backend.fastapi_services.public_api import router as public_api_router

STOP = {
    "id": "stop-1",
    "stop_code": "KTM01",
    "name_en": "Ratnapark",
    "name_ne": "रत्नपार्क",
    "latitude": "27.7050",
    "longitude": "85.3141",
}


@pytest.fixture
def client():
    return TestClient(app)


def test_autocomplete_returns_matching_stops(client):
    with patch.object(
        public_api_router.tenant_db, "search_stops", new=AsyncMock(return_value=[STOP])
    ) as mock_search:
        resp = client.get("/public-api/v1/stops/autocomplete/?q=Ratna")

    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert len(data) == 1
    assert data[0]["stop_code"] == "KTM01"
    assert data[0]["name_en"] == "Ratnapark"
    assert data[0]["name_ne"] == "रत्नपार्क"
    mock_search.assert_awaited_once_with("Ratna", limit=10, lat=None, lon=None)


def test_autocomplete_strips_whitespace_from_query(client):
    with patch.object(
        public_api_router.tenant_db, "search_stops", new=AsyncMock(return_value=[])
    ) as mock_search:
        resp = client.get("/public-api/v1/stops/autocomplete/?q=  Ratna  ")

    assert resp.status_code == 200, resp.text
    mock_search.assert_awaited_once_with("Ratna", limit=10, lat=None, lon=None)


def test_autocomplete_requires_q_param(client):
    resp = client.get("/public-api/v1/stops/autocomplete/")
    assert resp.status_code == 422, resp.text


def test_autocomplete_rejects_empty_q(client):
    resp = client.get("/public-api/v1/stops/autocomplete/?q=")
    assert resp.status_code == 422, resp.text


def test_autocomplete_respects_custom_limit(client):
    with patch.object(
        public_api_router.tenant_db, "search_stops", new=AsyncMock(return_value=[])
    ) as mock_search:
        resp = client.get("/public-api/v1/stops/autocomplete/?q=Kal&limit=5")

    assert resp.status_code == 200, resp.text
    mock_search.assert_awaited_once_with("Kal", limit=5, lat=None, lon=None)


def test_autocomplete_rejects_limit_over_20(client):
    resp = client.get("/public-api/v1/stops/autocomplete/?q=Kal&limit=21")
    assert resp.status_code == 422, resp.text


def test_autocomplete_rejects_zero_or_negative_limit(client):
    resp = client.get("/public-api/v1/stops/autocomplete/?q=Kal&limit=0")
    assert resp.status_code == 422, resp.text


def test_autocomplete_no_matches_returns_empty_list(client):
    with patch.object(public_api_router.tenant_db, "search_stops", new=AsyncMock(return_value=[])):
        resp = client.get("/public-api/v1/stops/autocomplete/?q=zzzznotarealstop")

    assert resp.status_code == 200, resp.text
    assert resp.json()["data"] == []


def test_autocomplete_with_lat_lon_passes_through_and_surfaces_distance(client):
    """Yatroo's home-page search wants results ordered by walking distance, not
    just name-match quality — lat/lon flow through to tenant_db.search_stops
    unchanged (the actual sorting is tenant_db's job, mocked here), and a
    distance_km the mock attaches is surfaced in the response."""
    stop_with_distance = {**STOP, "distance_km": 0.42}
    with patch.object(
        public_api_router.tenant_db, "search_stops", new=AsyncMock(return_value=[stop_with_distance])
    ) as mock_search:
        resp = client.get("/public-api/v1/stops/autocomplete/?q=Ratna&lat=27.7&lon=85.3")

    assert resp.status_code == 200, resp.text
    mock_search.assert_awaited_once_with("Ratna", limit=10, lat=27.7, lon=85.3)
    assert resp.json()["data"][0]["distance_km"] == 0.42


def test_autocomplete_rejects_lat_without_lon(client):
    resp = client.get("/public-api/v1/stops/autocomplete/?q=Ratna&lat=27.7")
    assert resp.status_code == 400, resp.text


def test_autocomplete_without_lat_lon_omits_distance_field(client):
    with patch.object(public_api_router.tenant_db, "search_stops", new=AsyncMock(return_value=[STOP])):
        resp = client.get("/public-api/v1/stops/autocomplete/?q=Ratna")

    assert resp.status_code == 200, resp.text
    assert "distance_km" not in resp.json()["data"][0]
