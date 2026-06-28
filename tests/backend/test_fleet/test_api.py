"""Tests for Fleet API endpoints."""
import pytest
from django.urls import reverse


@pytest.mark.django_db
class TestVehicleAPI:
    def test_list_vehicles_requires_auth(self, api_client):
        response = api_client.get('/api/v1/fleet/vehicles/')
        assert response.status_code == 401

    def test_list_vehicles_as_company_admin(self, auth_client_company_admin):
        response = auth_client_company_admin.get('/api/v1/fleet/vehicles/')
        assert response.status_code == 200
        assert response.data['success'] is True

    def test_create_vehicle_as_company_admin(self, auth_client_company_admin):
        payload = {
            'plate_number': 'BA-01-KHA-0001',
            'make': 'Tata',
            'model': 'LP 407',
            'year': 2022,
            'capacity': 40,
            'fuel_type': 'DIESEL',
            'status': 'ACTIVE',
            'current_odometer': 0,
        }
        response = auth_client_company_admin.post('/api/v1/fleet/vehicles/', payload)
        assert response.status_code == 201
        assert response.data['success'] is True
        assert response.data['data']['plate_number'] == 'BA-01-KHA-0001'

    def test_create_vehicle_super_admin_forbidden(self, auth_client_super_admin):
        """Super admin is a platform role and should not manage tenant fleet."""
        payload = {
            'plate_number': 'BA-99-ZZ-9999',
            'make': 'Tata', 'model': 'LP 407', 'year': 2020,
            'capacity': 40, 'fuel_type': 'DIESEL', 'status': 'ACTIVE', 'current_odometer': 0,
        }
        response = auth_client_super_admin.post('/api/v1/fleet/vehicles/', payload)
        assert response.status_code in (403, 401)

    def test_dispatcher_can_list_vehicles(self, auth_client_dispatcher):
        response = auth_client_dispatcher.get('/api/v1/fleet/vehicles/')
        assert response.status_code == 200

    def test_vehicle_detail(self, auth_client_company_admin):
        # First create
        payload = {
            'plate_number': 'BA-01-KHA-0002', 'make': 'Ashok', 'model': 'Viking',
            'year': 2021, 'capacity': 50, 'fuel_type': 'DIESEL', 'status': 'ACTIVE', 'current_odometer': 0,
        }
        create_resp = auth_client_company_admin.post('/api/v1/fleet/vehicles/', payload)
        vehicle_id = create_resp.data['data']['id']

        # Then get
        resp = auth_client_company_admin.get(f'/api/v1/fleet/vehicles/{vehicle_id}/')
        assert resp.status_code == 200
        assert resp.data['data']['plate_number'] == 'BA-01-KHA-0002'

    def test_response_envelope(self, auth_client_company_admin):
        response = auth_client_company_admin.get('/api/v1/fleet/vehicles/')
        assert 'success' in response.data
        assert 'data' in response.data
        assert 'meta' in response.data
