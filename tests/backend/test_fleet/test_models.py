"""Tests for Fleet models."""
import pytest
from datetime import date, timedelta
from django.utils import timezone


@pytest.mark.django_db
class TestVehicleModel:
    """Test Vehicle model properties and methods."""

    def _create_vehicle(self, status='ACTIVE', **kwargs):
        """Helper to create a Vehicle using ORM."""
        from backend.apps.fleet.models import Vehicle
        return Vehicle.objects.create(
            plate_number=kwargs.get('plate_number', 'BA-01-KHA-1234'),
            make=kwargs.get('make', 'Tata'),
            model=kwargs.get('model', 'LP 407'),
            year=kwargs.get('year', 2020),
            capacity=kwargs.get('capacity', 40),
            fuel_type=kwargs.get('fuel_type', 'DIESEL'),
            status=status,
            current_odometer=kwargs.get('current_odometer', 0),
        )

    def test_vehicle_str(self):
        vehicle = self._create_vehicle()
        assert 'BA-01-KHA-1234' in str(vehicle)

    def test_vehicle_active_status(self):
        vehicle = self._create_vehicle(status='ACTIVE')
        assert vehicle.status == 'ACTIVE'

    def test_vehicle_inactive_not_available(self):
        vehicle = self._create_vehicle(status='INACTIVE')
        assert not vehicle.is_available_for_trip

    def test_vehicle_maintenance_not_available(self):
        vehicle = self._create_vehicle(status='MAINTENANCE')
        assert not vehicle.is_available_for_trip

    def test_vehicle_available_requires_active_and_valid_insurance(self):
        from backend.apps.fleet.models import VehicleDocument
        vehicle = self._create_vehicle(status='ACTIVE')

        # Without valid insurance — should not be available
        assert not vehicle.is_available_for_trip

        # Create valid insurance
        VehicleDocument.objects.create(
            vehicle=vehicle,
            document_type='INSURANCE',
            document_name='Insurance Certificate',
            issue_date=date.today() - timedelta(days=30),
            expiry_date=date.today() + timedelta(days=180),
        )
        vehicle.refresh_from_db()
        assert vehicle.is_available_for_trip


@pytest.mark.django_db
class TestVehicleDocumentModel:
    """Test VehicleDocument expiry tracking."""

    def test_days_to_expiry_future(self):
        from backend.apps.fleet.models import Vehicle, VehicleDocument
        vehicle = Vehicle.objects.create(
            plate_number='BA-02-CHA-5678', make='Ashok', model='Viking',
            year=2021, capacity=50, fuel_type='DIESEL', status='ACTIVE', current_odometer=0
        )
        doc = VehicleDocument.objects.create(
            vehicle=vehicle,
            document_type='ROUTE_PERMIT',
            document_name='Route Permit',
            issue_date=date.today() - timedelta(days=10),
            expiry_date=date.today() + timedelta(days=90),
        )
        assert doc.days_to_expiry >= 89  # within 1 day of 90

    def test_expired_document(self):
        from backend.apps.fleet.models import Vehicle, VehicleDocument
        vehicle = Vehicle.objects.create(
            plate_number='BA-03-GA-9999', make='Tata', model='Starbus',
            year=2019, capacity=35, fuel_type='DIESEL', status='ACTIVE', current_odometer=500
        )
        doc = VehicleDocument.objects.create(
            vehicle=vehicle,
            document_type='POLLUTION',
            document_name='Pollution Certificate',
            issue_date=date.today() - timedelta(days=400),
            expiry_date=date.today() - timedelta(days=35),
        )
        assert doc.is_expired
        assert doc.days_to_expiry < 0
