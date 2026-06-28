from rest_framework.permissions import BasePermission
from .models import User


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
        return bool(request.user and request.user.is_authenticated and
                    request.user.role in self.ops_roles)


class IsFleetRole(BasePermission):
    fleet_roles = {
        User.Role.SUPER_ADMIN,
        User.Role.COMPANY_ADMIN,
        User.Role.FLEET_MANAGER,
        User.Role.OPERATIONS_MANAGER,
    }

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and
                    request.user.role in self.fleet_roles)


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


class IsConductor(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and
                    request.user.role == User.Role.CONDUCTOR)
