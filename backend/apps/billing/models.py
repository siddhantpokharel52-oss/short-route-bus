import uuid
from decimal import Decimal
from django.db import models
from django.utils import timezone


# ─── Pricing Plan ────────────────────────────────────────────────────────────

class PricingPlan(models.Model):
    """
    Reusable pricing plan templates.
    Each plan holds one or more CommissionRules (AMC, per-ticket, per-bus, etc.).
    Multiple rules on the same plan = Hybrid billing.
    """

    class BillingFrequency(models.TextChoices):
        MONTHLY = "MONTHLY", "Monthly"
        QUARTERLY = "QUARTERLY", "Quarterly"
        YEARLY = "YEARLY", "Yearly"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    billing_frequency = models.CharField(
        max_length=10, choices=BillingFrequency.choices, default=BillingFrequency.MONTHLY
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.billing_frequency})"


# ─── Commission Rule ──────────────────────────────────────────────────────────

class CommissionRule(models.Model):
    """
    A single billing rule attached to a PricingPlan.
    A plan can have multiple rules — that is the "Hybrid" model.

    Rule types:
      AMC                         → fixed monthly charge
      PER_TICKET_PERCENTAGE       → revenue_generated × rate%
      PER_TICKET_FIXED            → tickets_sold × rate (NPR)
      PER_TRANSACTION_PERCENTAGE  → revenue_generated × rate%
      PER_TRANSACTION_FIXED       → transactions × rate (NPR)
      PER_BUS                     → active_buses × rate (NPR)
    """

    class RuleType(models.TextChoices):
        AMC = "AMC", "Fixed Monthly AMC"
        PER_TICKET_PERCENTAGE = "PER_TICKET_PERCENTAGE", "Per Ticket — % of Revenue"
        PER_TICKET_FIXED = "PER_TICKET_FIXED", "Per Ticket — Fixed Amount"
        PER_TRANSACTION_PERCENTAGE = "PER_TRANSACTION_PERCENTAGE", "Per Transaction — % of Revenue"
        PER_TRANSACTION_FIXED = "PER_TRANSACTION_FIXED", "Per Transaction — Fixed Amount"
        PER_BUS = "PER_BUS", "Per Active Bus"

    class BillingModel(models.TextChoices):
        FIXED_AMOUNT = "FIXED_AMOUNT", "Fixed Amount"
        PERCENTAGE = "PERCENTAGE", "Percentage"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey(
        PricingPlan, on_delete=models.CASCADE, related_name="commission_rules"
    )
    name = models.CharField(max_length=100)
    rule_type = models.CharField(max_length=30, choices=RuleType.choices)
    billing_model = models.CharField(max_length=15, choices=BillingModel.choices)
    rate = models.DecimalField(max_digits=10, decimal_places=4)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["rule_type"]

    def __str__(self):
        return f"{self.name} — {self.rule_type} @ {self.rate}"


# ─── Tenant Subscription ──────────────────────────────────────────────────────

class TenantSubscription(models.Model):
    """
    Platform-level subscription record for a tenant.
    Lives in the public schema; `tenant_schema` ties it to a Tenant.
    """

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        TRIAL = "TRIAL", "Trial"
        SUSPENDED = "SUSPENDED", "Suspended"
        EXPIRED = "EXPIRED", "Expired"

    class BillingFrequency(models.TextChoices):
        MONTHLY = "MONTHLY", "Monthly"
        QUARTERLY = "QUARTERLY", "Quarterly"
        YEARLY = "YEARLY", "Yearly"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant_schema = models.CharField(max_length=63, unique=True, db_index=True)
    tenant_name = models.CharField(max_length=255)  # denormalized for display
    plan = models.ForeignKey(
        PricingPlan, on_delete=models.PROTECT, null=True, blank=True,
        related_name="subscriptions"
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.TRIAL)
    billing_frequency = models.CharField(
        max_length=10, choices=BillingFrequency.choices, default=BillingFrequency.MONTHLY
    )
    start_date = models.DateField()
    end_date = models.DateField()
    trial_end_date = models.DateField(null=True, blank=True)
    grace_period_days = models.PositiveSmallIntegerField(default=7)
    grace_period_end = models.DateField(null=True, blank=True)
    auto_renew = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by_id = models.UUIDField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant_schema", "status"]),
            models.Index(fields=["end_date"]),
            models.Index(fields=["status"]),
        ]

    def __str__(self):
        return f"{self.tenant_name} — {self.status}"

    @property
    def is_in_grace_period(self):
        if self.grace_period_end:
            return timezone.now().date() <= self.grace_period_end
        return False

    @property
    def days_remaining(self):
        return max(0, (self.end_date - timezone.now().date()).days)

    def compute_next_billing_date(self):
        from dateutil.relativedelta import relativedelta
        freq_map = {
            self.BillingFrequency.MONTHLY: relativedelta(months=1),
            self.BillingFrequency.QUARTERLY: relativedelta(months=3),
            self.BillingFrequency.YEARLY: relativedelta(years=1),
        }
        delta = freq_map.get(self.billing_frequency, relativedelta(months=1))
        return self.end_date + delta


