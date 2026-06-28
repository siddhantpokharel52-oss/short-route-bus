from decimal import Decimal
from django.utils import timezone
from django.db import transaction
from dateutil.relativedelta import relativedelta
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from backend.apps.users.permissions import IsSuperAdmin, IsPlatformRole
from backend.apps.users.pagination import StandardResultsPagination
from .models import (
    PricingPlan, CommissionRule, TenantSubscription, SubscriptionCommissionRule,
    UsageMetric, Invoice, InvoiceItem, Payment, BillingAuditLog,
)
from .serializers import (
    PricingPlanSerializer, PricingPlanCreateSerializer,
    CommissionRuleSerializer, TenantSubscriptionSerializer,
    TenantSubscriptionCreateSerializer, UsageMetricSerializer,
    InvoiceSerializer, PaymentSerializer, PaymentWebhookSerializer,
    BillingAuditLogSerializer, GenerateInvoiceSerializer,
    AssignPlanSerializer, SuspendSerializer, ManualUsageSerializer,
    SubscriptionCommissionRuleSerializer,
)
from .services.commission_engine import CommissionEngine
from .services.invoice_generator import InvoiceGenerator
from .services.usage_tracker import UsageTracker


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response(
        {
            "success": success,
            "data": data,
            "message": message,
            "errors": errors,
            "meta": {"timestamp": timezone.now().isoformat()},
        },
        status=status_code,
    )


# ─── Pricing Plan ─────────────────────────────────────────────────────────────

class PricingPlanViewSet(viewsets.ModelViewSet):
    """
    CRUD for pricing plan templates.
    GET  /billing/plans/
    POST /billing/plans/
    GET  /billing/plans/{id}/
    PATCH/PUT /billing/plans/{id}/
    POST /billing/plans/{id}/add-rule/
    """
    queryset = PricingPlan.objects.prefetch_related("commission_rules").all()
    permission_classes = [IsSuperAdmin]
    pagination_class = StandardResultsPagination
    search_fields = ["name", "description"]
    filterset_fields = ["billing_frequency", "is_active"]

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return PricingPlanCreateSerializer
        return PricingPlanSerializer

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(PricingPlanSerializer(page, many=True).data)
        return api_response(data=PricingPlanSerializer(qs, many=True).data)

    def create(self, request, *args, **kwargs):
        serializer = PricingPlanCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        plan = serializer.save()
        return api_response(
            data=PricingPlanSerializer(plan).data,
            message="Pricing plan created.",
            status_code=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="add-rule")
    def add_rule(self, request, pk=None):
        """POST /billing/plans/{id}/add-rule/ — add a CommissionRule to this plan."""
        plan = self.get_object()
        ser = CommissionRuleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        rule = ser.save(plan=plan)
        return api_response(
            data=CommissionRuleSerializer(rule).data,
            message="Commission rule added.",
            status_code=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["delete"], url_path="rules/(?P<rule_id>[^/.]+)")
    def remove_rule(self, request, pk=None, rule_id=None):
        """DELETE /billing/plans/{id}/rules/{rule_id}/"""
        rule = CommissionRule.objects.filter(id=rule_id, plan_id=pk).first()
        if not rule:
            return api_response(message="Rule not found.", success=False, status_code=404)
        rule.delete()
        return api_response(message="Commission rule removed.")


# ─── Tenant Subscription ──────────────────────────────────────────────────────

