"""pytest fixtures for KVBMS backend tests."""
import pytest
from django.test import TestCase
from rest_framework.test import APIClient
from backend.apps.users.models import User
from backend.apps.tenants.models import Tenant, Domain


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def super_admin(db):
    user = User.objects.create_user(
        email="superadmin@test.com",
        password="Admin@123456",
        full_name_en="Test Super Admin",
        role=User.Role.SUPER_ADMIN,
        is_staff=True,
        is_superuser=True,
    )
    return user


@pytest.fixture
def company_admin(db):
    user = User.objects.create_user(
        email="companyadmin@test.com",
        password="Admin@123456",
        full_name_en="Test Company Admin",
        role=User.Role.COMPANY_ADMIN,
        tenant_schema="test_tenant",
    )
    return user


@pytest.fixture
def dispatcher(db):
    user = User.objects.create_user(
        email="dispatcher@test.com",
        password="Admin@123456",
        full_name_en="Test Dispatcher",
        role=User.Role.DISPATCHER,
        tenant_schema="test_tenant",
    )
    return user


@pytest.fixture
def driver(db):
    user = User.objects.create_user(
        email="driver@test.com",
        password="Admin@123456",
        full_name_en="Test Driver",
        role=User.Role.DRIVER,
        tenant_schema="test_tenant",
    )
    return user


@pytest.fixture
def conductor(db):
    user = User.objects.create_user(
        email="conductor@test.com",
        password="Admin@123456",
        full_name_en="Test Conductor",
        role=User.Role.CONDUCTOR,
        tenant_schema="test_tenant",
    )
    return user


@pytest.fixture
def test_tenant(db):
    tenant = Tenant(
        schema_name="test_tenant",
        name="Test Tenant",
        status=Tenant.Status.ACTIVE,
        plan_type=Tenant.PlanType.STANDARD,
    )
    tenant.save()
    Domain.objects.create(tenant=tenant, domain="test-tenant.kvbms.com.np", is_primary=True)
    return tenant


@pytest.fixture
def auth_client_super_admin(api_client, super_admin):
    from rest_framework_simplejwt.tokens import RefreshToken
    refresh = RefreshToken.for_user(super_admin)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(refresh.access_token)}")
    return api_client


@pytest.fixture
def auth_client_company_admin(api_client, company_admin):
    from rest_framework_simplejwt.tokens import RefreshToken
    refresh = RefreshToken.for_user(company_admin)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(refresh.access_token)}")
    return api_client


@pytest.fixture
def auth_client_dispatcher(api_client, dispatcher):
    from rest_framework_simplejwt.tokens import RefreshToken
    refresh = RefreshToken.for_user(dispatcher)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(refresh.access_token)}")
    return api_client
