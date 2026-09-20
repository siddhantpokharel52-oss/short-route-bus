from django.conf import settings
from django.db import connection
from django_tenants.utils import get_public_schema_name
from rest_framework.permissions import BasePermission
from .models import User


def _has_tenant_context(request):
    """RG-090: fleet/roster (TENANT_APPS) queries 500 when the request
    resolves to the public schema -- role-only permission checks let a
    super-admin (present in every ops/fleet role set below) reach them with
    no real tenant, since schema resolution comes from the request's host
    (TenantMainMiddleware), not from request.user.tenant_schema at all.
    Reject before any tenant-table query runs, rather than patching every
    affected view individually."""
    return connection.schema_name != get_public_schema_name()


class IsInternalService(BasePermission):
    """Gates a Django endpoint meant to be called only by our own FastAPI
    service over the internal docker network — never by an end user or an
    external partner directly, even though (like every apps.users URL) it's
    technically reachable through nginx's /api/ passthrough. Checked via a
    shared secret header rather than a user session, since there is no user
    on this call — it's server-to-server. See PartnerProvisionView."""
    def has_permission(self, request, view):
        provided = request.headers.get("X-Internal-Service-Key", "")
        expected = getattr(settings, "INTERNAL_SERVICE_KEY", "")
        return bool(expected) and provided == expected


class IsSuperAdmin(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and
                    request.user.role == User.Role.SUPER_ADMIN)


class IsTransportAuthority(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and
                    request.user.role in [User.Role.SUPER_ADMIN, User.Role.TRANSPORT_AUTHORITY_OFFICER])


class IsPlatformRole(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and
                    request.user.is_platform_role)


class IsCompanyAdmin(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and
                    request.user.role in [User.Role.SUPER_ADMIN, User.Role.COMPANY_ADMIN])


class IsOperationsRole(BasePermission):
    ops_roles = {
        User.Role.SUPER_ADMIN,
        User.Role.COMPANY_ADMIN,
        User.Role.OPERATIONS_MANAGER,
        User.Role.DISPATCHER,
    }

    def has_permission(self, request, view):
        return bool(_has_tenant_context(request) and request.user and request.user.is_authenticated and
                    request.user.role in self.ops_roles)


class IsFleetRole(BasePermission):
    fleet_roles = {
        User.Role.SUPER_ADMIN,
        User.Role.COMPANY_ADMIN,
        User.Role.FLEET_MANAGER,
        User.Role.OPERATIONS_MANAGER,
    }

    def has_permission(self, request, view):
        return bool(_has_tenant_context(request) and request.user and request.user.is_authenticated and
                    request.user.role in self.fleet_roles)


class CanViewVehicles(BasePermission):
    """Read access to the vehicle list for anyone who needs it to do their
    job -- fleet roles who own the data, plus dispatchers who need to pick
    an active bus for a schedule/route assignment without needing any
    fleet-editing rights."""
    _roles = IsFleetRole.fleet_roles | {User.Role.DISPATCHER}

    def has_permission(self, request, view):
        return bool(_has_tenant_context(request) and request.user and request.user.is_authenticated and
                    request.user.role in self._roles)


class IsFinanceRole(BasePermission):
    finance_roles = {
        User.Role.SUPER_ADMIN,
        User.Role.COMPANY_ADMIN,
        User.Role.FINANCE_OFFICER,
        User.Role.REVENUE_AUDITOR,
    }

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and
                    request.user.role in self.finance_roles)


class IsHRRole(BasePermission):
    hr_roles = {
        User.Role.SUPER_ADMIN,
        User.Role.COMPANY_ADMIN,
        User.Role.HR_OFFICER,
        User.Role.OPERATIONS_MANAGER,
    }

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and
                    request.user.role in self.hr_roles)


class CanViewStaff(BasePermission):
    """Read access to the driver list for anyone who needs it to do their
    job -- HR roles who own the data, plus dispatchers who need driver
    names to assign a bus/trip on the Dispatcher Control Center without
    needing any staff-editing rights."""
    _roles = IsHRRole.hr_roles | {User.Role.DISPATCHER}

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and
                    request.user.role in self._roles)


class IsMaintenanceRole(BasePermission):
    maintenance_roles = {
        User.Role.SUPER_ADMIN,
        User.Role.COMPANY_ADMIN,
        User.Role.MAINTENANCE_MANAGER,
        User.Role.FLEET_MANAGER,
    }

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and
                    request.user.role in self.maintenance_roles)


class CanManageRoutes(BasePermission):
    """Platform staff AND tenant operators who need to create/edit routes."""
    _roles = {
        User.Role.SUPER_ADMIN,
        User.Role.TRANSPORT_AUTHORITY_OFFICER,
        User.Role.COMPLIANCE_OFFICER,
        User.Role.PLATFORM_SUPPORT,
        User.Role.COMPANY_ADMIN,
        User.Role.OPERATIONS_MANAGER,
        User.Role.DISPATCHER,
    }

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and
                    request.user.role in self._roles)


class IsDriver(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and
                    request.user.role == User.Role.DRIVER)


class CanViewFares(BasePermission):
    """Platform staff (see every route's fares) and tenant operators (read-only,
    scoped to their own assigned routes in FareMatrixViewSet.get_queryset) --
    fares are centrally set/approved, not something an operator edits, but an
    operator still needs to see the official rate for their own route."""
    _tenant_roles = {
        User.Role.COMPANY_ADMIN,
        User.Role.OPERATIONS_MANAGER,
        User.Role.DISPATCHER,
    }

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and
                    (request.user.is_platform_role or request.user.role in self._tenant_roles))


class IsConductor(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and
                    request.user.role == User.Role.CONDUCTOR)
