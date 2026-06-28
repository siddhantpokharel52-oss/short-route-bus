from django.utils import timezone
from django.utils.text import slugify
from rest_framework import generics, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from backend.apps.users.permissions import IsCompanyAdmin
from .models import Permission, Role, RolePermission, UserRole, RoleAuditLog
from .serializers import (
    PermissionSerializer, RoleSerializer, RoleWriteSerializer,
    RoleAuditLogSerializer, UserRoleSerializer,
)


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success,
        "data": data,
        "message": message,
        "errors": errors,
        "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


def _get_client_ip(request):
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    return xff.split(',')[0] if xff else request.META.get('REMOTE_ADDR')


def _actor(request):
    u = request.user
    return (
        getattr(u, 'id', None),
        getattr(u, 'full_name_en', None) or getattr(u, 'email', '') or str(u),
    )


class PermissionListView(generics.ListAPIView):
    """All available permissions grouped by module."""
    serializer_class = PermissionSerializer
    permission_classes = [IsCompanyAdmin]
    queryset = Permission.objects.all()

    def list(self, request, *args, **kwargs):
        grouped: dict = {}
        for perm in self.get_queryset():
            key = perm.module_key
            if key not in grouped:
                grouped[key] = {'module_key': key, 'module_name': perm.module, 'permissions': []}
            grouped[key]['permissions'].append(PermissionSerializer(perm).data)
        return api_response(data=list(grouped.values()))


class RoleViewSet(ModelViewSet):
    permission_classes = [IsCompanyAdmin]
    queryset = Role.objects.prefetch_related('role_permissions__permission', 'user_roles').all()

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return RoleWriteSerializer
        return RoleSerializer

    def list(self, request, *args, **kwargs):
        return api_response(data=RoleSerializer(self.get_queryset(), many=True).data)

    def retrieve(self, request, *args, **kwargs):
        return api_response(data=RoleSerializer(self.get_object()).data)

    def create(self, request, *args, **kwargs):
        ser = RoleWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        role = ser.save()
        actor_id, actor_name = _actor(request)
        RoleAuditLog.objects.create(
            action=RoleAuditLog.ACTION_CREATED, role=role, role_name=role.name,
            actor_id=actor_id, actor_name=actor_name,
            details={'name': role.name, 'description': role.description},
            ip_address=_get_client_ip(request),
        )
        return api_response(data=RoleSerializer(role).data, message="Role created.", status_code=201)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        old_name = instance.name
        ser = RoleWriteSerializer(instance, data=request.data, partial=partial)
        ser.is_valid(raise_exception=True)
        role = ser.save()
        actor_id, actor_name = _actor(request)
        RoleAuditLog.objects.create(
            action=RoleAuditLog.ACTION_UPDATED, role=role, role_name=role.name,
            actor_id=actor_id, actor_name=actor_name,
            details={'old_name': old_name, 'new_name': role.name},
            ip_address=_get_client_ip(request),
        )
        return api_response(data=RoleSerializer(role).data, message="Role updated.")

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.is_system:
            return api_response(success=False, message="System roles cannot be deleted.",
                                status_code=status.HTTP_400_BAD_REQUEST)
        actor_id, actor_name = _actor(request)
        RoleAuditLog.objects.create(
            action=RoleAuditLog.ACTION_DELETED, role=None, role_name=instance.name,
            actor_id=actor_id, actor_name=actor_name,
            details={'name': instance.name}, ip_address=_get_client_ip(request),
        )
        instance.delete()
        return api_response(message="Role deleted.")

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        role = self.get_object()
        role.is_active = True
        role.save(update_fields=['is_active'])
        actor_id, actor_name = _actor(request)
        RoleAuditLog.objects.create(
            action=RoleAuditLog.ACTION_ACTIVATED, role=role, role_name=role.name,
            actor_id=actor_id, actor_name=actor_name, ip_address=_get_client_ip(request),
        )
        return api_response(message="Role activated.")

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        role = self.get_object()
        if role.is_system:
            return api_response(success=False, message="System roles cannot be deactivated.",
                                status_code=status.HTTP_400_BAD_REQUEST)
        role.is_active = False
        role.save(update_fields=['is_active'])
        actor_id, actor_name = _actor(request)
        RoleAuditLog.objects.create(
            action=RoleAuditLog.ACTION_DEACTIVATED, role=role, role_name=role.name,
            actor_id=actor_id, actor_name=actor_name, ip_address=_get_client_ip(request),
        )
        return api_response(message="Role deactivated.")

    @action(detail=True, methods=['post'])
    def clone(self, request, pk=None):
        source = self.get_object()
        new_name = request.data.get('name', f"Copy of {source.name}")
        new_slug = slugify(new_name)
        base = new_slug
        counter = 1
        while Role.objects.filter(slug=new_slug).exists():
            new_slug = f"{base}-{counter}"
            counter += 1
        new_role = Role.objects.create(
            name=new_name, slug=new_slug, description=source.description,
            color=source.color, is_active=True, is_system=False,
        )
        RolePermission.objects.bulk_create([
            RolePermission(role=new_role, permission=rp.permission, granted=True)
            for rp in source.role_permissions.filter(granted=True)
        ])
        actor_id, actor_name = _actor(request)
        RoleAuditLog.objects.create(
            action=RoleAuditLog.ACTION_CLONED, role=new_role, role_name=new_role.name,
            actor_id=actor_id, actor_name=actor_name,
            details={'source': source.name, 'clone': new_role.name},
            ip_address=_get_client_ip(request),
        )
        return api_response(data=RoleSerializer(new_role).data,
                            message=f"Role cloned as '{new_name}'.", status_code=201)

    @action(detail=True, methods=['post'], url_path='permissions')
    def update_permissions(self, request, pk=None):
        role = self.get_object()
        codenames = request.data.get('permission_codenames', [])
        old = set(role.role_permissions.filter(granted=True)
                  .values_list('permission__codename', flat=True))
        perms = Permission.objects.filter(codename__in=codenames)
        role.role_permissions.all().delete()
        RolePermission.objects.bulk_create([
            RolePermission(role=role, permission=p, granted=True) for p in perms
        ])
        new = set(codenames)
        actor_id, actor_name = _actor(request)
        RoleAuditLog.objects.create(
            action=RoleAuditLog.ACTION_PERMISSIONS_UPDATED, role=role, role_name=role.name,
            actor_id=actor_id, actor_name=actor_name,
            details={'added': list(new - old), 'removed': list(old - new)},
            ip_address=_get_client_ip(request),
        )
        return api_response(data=RoleSerializer(role).data, message="Permissions updated.")