class TenantSubscriptionViewSet(viewsets.ModelViewSet):
    """
    Manages platform billing subscriptions for tenants.

    GET    /billing/subscriptions/
    POST   /billing/subscriptions/
    GET    /billing/subscriptions/{id}/
    PATCH  /billing/subscriptions/{id}/

    Actions:
      POST  /billing/subscriptions/{id}/assign-plan/
      POST  /billing/subscriptions/{id}/generate-invoice/
      GET   /billing/subscriptions/{id}/calculate-commission/
      POST  /billing/subscriptions/{id}/collect-usage/
      POST  /billing/subscriptions/{id}/submit-usage/
      POST  /billing/subscriptions/{id}/suspend/
      POST  /billing/subscriptions/{id}/activate/
      POST  /billing/subscriptions/{id}/renew/
      POST  /billing/subscriptions/{id}/add-rule-override/
    """
    queryset = TenantSubscription.objects.select_related("plan").prefetch_related(
        "rule_overrides__commission_rule", "invoices"
    ).all()
    permission_classes = [IsSuperAdmin]
    pagination_class = StandardResultsPagination
    filterset_fields = ["status", "billing_frequency", "plan"]
    search_fields = ["tenant_name", "tenant_schema"]

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return TenantSubscriptionCreateSerializer
        return TenantSubscriptionSerializer

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(TenantSubscriptionSerializer(page, many=True).data)
        return api_response(data=TenantSubscriptionSerializer(qs, many=True).data)

    def create(self, request, *args, **kwargs):
        ser = TenantSubscriptionCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            sub = ser.save(created_by_id=request.user.id)
            # Auto-sync commission rule overrides from the assigned plan
            if sub.plan_id:
                for rule in sub.plan.commission_rules.filter(is_active=True):
                    SubscriptionCommissionRule.objects.get_or_create(
                        subscription=sub,
                        commission_rule=rule,
                        defaults={"is_active": True},
                    )
            BillingAuditLog.objects.create(
                tenant_schema=sub.tenant_schema,
                action=BillingAuditLog.Action.SUBSCRIPTION_CREATED,
                performed_by_id=request.user.id,
                performed_by_email=request.user.email,
                related_subscription_id=sub.id,
                details={"status": sub.status, "plan": str(sub.plan_id)},
            )
        return api_response(
            data=TenantSubscriptionSerializer(sub).data,
            message="Subscription created.",
            status_code=status.HTTP_201_CREATED,
        )

    # ── assign-plan ───────────────────────────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="assign-plan")
    def assign_plan(self, request, pk=None):
        """
        POST /billing/subscriptions/{id}/assign-plan/
        Assign (or change) the pricing plan for this subscription.
        Syncs commission rule overrides from the plan's rules.
        """
        sub = self.get_object()
        ser = AssignPlanSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        old_plan = sub.plan
        plan = PricingPlan.objects.filter(id=ser.validated_data["plan_id"]).first()
        if not plan:
            return api_response(message="Pricing plan not found.", success=False, status_code=404)

        with transaction.atomic():
            sub.plan = plan
            sub.save(update_fields=["plan", "updated_at"])

            # Sync rule overrides — add new rules from the plan that aren't overridden yet
            existing_rule_ids = set(
                sub.rule_overrides.values_list("commission_rule_id", flat=True)
            )
            for rule in plan.commission_rules.filter(is_active=True):
                if rule.id not in existing_rule_ids:
                    SubscriptionCommissionRule.objects.create(
                        subscription=sub,
                        commission_rule=rule,
                        is_active=True,
                    )

            # Handle proration if mid-cycle
            proration_note = ""
            if ser.validated_data.get("apply_proration") and old_plan:
                gen = InvoiceGenerator()
                factor = gen.calculate_proration_factor(sub, timezone.now().date())
                proration_note = f" Proration factor: {factor}"

            BillingAuditLog.objects.create(
                tenant_schema=sub.tenant_schema,
                action=BillingAuditLog.Action.PLAN_CHANGED,
                performed_by_id=request.user.id,
                performed_by_email=request.user.email,
                related_subscription_id=sub.id,
                details={
                    "old_plan": str(old_plan.id) if old_plan else None,
                    "new_plan": str(plan.id),
                    "new_plan_name": plan.name,
                    "note": proration_note,
                },
            )

        return api_response(
            data=TenantSubscriptionSerializer(sub).data,
            message=f"Plan assigned: {plan.name}.{proration_note}",
        )

    # ── add-rule-override ─────────────────────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="add-rule-override")
    def add_rule_override(self, request, pk=None):
        """
        POST /billing/subscriptions/{id}/add-rule-override/
        Add or update a per-tenant commission rule override.
        """
        sub = self.get_object()
        ser = SubscriptionCommissionRuleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        override, _ = SubscriptionCommissionRule.objects.update_or_create(
            subscription=sub,
            commission_rule_id=ser.validated_data["commission_rule"].id,
            defaults={
                "override_rate": ser.validated_data.get("override_rate"),
                "is_active": ser.validated_data.get("is_active", True),
            },
        )
        return api_response(
            data=SubscriptionCommissionRuleSerializer(override).data,
            message="Rule override saved.",
        )

    # ── collect-usage ─────────────────────────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="collect-usage")
    def collect_usage(self, request, pk=None):
        """
        POST /billing/subscriptions/{id}/collect-usage/
        Triggers the UsageTracker to pull live data from the tenant schema.
        """
        sub = self.get_object()
        ser = GenerateInvoiceSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        tracker = UsageTracker()
        try:
            metric = tracker.collect_for_subscription(
                subscription=sub,
                period_start=ser.validated_data["period_start"],
                period_end=ser.validated_data["period_end"],
                performed_by=request.user,
            )
        except ValueError as e:
            return api_response(message=str(e), success=False, status_code=400)

        return api_response(
            data=UsageMetricSerializer(metric).data,
            message="Usage collected from tenant schema.",
        )

    # ── submit-usage ──────────────────────────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="submit-usage")
    def submit_usage(self, request, pk=None):
        """
        POST /billing/subscriptions/{id}/submit-usage/
        Admin manually submits usage figures (when auto-collection isn't available).
        """
        sub = self.get_object()
        ser = ManualUsageSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        metric, _ = UsageMetric.objects.update_or_create(
            tenant_schema=sub.tenant_schema,
            period_start=d["period_start"],
            period_end=d["period_end"],
            defaults={
                "subscription": sub,
                "total_tickets_sold": d["total_tickets_sold"],
                "total_transactions": d["total_transactions"],
                "active_buses": d["active_buses"],
                "revenue_generated": d["revenue_generated"],
            },
        )
        return api_response(
            data=UsageMetricSerializer(metric).data,
            message="Usage metrics saved.",
        )

    # ── calculate-commission ──────────────────────────────────────────────────

    @action(detail=True, methods=["get"], url_path="calculate-commission")
    def calculate_commission(self, request, pk=None):
        """
        GET /billing/subscriptions/{id}/calculate-commission/?period_start=&period_end=
        Dry-run commission calculation using the latest usage metric.
        """
        sub = self.get_object()
        period_start = request.query_params.get("period_start")
        period_end = request.query_params.get("period_end")

        if not period_start or not period_end:
            return api_response(
                message="period_start and period_end are required query params.",
                success=False,
                status_code=400,
            )

        usage = (
            UsageMetric.objects.filter(
                tenant_schema=sub.tenant_schema,
                period_start=period_start,
                period_end=period_end,
            ).first()
        )
        if not usage:
            # Return zero calculation if no usage data yet
            usage = UsageMetric(
                tenant_schema=sub.tenant_schema,
                period_start=period_start,
                period_end=period_end,
            )

        engine = CommissionEngine()
        preview = engine.preview(sub, usage)
        return api_response(data=preview, message="Commission calculation preview.")

    # ── generate-invoice ──────────────────────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="generate-invoice")
    def generate_invoice(self, request, pk=None):
        """
        POST /billing/subscriptions/{id}/generate-invoice/
        Generates and persists an invoice for a billing period.
        """
        sub = self.get_object()
        ser = GenerateInvoiceSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        gen = InvoiceGenerator()
        with transaction.atomic():
            invoice = gen.generate(
                subscription=sub,
                period_start=d["period_start"],
                period_end=d["period_end"],
                tax_rate=d.get("tax_rate", Decimal("0")),
                proration_factor=d.get("proration_factor", Decimal("1.0000")),
                is_prorated=d.get("is_prorated", False),
                late_fee=d.get("late_fee", Decimal("0")),
                performed_by=request.user,
            )

        return api_response(
            data=InvoiceSerializer(invoice).data,
            message=f"Invoice {invoice.invoice_number} generated.",
            status_code=status.HTTP_201_CREATED,
        )

    # ── suspend ───────────────────────────────────────────────────────────────

    @action(detail=True, methods=["post"])
    def suspend(self, request, pk=None):
        """POST /billing/subscriptions/{id}/suspend/"""
        sub = self.get_object()
        ser = SuspendSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        if sub.status == TenantSubscription.Status.SUSPENDED:
            return api_response(message="Already suspended.", success=False, status_code=400)

        with transaction.atomic():
            sub.status = TenantSubscription.Status.SUSPENDED
            if ser.validated_data.get("apply_grace_period", True):
                from dateutil.relativedelta import relativedelta
                sub.grace_period_end = timezone.now().date() + relativedelta(
                    days=sub.grace_period_days
                )
            sub.save(update_fields=["status", "grace_period_end", "updated_at"])

            BillingAuditLog.objects.create(
                tenant_schema=sub.tenant_schema,
                action=BillingAuditLog.Action.SUBSCRIPTION_SUSPENDED,
                performed_by_id=request.user.id,
                performed_by_email=request.user.email,
                related_subscription_id=sub.id,
                details={
                    "reason": ser.validated_data["reason"],
                    "grace_period_end": str(sub.grace_period_end),
                },
            )

        return api_response(
            data=TenantSubscriptionSerializer(sub).data,
            message="Subscription suspended.",
        )

    # ── activate ──────────────────────────────────────────────────────────────

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        """POST /billing/subscriptions/{id}/activate/"""
        sub = self.get_object()
        with transaction.atomic():
            sub.status = TenantSubscription.Status.ACTIVE
            sub.grace_period_end = None
            sub.save(update_fields=["status", "grace_period_end", "updated_at"])
            BillingAuditLog.objects.create(
                tenant_schema=sub.tenant_schema,
                action=BillingAuditLog.Action.SUBSCRIPTION_ACTIVATED,
                performed_by_id=request.user.id,
                performed_by_email=request.user.email,
                related_subscription_id=sub.id,
            )
        return api_response(
            data=TenantSubscriptionSerializer(sub).data,
            message="Subscription activated.",
        )

    # ── renew ─────────────────────────────────────────────────────────────────

    @action(detail=True, methods=["post"])
    def renew(self, request, pk=None):
        """POST /billing/subscriptions/{id}/renew/ — extend by one billing cycle."""
        sub = self.get_object()
        with transaction.atomic():
            next_end = sub.compute_next_billing_date()
            sub.start_date = sub.end_date
            sub.end_date = next_end
            sub.status = TenantSubscription.Status.ACTIVE
            sub.grace_period_end = None
            sub.save(update_fields=["start_date", "end_date", "status", "grace_period_end", "updated_at"])
            BillingAuditLog.objects.create(
                tenant_schema=sub.tenant_schema,
                action=BillingAuditLog.Action.SUBSCRIPTION_RENEWED,
                performed_by_id=request.user.id,
                performed_by_email=request.user.email,
                related_subscription_id=sub.id,
                details={"new_end_date": str(sub.end_date)},
            )
        return api_response(
            data=TenantSubscriptionSerializer(sub).data,
            message=f"Subscription renewed until {sub.end_date}.",
        )

    # ── usage metrics (read-only) ─────────────────────────────────────────────

    @action(detail=True, methods=["get"], url_path="usage")
    def usage_metrics(self, request, pk=None):
        """GET /billing/subscriptions/{id}/usage/ — list all usage snapshots."""
        sub = self.get_object()
        metrics = sub.usage_metrics.all().order_by("-period_start")
        return api_response(data=UsageMetricSerializer(metrics, many=True).data)