# ─── Subscription Commission Rule Override ────────────────────────────────────

class SubscriptionCommissionRule(models.Model):
    """
    Per-tenant override for a CommissionRule rate.
    If override_rate is NULL the plan default is used.
    This is the M2M bridge between a subscription and its active rules.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subscription = models.ForeignKey(
        TenantSubscription, on_delete=models.CASCADE, related_name="rule_overrides"
    )
    commission_rule = models.ForeignKey(
        CommissionRule, on_delete=models.CASCADE, related_name="tenant_overrides"
    )
    override_rate = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("subscription", "commission_rule")
        indexes = [models.Index(fields=["subscription", "is_active"])]

    def effective_rate(self) -> Decimal:
        return (
            self.override_rate
            if self.override_rate is not None
            else self.commission_rule.rate
        )

    def __str__(self):
        return (
            f"{self.subscription.tenant_name} — "
            f"{self.commission_rule.rule_type} @ {self.effective_rate()}"
        )


# ─── Usage Metric ─────────────────────────────────────────────────────────────

class UsageMetric(models.Model):
    """
    Aggregated usage snapshot per tenant per billing period.
    Populated by Celery tasks (not exposed directly in the public API).
    Used by the CommissionEngine to calculate invoice amounts.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant_schema = models.CharField(max_length=63, db_index=True)
    subscription = models.ForeignKey(
        TenantSubscription, on_delete=models.CASCADE,
        related_name="usage_metrics", null=True, blank=True
    )
    period_start = models.DateField()
    period_end = models.DateField()
    total_tickets_sold = models.PositiveIntegerField(default=0)
    total_transactions = models.PositiveIntegerField(default=0)
    active_buses = models.PositiveSmallIntegerField(default=0)
    revenue_generated = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0")
    )
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-period_start"]
        unique_together = ("tenant_schema", "period_start", "period_end")
        indexes = [
            models.Index(fields=["tenant_schema", "period_start", "period_end"]),
        ]

    def __str__(self):
        return f"{self.tenant_schema}: {self.period_start} → {self.period_end}"


# ─── Invoice ──────────────────────────────────────────────────────────────────

class Invoice(models.Model):
    """Platform invoice issued to a tenant for a billing period."""

    class PaymentStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        PAID = "PAID", "Paid"
        OVERDUE = "OVERDUE", "Overdue"
        CANCELLED = "CANCELLED", "Cancelled"
        WAIVED = "WAIVED", "Waived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice_number = models.CharField(max_length=40, unique=True, db_index=True)
    tenant_schema = models.CharField(max_length=63, db_index=True)
    tenant_name = models.CharField(max_length=255)
    subscription = models.ForeignKey(
        TenantSubscription, on_delete=models.PROTECT, related_name="invoices"
    )
    billing_period_start = models.DateField()
    billing_period_end = models.DateField()
    usage_metric = models.ForeignKey(
        UsageMetric, on_delete=models.SET_NULL, null=True, blank=True, related_name="invoices"
    )

    subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0"))
    tax_amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    late_fee = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))

    payment_status = models.CharField(
        max_length=10, choices=PaymentStatus.choices, default=PaymentStatus.PENDING
    )
    due_date = models.DateField()
    paid_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)

    # Proration support
    is_prorated = models.BooleanField(default=False)
    proration_factor = models.DecimalField(
        max_digits=5, decimal_places=4, default=Decimal("1.0000")
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant_schema", "payment_status"]),
            models.Index(fields=["due_date", "payment_status"]),
            models.Index(fields=["billing_period_start", "billing_period_end"]),
        ]

    def __str__(self):
        return f"{self.invoice_number} — {self.tenant_name}"

    def check_and_mark_overdue(self):
        if (
            self.payment_status == self.PaymentStatus.PENDING
            and timezone.now().date() > self.due_date
        ):
            self.payment_status = self.PaymentStatus.OVERDUE
            self.save(update_fields=["payment_status", "updated_at"])
            return True
        return False