class RoleAuditLogListView(generics.ListAPIView):
    serializer_class = RoleAuditLogSerializer
    permission_classes = [IsCompanyAdmin]

    def get_queryset(self):
        qs = RoleAuditLog.objects.all()
        role_id = self.request.query_params.get('role')
        if role_id:
            qs = qs.filter(role_id=role_id)
        return qs[:200]

    def list(self, request, *args, **kwargs):
        return api_response(data=RoleAuditLogSerializer(self.get_queryset(), many=True).data)


class UserRoleViewSet(ModelViewSet):
    serializer_class = UserRoleSerializer
    permission_classes = [IsCompanyAdmin]

    def get_queryset(self):
        qs = UserRole.objects.select_related('role').all()
        user_id = self.request.query_params.get('user_id')
        if user_id:
            qs = qs.filter(user_id=user_id)
        return qs

    def list(self, request, *args, **kwargs):
        return api_response(data=UserRoleSerializer(self.get_queryset(), many=True).data)

    def create(self, request, *args, **kwargs):
        ser = UserRoleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        actor_id, _ = _actor(request)
        instance = ser.save(assigned_by_id=actor_id)
        actor_id2, actor_name = _actor(request)
        RoleAuditLog.objects.create(
            action=RoleAuditLog.ACTION_USER_ASSIGNED,
            role=instance.role, role_name=instance.role.name,
            actor_id=actor_id2, actor_name=actor_name,
            details={'user_id': str(instance.user_id), 'role': instance.role.name},
            ip_address=_get_client_ip(request),
        )
        return api_response(data=UserRoleSerializer(instance).data,
                            message="Role assigned to user.", status_code=201)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        actor_id, actor_name = _actor(request)
        RoleAuditLog.objects.create(
            action=RoleAuditLog.ACTION_USER_REMOVED,
            role=instance.role, role_name=instance.role.name,
            actor_id=actor_id, actor_name=actor_name,
            details={'user_id': str(instance.user_id), 'role': instance.role.name},
            ip_address=_get_client_ip(request),
        )
        instance.delete()
        return api_response(message="Role removed from user.")