# ─── Invoice ViewSet ──────────────────────────────────────────────────────────

class InvoiceViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET  /billing/invoices/
    GET  /billing/invoices/{id}/
    PATCH /billing/invoices/{id}/      — update payment_status / notes
    POST /billing/invoices/{id}/mark-paid/
    POST /billing/invoices/{id}/cancel/
    """
    queryset = Invoice.objects.prefetch_related("items", "payments").all()
    permission_classes = [IsSuperAdmin]
    pagination_class = StandardResultsPagination
    serializer_class = InvoiceSerializer
    filterset_fields = ["payment_status", "tenant_schema"]
    search_fields = ["invoice_number", "tenant_name"]
    ordering_fields = ["created_at", "due_date", "total_amount"]

    # Allow PATCH on top of read-only
    http_method_names = ["get", "patch", "head", "options"]

    def partial_update(self, request, *args, **kwargs):
        invoice = self.get_object()
        allowed = {"payment_status", "notes", "due_date"}
        data = {k: v for k, v in request.data.items() if k in allowed}
        ser = InvoiceSerializer(invoice, data=data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return api_response(data=ser.data, message="Invoice updated.")

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        """
        GET /billing/invoices/summary/
        Returns:
          - monthly_revenue   : sum of total_amount for PAID invoices in the current calendar month
          - total_pending_amc : sum of total_amount for PENDING + OVERDUE invoices (all time)
        """
        from django.db.models import Sum

        today = timezone.now().date()
        month_start = today.replace(day=1)

        monthly_revenue = (
            Invoice.objects.filter(
                payment_status=Invoice.PaymentStatus.PAID,
                paid_at__date__gte=month_start,
            ).aggregate(total=Sum("total_amount"))["total"]
            or Decimal("0")
        )

        total_pending_amc = (
            Invoice.objects.filter(
                payment_status__in=[
                    Invoice.PaymentStatus.PENDING,
                    Invoice.PaymentStatus.OVERDUE,
                ]
            ).aggregate(total=Sum("total_amount"))["total"]
            or Decimal("0")
        )

        return api_response(data={
            "monthly_revenue": str(monthly_revenue),
            "total_pending_amc": str(total_pending_amc),
        })

    @action(detail=True, methods=["post"], url_path="mark-paid")
    def mark_paid(self, request, pk=None):
        invoice = self.get_object()
        with transaction.atomic():
            invoice.payment_status = Invoice.PaymentStatus.PAID
            invoice.paid_at = timezone.now()
            invoice.save(update_fields=["payment_status", "paid_at", "updated_at"])
            BillingAuditLog.objects.create(
                tenant_schema=invoice.tenant_schema,
                action=BillingAuditLog.Action.PAYMENT_RECEIVED,
                performed_by_id=request.user.id,
                performed_by_email=request.user.email,
                related_invoice_id=invoice.id,
                details={"invoice_number": invoice.invoice_number, "method": "admin_mark_paid"},
            )
        return api_response(
            data=InvoiceSerializer(invoice).data,
            message=f"Invoice {invoice.invoice_number} marked as paid.",
        )

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        invoice = self.get_object()
        if invoice.payment_status == Invoice.PaymentStatus.PAID:
            return api_response(message="Cannot cancel a paid invoice.", success=False, status_code=400)
        invoice.payment_status = Invoice.PaymentStatus.CANCELLED
        invoice.save(update_fields=["payment_status", "updated_at"])
        BillingAuditLog.objects.create(
            tenant_schema=invoice.tenant_schema,
            action=BillingAuditLog.Action.INVOICE_CANCELLED,
            performed_by_id=request.user.id,
            performed_by_email=request.user.email,
            related_invoice_id=invoice.id,
        )
        return api_response(message=f"Invoice {invoice.invoice_number} cancelled.")


# ─── Payment ViewSet ──────────────────────────────────────────────────────────

class PaymentViewSet(viewsets.ModelViewSet):
    """
    GET  /billing/payments/
    POST /billing/payments/              — manual payment entry by admin
    POST /billing/payments/webhook/      — inbound gateway webhook
    """
    queryset = Payment.objects.select_related("invoice").all()
    permission_classes = [IsSuperAdmin]
    pagination_class = StandardResultsPagination
    serializer_class = PaymentSerializer
    filterset_fields = ["payment_status", "payment_method"]
    search_fields = ["transaction_id", "invoice__invoice_number"]

    def create(self, request, *args, **kwargs):
        """Manual payment entry by admin."""
        ser = PaymentSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            payment = ser.save(
                recorded_by_id=request.user.id,
                payment_status=Payment.PaymentStatus.COMPLETED,
                paid_at=timezone.now(),
            )
            # Mark invoice as paid if full amount covered
            invoice = payment.invoice
            paid_total = sum(
                p.amount for p in invoice.payments.filter(
                    payment_status=Payment.PaymentStatus.COMPLETED
                )
            )
            if paid_total >= invoice.total_amount:
                invoice.payment_status = Invoice.PaymentStatus.PAID
                invoice.paid_at = timezone.now()
                invoice.save(update_fields=["payment_status", "paid_at", "updated_at"])

            BillingAuditLog.objects.create(
                tenant_schema=invoice.tenant_schema,
                action=BillingAuditLog.Action.PAYMENT_RECEIVED,
                performed_by_id=request.user.id,
                performed_by_email=request.user.email,
                related_invoice_id=invoice.id,
                details={
                    "amount": str(payment.amount),
                    "method": payment.payment_method,
                    "transaction_id": payment.transaction_id,
                },
            )
        return api_response(
            data=PaymentSerializer(payment).data,
            message="Payment recorded.",
            status_code=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["post"])
    def webhook(self, request):
        """
        POST /billing/payments/webhook/
        Inbound webhook from eSewa / Khalti / FonePay / ConnectIPS.
        Idempotent — won't create duplicate payments for the same transaction_id.
        """
        ser = PaymentWebhookSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        invoice = Invoice.objects.filter(id=d["invoice_id"]).first()
        if not invoice:
            return api_response(message="Invoice not found.", success=False, status_code=404)

        # Idempotency check
        if Payment.objects.filter(transaction_id=d["transaction_id"]).exists():
            return api_response(message="Payment already recorded (duplicate webhook).")

        with transaction.atomic():
            payment = Payment.objects.create(
                invoice=invoice,
                amount=d["amount"],
                payment_method=d["payment_method"],
                transaction_id=d["transaction_id"],
                payment_status=d["status"],
                paid_at=timezone.now() if d["status"] == Payment.PaymentStatus.COMPLETED else None,
                gateway_response=d.get("gateway_response", {}),
            )
            if d["status"] == Payment.PaymentStatus.COMPLETED:
                paid_total = sum(
                    p.amount for p in invoice.payments.filter(
                        payment_status=Payment.PaymentStatus.COMPLETED
                    )
                )
                if paid_total >= invoice.total_amount:
                    invoice.payment_status = Invoice.PaymentStatus.PAID
                    invoice.paid_at = timezone.now()
                    invoice.save(update_fields=["payment_status", "paid_at", "updated_at"])

            action_key = (
                BillingAuditLog.Action.PAYMENT_RECEIVED
                if d["status"] == Payment.PaymentStatus.COMPLETED
                else BillingAuditLog.Action.PAYMENT_FAILED
            )
            BillingAuditLog.objects.create(
                tenant_schema=invoice.tenant_schema,
                action=action_key,
                related_invoice_id=invoice.id,
                details={
                    "gateway": d["payment_method"],
                    "transaction_id": d["transaction_id"],
                    "amount": str(d["amount"]),
                    "status": d["status"],
                },
            )

        return api_response(data=PaymentSerializer(payment).data, message="Webhook processed.")


# ─── Billing Audit Log ────────────────────────────────────────────────────────

class BillingAuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET /billing/audit-logs/
    GET /billing/audit-logs/{id}/
    """
    queryset = BillingAuditLog.objects.all()
    permission_classes = [IsSuperAdmin]
    pagination_class = StandardResultsPagination
    serializer_class = BillingAuditLogSerializer
    filterset_fields = ["tenant_schema", "action"]
    search_fields = ["tenant_schema", "performed_by_email"]
    ordering_fields = ["created_at"]
