from django.contrib import admin
from .models import Tenant, Domain, TenantSubscription, TenantDocument


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ["name", "schema_name", "status", "plan_type", "created_at"]
    list_filter = ["status", "plan_type"]
    search_fields = ["name", "schema_name"]


@admin.register(Domain)
class DomainAdmin(admin.ModelAdmin):
    list_display = ["domain", "tenant", "is_primary"]


@admin.register(TenantSubscription)
class TenantSubscriptionAdmin(admin.ModelAdmin):
    list_display = ["tenant", "plan", "start_date", "end_date", "status"]


@admin.register(TenantDocument)
class TenantDocumentAdmin(admin.ModelAdmin):
    list_display = ["tenant", "doc_type", "verified", "uploaded_at"]
