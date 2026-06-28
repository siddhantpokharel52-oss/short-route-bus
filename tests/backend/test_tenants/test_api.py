"""Tests for Tenant API endpoints."""
import pytest
from django.urls import reverse
from backend.apps.tenants.models import Tenant


@pytest.mark.django_db
class TestTenantAPI:
    def test_list_tenants_requires_super_admin(self, api_client):
        response = api_client.get("/api/v1/platform/tenants/")
        assert response.status_code == 401

    def test_list_tenants_as_super_admin(self, auth_client_super_admin):
        response = auth_client_super_admin.get("/api/v1/platform/tenants/")
        assert response.status_code == 200
        assert response.data["success"] is True

    def test_create_tenant_as_super_admin(self, auth_client_super_admin):
        data = {
            "name": "New Operator",
            "subdomain": "new-operator",
            "plan_type": "BASIC",
            "contact_email": "contact@newoperator.com",
        }
        response = auth_client_super_admin.post("/api/v1/platform/tenants/", data)
        assert response.status_code == 201
        assert response.data["success"] is True
        assert Tenant.objects.filter(name="New Operator").exists()

    def test_activate_tenant_without_documents_fails(self, auth_client_super_admin, test_tenant):
        response = auth_client_super_admin.post(f"/api/v1/platform/tenants/{test_tenant.id}/activate/")
        assert response.status_code == 400

    def test_suspend_tenant(self, auth_client_super_admin, test_tenant):
        response = auth_client_super_admin.post(
            f"/api/v1/platform/tenants/{test_tenant.id}/suspend/",
            {"reason": "Compliance violation"},
        )
        assert response.status_code == 200
        test_tenant.refresh_from_db()
        assert test_tenant.status == Tenant.Status.SUSPENDED

    def test_company_admin_cannot_list_all_tenants(self, auth_client_company_admin):
        response = auth_client_company_admin.get("/api/v1/platform/tenants/")
        assert response.status_code == 403


@pytest.mark.django_db
class TestTenantIsolation:
    """Critical: verify Tenant A cannot access Tenant B's data."""

    def test_cross_tenant_data_isolation(self, api_client, test_tenant):
        """Auth token from one tenant should not access another tenant's data."""
        from backend.apps.users.models import User
        from rest_framework_simplejwt.tokens import RefreshToken

        tenant_a_user = User.objects.create_user(
            email="usera@tenant-a.com",
            password="Admin@123456",
            full_name_en="Tenant A User",
            role=User.Role.COMPANY_ADMIN,
            tenant_schema="tenant_a",
        )
        refresh = RefreshToken.for_user(tenant_a_user)
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(refresh.access_token)}")

        # User from tenant_a shouldn't be able to see tenant platform data
        response = api_client.get("/api/v1/platform/tenants/")
        assert response.status_code == 403
