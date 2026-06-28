from rest_framework import serializers
from decimal import Decimal
from .models import (
    PricingPlan, CommissionRule, TenantSubscription,
    SubscriptionCommissionRule, UsageMetric, Invoice, InvoiceItem,
    Payment, BillingAuditLog,
)


# ─── Commission Rule ──────────────────────────────────────────────────────────

class CommissionRuleSerializer(serializers.ModelSerializer):
    rule_type_display = serializers.CharField(source="get_rule_type_display", read_only=True)
    billing_model_display = serializers.CharField(source="get_billing_model_display", read_only=True)

    class Meta:
        model = CommissionRule
        fields = [
            "id", "name", "rule_type", "rule_type_display",
            "billing_model", "billing_model_display",
            "rate", "description", "is_active", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


# ─── Pricing Plan ─────────────────────────────────────────────────────────────

class PricingPlanSerializer(serializers.ModelSerializer):
    commission_rules = CommissionRuleSerializer(many=True, read_only=True)
    billing_frequency_display = serializers.CharField(
        source="get_billing_frequency_display", read_only=True
    )
    active_rules_count = serializers.SerializerMethodField()

    class Meta:
        model = PricingPlan
        fields = [
            "id", "name", "description",
            "billing_frequency", "billing_frequency_display",
            "is_active", "commission_rules", "active_rules_count",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_active_rules_count(self, obj):
        return obj.commission_rules.filter(is_active=True).count()


class PricingPlanCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = PricingPlan
        fields = ["id", "name", "description", "billing_frequency", "is_active"]
        read_only_fields = ["id"]


# ─── Subscription Commission Rule Override ─────────────────────────────────────

class SubscriptionCommissionRuleSerializer(serializers.ModelSerializer):
    rule_name = serializers.CharField(source="commission_rule.name", read_only=True)
    rule_type = serializers.CharField(source="commission_rule.rule_type", read_only=True)
    rule_type_display = serializers.CharField(
        source="commission_rule.get_rule_type_display", read_only=True
    )
    default_rate = serializers.DecimalField(
        source="commission_rule.rate", max_digits=10, decimal_places=4, read_only=True
    )
    effective_rate = serializers.SerializerMethodField()

    class Meta:
        model = SubscriptionCommissionRule
        fields = [
            "id", "commission_rule", "rule_name", "rule_type", "rule_type_display",
            "default_rate", "override_rate", "effective_rate", "is_active", "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def get_effective_rate(self, obj):
        return str(obj.effective_rate())


# ─── Tenant Subscription ──────────────────────────────────────────────────────

class TenantSubscriptionSerializer(serializers.ModelSerializer):
    plan_name = serializers.CharField(source="plan.name", read_only=True)
    plan_frequency = serializers.CharField(source="plan.billing_frequency", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    billing_frequency_display = serializers.CharField(
        source="get_billing_frequency_display", read_only=True
    )
    rule_overrides = SubscriptionCommissionRuleSerializer(many=True, read_only=True)
    is_in_grace_period = serializers.BooleanField(read_only=True)
    days_remaining = serializers.IntegerField(read_only=True)
    invoice_count = serializers.SerializerMethodField()
    pending_amount = serializers.SerializerMethodField()

    class Meta:
        model = TenantSubscription
        fields = [
            "id", "tenant_schema", "tenant_name",
            "plan", "plan_name", "plan_frequency",
            "status", "status_display",
            "billing_frequency", "billing_frequency_display",
            "start_date", "end_date", "trial_end_date",
            "grace_period_days", "grace_period_end",
            "auto_renew", "notes",
            "rule_overrides", "is_in_grace_period", "days_remaining",
            "invoice_count", "pending_amount",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_invoice_count(self, obj):
        return obj.invoices.count()

    def get_pending_amount(self, obj):
        from django.db.models import Sum
        result = obj.invoices.filter(
            payment_status__in=["PENDING", "OVERDUE"]
        ).aggregate(total=Sum("total_amount"))["total"]
        return str(result or Decimal("0"))


class TenantSubscriptionCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TenantSubscription
        fields = [
            "tenant_schema", "tenant_name", "plan",
            "status", "billing_frequency",
            "start_date", "end_date", "trial_end_date",
            "grace_period_days", "auto_renew", "notes",
        ]

    def validate(self, data):
        if data.get("start_date") and data.get("end_date"):
            if data["start_date"] >= data["end_date"]:
                raise serializers.ValidationError(
                    {"end_date": "End date must be after start date."}
                )
        return data


# ─── Usage Metric ─────────────────────────────────────────────────────────────

class UsageMetricSerializer(serializers.ModelSerializer):
    class Meta:
        model = UsageMetric
        fields = [
            "id", "tenant_schema", "period_start", "period_end",
            "total_tickets_sold", "total_transactions",
            "active_buses", "revenue_generated", "recorded_at",
        ]
        read_only_fields = fields  # read-only — populated by Celery


# ─── Invoice Item ─────────────────────────────────────────────────────────────

class InvoiceItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceItem
        fields = [
            "id", "rule_type", "description",
            "quantity", "unit_rate", "amount",
        ]
        read_only_fields = fields


# ─── Invoice ──────────────────────────────────────────────────────────────────

class InvoiceSerializer(serializers.ModelSerializer):
    items = InvoiceItemSerializer(many=True, read_only=True)
    payment_status_display = serializers.CharField(
        source="get_payment_status_display", read_only=True
    )
    is_overdue = serializers.SerializerMethodField()
    days_overdue = serializers.SerializerMethodField()
    payment_count = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = [
            "id", "invoice_number",
            "tenant_schema", "tenant_name",
            "subscription",
            "billing_period_start", "billing_period_end",
            "subtotal", "tax_rate", "tax_amount",
            "late_fee", "total_amount",
            "payment_status", "payment_status_display",
            "due_date", "paid_at", "notes",
            "is_prorated", "proration_factor",
            "items", "is_overdue", "days_overdue", "payment_count",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "invoice_number", "created_at", "updated_at",
            "subtotal", "tax_amount", "total_amount",
        ]

    def get_is_overdue(self, obj):
        from django.utils import timezone
        return (
            obj.payment_status == Invoice.PaymentStatus.PENDING
            and timezone.now().date() > obj.due_date
        )

    def get_days_overdue(self, obj):
        from django.utils import timezone
        if self.get_is_overdue(obj):
            return (timezone.now().date() - obj.due_date).days
        return 0

    def get_payment_count(self, obj):
        return obj.payments.count()


# ─── Payment ──────────────────────────────────────────────────────────────────

class PaymentSerializer(serializers.ModelSerializer):
    payment_method_display = serializers.CharField(
        source="get_payment_method_display", read_only=True
    )
    payment_status_display = serializers.CharField(
        source="get_payment_status_display", read_only=True
    )
    invoice_number = serializers.CharField(source="invoice.invoice_number", read_only=True)

    class Meta:
        model = Payment
        fields = [
            "id", "invoice", "invoice_number",
            "amount", "payment_method", "payment_method_display",
            "transaction_id", "payment_status", "payment_status_display",
            "paid_at", "notes", "gateway_response",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "gateway_response"]


class PaymentWebhookSerializer(serializers.Serializer):
    """Inbound payload from a payment gateway webhook."""
    invoice_id = serializers.UUIDField()
    transaction_id = serializers.CharField(max_length=100)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2)
    payment_method = serializers.ChoiceField(choices=Payment.PaymentMethod.choices)
    status = serializers.ChoiceField(choices=Payment.PaymentStatus.choices)
    gateway_response = serializers.JSONField(default=dict)


# ─── Billing Audit Log ────────────────────────────────────────────────────────

class BillingAuditLogSerializer(serializers.ModelSerializer):
    action_display = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        model = BillingAuditLog
        fields = [
            "id", "tenant_schema", "action", "action_display",
            "performed_by_email",
            "related_invoice_id", "related_subscription_id",
            "details", "created_at",
        ]
        read_only_fields = fields


# ─── Action Serializers ───────────────────────────────────────────────────────

class GenerateInvoiceSerializer(serializers.Serializer):
    period_start = serializers.DateField()
    period_end = serializers.DateField()
    tax_rate = serializers.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("0"), required=False
    )
    late_fee = serializers.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0"), required=False
    )
    is_prorated = serializers.BooleanField(default=False, required=False)
    proration_factor = serializers.DecimalField(
        max_digits=5, decimal_places=4, default=Decimal("1.0000"), required=False
    )

    def validate(self, data):
        if data["period_start"] >= data["period_end"]:
            raise serializers.ValidationError(
                {"period_end": "period_end must be after period_start."}
            )
        return data


class AssignPlanSerializer(serializers.Serializer):
    plan_id = serializers.UUIDField()
    apply_proration = serializers.BooleanField(default=False, required=False)


class SuspendSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500)
    apply_grace_period = serializers.BooleanField(default=True, required=False)


class ManualUsageSerializer(serializers.Serializer):
    """Allows an admin to manually submit usage figures for a period."""
    period_start = serializers.DateField()
    period_end = serializers.DateField()
    total_tickets_sold = serializers.IntegerField(min_value=0, default=0)
    total_transactions = serializers.IntegerField(min_value=0, default=0)
    active_buses = serializers.IntegerField(min_value=0, default=0)
    revenue_generated = serializers.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0")
    )
