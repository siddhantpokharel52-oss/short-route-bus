from django.utils.text import slugify
from rest_framework import serializers
from .models import Permission, Role, RolePermission, UserRole, RoleAuditLog


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ['id', 'codename', 'name', 'module', 'module_key', 'action', 'description', 'sort_order']


class RoleSerializer(serializers.ModelSerializer):
    permissions = serializers.SerializerMethodField()
    user_count = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = [
            'id', 'name', 'slug', 'description', 'color',
            'is_active', 'is_system', 'permissions', 'user_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'slug', 'is_system', 'created_at', 'updated_at']

    def get_permissions(self, obj):
        granted = obj.role_permissions.filter(granted=True).select_related('permission')
        return [rp.permission.codename for rp in granted]

    def get_user_count(self, obj):
        return obj.user_roles.count()


class RoleWriteSerializer(serializers.ModelSerializer):
    permission_codenames = serializers.ListField(
        child=serializers.CharField(), write_only=True, required=False, default=list
    )

    class Meta:
        model = Role
        fields = ['id', 'name', 'slug', 'description', 'color', 'is_active', 'permission_codenames']
        read_only_fields = ['id', 'slug']

    def _sync_permissions(self, role, codenames):
        perms = Permission.objects.filter(codename__in=codenames)
        role.role_permissions.all().delete()
        RolePermission.objects.bulk_create([
            RolePermission(role=role, permission=p, granted=True) for p in perms
        ])

    def create(self, validated_data):
        codenames = validated_data.pop('permission_codenames', [])
        validated_data['slug'] = slugify(validated_data['name'])
        # Ensure unique slug
        base = validated_data['slug']
        counter = 1
        while Role.objects.filter(slug=validated_data['slug']).exists():
            validated_data['slug'] = f"{base}-{counter}"
            counter += 1
        role = Role.objects.create(**validated_data)
        self._sync_permissions(role, codenames)
        return role

    def update(self, instance, validated_data):
        codenames = validated_data.pop('permission_codenames', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if codenames is not None:
            self._sync_permissions(instance, codenames)
        return instance


class RoleAuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoleAuditLog
        fields = ['id', 'action', 'role_name', 'actor_name', 'details', 'ip_address', 'created_at']


class UserRoleSerializer(serializers.ModelSerializer):
    role_name = serializers.CharField(source='role.name', read_only=True)
    role_color = serializers.CharField(source='role.color', read_only=True)

    class Meta:
        model = UserRole
        fields = ['id', 'user_id', 'role', 'role_name', 'role_color', 'assigned_at', 'assigned_by_id']
        read_only_fields = ['id', 'assigned_at']
