from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ["email", "full_name_en", "role", "is_active", "created_at"]
    list_filter = ["role", "is_active", "is_staff"]
    search_fields = ["email", "full_name_en"]
    ordering = ["-created_at"]
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal Info", {"fields": ("full_name_en", "full_name_ne", "phone")}),
        ("Role & Tenant", {"fields": ("role", "tenant_schema", "language_preference")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "is_2fa_enabled")}),
        ("Security", {"fields": ("failed_login_attempts", "locked_until")}),
    )
    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("email", "full_name_en", "role", "password1", "password2"),
        }),
    )
