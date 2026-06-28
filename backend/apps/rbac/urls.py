from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import PermissionListView, RoleViewSet, RoleAuditLogListView, UserRoleViewSet

router = DefaultRouter()
router.register('roles', RoleViewSet, basename='rbac-roles')
router.register('user-roles', UserRoleViewSet, basename='rbac-user-roles')

urlpatterns = [
    path('permissions/', PermissionListView.as_view(), name='rbac-permissions'),
    path('audit/', RoleAuditLogListView.as_view(), name='rbac-audit'),
    path('', include(router.urls)),
]
