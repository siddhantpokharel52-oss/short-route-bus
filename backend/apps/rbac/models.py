import uuid
from django.db import models


class Permission(models.Model):
    """Granular module-scoped action. Seeded via management command; never changed manually."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    codename = models.CharField(max_length=100, unique=True)   # "fleet.view"
    name = models.CharField(max_length=200)                    # "View Fleet"
    module = models.CharField(max_length=100)                  # "Fleet Management"
    module_key = models.CharField(max_length=50, db_index=True)  # "fleet"
    action = models.CharField(max_length=50)                   # "view"
    description = models.TextField(blank=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['module_key', 'sort_order']

    def __str__(self):
        return self.codename


class Role(models.Model):
    """Named collection of permissions, configured entirely from the UI."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=120, unique=True)
    description = models.TextField(blank=True)
    color = models.CharField(max_length=20, blank=True, default='#6366f1')
    is_active = models.BooleanField(default=True)
    is_system = models.BooleanField(default=False)   # system roles cannot be deleted
    permissions = models.ManyToManyField(
        Permission,
        through='RolePermission',
        related_name='roles',
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class RolePermission(models.Model):
    """Explicit M2M through-table: a role grants a specific permission."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name='role_permissions')
    permission = models.ForeignKey(Permission, on_delete=models.CASCADE, related_name='role_permissions')
    granted = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('role', 'permission')

    def __str__(self):
        return f"{self.role.name} → {self.permission.codename}"


class UserRole(models.Model):
    """Assigns one or more dynamic roles to a user (by UUID — cross-schema safe)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_id = models.UUIDField(db_index=True)
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name='user_roles')
    assigned_at = models.DateTimeField(auto_now_add=True)
    assigned_by_id = models.UUIDField(null=True, blank=True)

    class Meta:
        unique_together = ('user_id', 'role')

    def __str__(self):
        return f"User({self.user_id}) → {self.role.name}"


class RoleAuditLog(models.Model):
    """Immutable append-only audit trail of all RBAC changes."""
    ACTION_CREATED = 'role_created'
    ACTION_UPDATED = 'role_updated'
    ACTION_DELETED = 'role_deleted'
    ACTION_ACTIVATED = 'role_activated'
    ACTION_DEACTIVATED = 'role_deactivated'
    ACTION_PERMISSIONS_UPDATED = 'permissions_updated'
    ACTION_USER_ASSIGNED = 'user_role_assigned'
    ACTION_USER_REMOVED = 'user_role_removed'
    ACTION_CLONED = 'role_cloned'

    ACTION_CHOICES = [
        (ACTION_CREATED, 'Role Created'),
        (ACTION_UPDATED, 'Role Updated'),
        (ACTION_DELETED, 'Role Deleted'),
        (ACTION_ACTIVATED, 'Role Activated'),
        (ACTION_DEACTIVATED, 'Role Deactivated'),
        (ACTION_PERMISSIONS_UPDATED, 'Permissions Updated'),
        (ACTION_USER_ASSIGNED, 'User Role Assigned'),
        (ACTION_USER_REMOVED, 'User Role Removed'),
        (ACTION_CLONED, 'Role Cloned'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    action = models.CharField(max_length=50, choices=ACTION_CHOICES, db_index=True)
    role = models.ForeignKey(
        Role, on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs'
    )
    role_name = models.CharField(max_length=100)   # preserved even after role deletion
    actor_id = models.UUIDField(null=True, blank=True)
    actor_name = models.CharField(max_length=200, blank=True)
    details = models.JSONField(default=dict)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.action} — {self.role_name}"
