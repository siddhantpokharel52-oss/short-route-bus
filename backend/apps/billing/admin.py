from django.contrib import admin
from .models import (
    PricingPlan, CommissionRule, TenantSubscription,
    SubscriptionCommissionRule, UsageMetric, Invoice, InvoiceItem,
    Payment, BillingAuditLog,
)


class CommissionRuleInline(admin.TabularInline):
    model = CommissionRule
    extra = 1
    fields = ["name", "rule_type", "billing_model", "rate", "is_active"]


@admin.register(PricingPlan)
class PricingPlanAdmin(admin.ModelAdmin):
    list_display = ["name", "billing_frequency", "is_active", "created_at"]
    list_filter = ["billing_frequency", "is_active"]
    search_fields = ["name"]
    inlines = [CommissionRuleInline]


@admin.register(CommissionRule)
class CommissionRuleAdmin(admin.ModelAdmin):
    list_display = ["name", "plan", "rule_type", "billing_model", "rate", "is_active"]
    list_filter = ["rule_type", "billing_model", "is_active"]
    search_fields = ["name", "plan__name"]


class SubscriptionCommissionRuleInline(admin.TabularInline):
    model = SubscriptionCommissionRule
    extra = 0
    fields = ["commission_rule", "override_rate", "is_active"]


@admin.register(TenantSubscription)
class TenantSubscriptionAdmin(admin.ModelAdmin):
    list_display = [
        "tenant_name", "tenant_schema", "plan", "status",
        "billing_frequency", "start_date", "end_date", "auto_renew",
    ]
    list_filter = ["status", "billing_frequency", "auto_renew"]
    search_fields = ["tenant_name", "tenant_schema"]
    inlines = [SubscriptionCommissionRuleInline]


class InvoiceItemInline(admin.TabularInline):
    model = InvoiceItem
    extra = 0
    readonly_fields = ["rule_type", "description", "quantity", "unit_rate", "amount"]


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = [
        "invoice_number", "tenant_name", "billing_period_start", "billing_period_end",
        "subtotal", "total_amount", "payment_status", "due_date",
    ]
    list_filter = ["payment_status"]
    search_fields = ["invoice_number", "tenant_name", "tenant_schema"]
    readonly_fields = ["invoice_number", "subtotal", "tax_amount", "total_amount"]
    inlines = [InvoiceItemInline]


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ["invoice", "amount", "payment_method", "payment_status", "paid_at"]
    list_filter = ["payment_method", "payment_status"]
    search_fields = ["transaction_id", "invoice__invoice_number"]


@admin.register(BillingAuditLog)
class BillingAuditLogAdmin(admin.ModelAdmin):
    list_display = ["action", "tenant_schema", "performed_by_email", "created_at"]
    list_filter = ["action"]
    search_fields = ["tenant_schema", "performed_by_email"]
    readonly_fields = [f.name for f in BillingAuditLog._meta.get_fields()]
