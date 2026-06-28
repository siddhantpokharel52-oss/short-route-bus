"""Tests for Tenant models."""
import pytest
from backend.apps.tenants.models import Tenant, Domain, TenantSubscription


@pytest.mark.django_db
class TestTenantModel:
    def test_tenant_creation(self):
        tenant = Tenant(schema_name="test_co", name="Test Co", plan_type="BASIC", status="PENDING")
        tenant.save()
        assert str(tenant) == "Test Co (test_co)"
        assert tenant.status == Tenant.Status.PENDING

    def test_tenant_default_status_is_pending(self):
        tenant = Tenant(schema_name="pending_co", name="Pending Co")
        tenant.save()
        assert tenant.status == Tenant.Status.PENDING

    def test_tenant_subscription_commission_rate(self):
        from django.conf import settings
        assert settings.COMMISSION_RATES["BASIC"] == 8
        assert settings.COMMISSION_RATES["STANDARD"] == 6
        assert settings.COMMISSION_RATES["ENTERPRISE"] == 4