# ─── Invoice Item ─────────────────────────────────────────────────────────────

class InvoiceItem(models.Model):
    """Individual line item on an invoice (one per CommissionRule that fired)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="items")
    rule_type = models.CharField(max_length=30)  # mirrors CommissionRule.RuleType
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=14, decimal_places=4, default=Decimal("1"))
    unit_rate = models.DecimalField(max_digits=12, decimal_places=4)
    amount = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        ordering = ["rule_type"]

    def __str__(self):
        return f"{self.description}: NPR {self.amount}"


# ─── Payment ──────────────────────────────────────────────────────────────────

class Payment(models.Model):
    """Payment record for an invoice (gateway or manual admin entry)."""

    class PaymentMethod(models.TextChoices):
        CONNECT_IPS = "CONNECT_IPS", "ConnectIPS"
        FONEPAY = "FONEPAY", "FonePay"
        ESEWA = "ESEWA", "eSewa"
        KHALTI = "KHALTI", "Khalti"
        MANUAL = "MANUAL", "Manual (Admin Entry)"
        BANK_TRANSFER = "BANK_TRANSFER", "Bank Transfer"

    class PaymentStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        COMPLETED = "COMPLETED", "Completed"
        FAILED = "FAILED", "Failed"
        REFUNDED = "REFUNDED", "Refunded"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="payments")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    payment_method = models.CharField(max_length=15, choices=PaymentMethod.choices)
    transaction_id = models.CharField(max_length=100, blank=True, db_index=True)
    payment_status = models.CharField(
        max_length=10, choices=PaymentStatus.choices, default=PaymentStatus.PENDING
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    gateway_response = models.JSONField(default=dict)
    notes = models.TextField(blank=True)
    recorded_by_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["invoice", "payment_status"]),
            models.Index(fields=["transaction_id"]),
        ]

    def __str__(self):
        return f"Payment {self.transaction_id or self.id} — {self.payment_status}"


# ─── Billing Audit Log ────────────────────────────────────────────────────────

class BillingAuditLog(models.Model):
    """
    Immutable audit trail for all billing-related events.
    Never updated — only appended to.
    """

    class Action(models.TextChoices):
        SUBSCRIPTION_CREATED = "SUBSCRIPTION_CREATED", "Subscription Created"
        SUBSCRIPTION_UPDATED = "SUBSCRIPTION_UPDATED", "Subscription Updated"
        SUBSCRIPTION_SUSPENDED = "SUBSCRIPTION_SUSPENDED", "Subscription Suspended"
        SUBSCRIPTION_ACTIVATED = "SUBSCRIPTION_ACTIVATED", "Subscription Activated"
        SUBSCRIPTION_EXPIRED = "SUBSCRIPTION_EXPIRED", "Subscription Expired"
        SUBSCRIPTION_RENEWED = "SUBSCRIPTION_RENEWED", "Subscription Renewed"
        INVOICE_GENERATED = "INVOICE_GENERATED", "Invoice Generated"
        INVOICE_CANCELLED = "INVOICE_CANCELLED", "Invoice Cancelled"
        PAYMENT_RECEIVED = "PAYMENT_RECEIVED", "Payment Received"
        PAYMENT_FAILED = "PAYMENT_FAILED", "Payment Failed"
        PLAN_CHANGED = "PLAN_CHANGED", "Pricing Plan Changed"
        GRACE_PERIOD_STARTED = "GRACE_PERIOD_STARTED", "Grace Period Started"
        LATE_FEE_APPLIED = "LATE_FEE_APPLIED", "Late Fee Applied"
        USAGE_COLLECTED = "USAGE_COLLECTED", "Usage Metrics Collected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant_schema = models.CharField(max_length=63, db_index=True)
    action = models.CharField(max_length=25, choices=Action.choices)
    performed_by_id = models.UUIDField(null=True, blank=True)
    performed_by_email = models.CharField(max_length=254, blank=True)
    related_invoice_id = models.UUIDField(null=True, blank=True)
    related_subscription_id = models.UUIDField(null=True, blank=True)
    details = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant_schema", "created_at"]),
            models.Index(fields=["action"]),
        ]

    def __str__(self):
        return f"{self.action} — {self.tenant_schema} @ {self.created_at:%Y-%m-%d %H:%M}"
