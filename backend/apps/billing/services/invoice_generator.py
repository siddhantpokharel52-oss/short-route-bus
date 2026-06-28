"""
Invoice Generator
=================
Generates invoices for a TenantSubscription for a given billing period.

Responsibilities:
  1. Get / create the UsageMetric for the period
  2. Run the CommissionEngine to compute line items
  3. Apply tax (VAT) and optional late fee
  4. Create Invoice + InvoiceItem records
  5. Write a BillingAuditLog entry
"""

from decimal import Decimal
from django.utils import timezone
from dateutil.relativedelta import relativedelta

from backend.apps.billing.models import (
    Invoice, InvoiceItem, TenantSubscription, UsageMetric, BillingAuditLog
)
from backend.apps.billing.services.commission_engine import CommissionEngine


class InvoiceGenerator:

    def generate(
        self,
        subscription: TenantSubscription,
        period_start,
        period_end,
        tax_rate: Decimal = Decimal("0"),
        proration_factor: Decimal = Decimal("1.0000"),
        is_prorated: bool = False,
        late_fee: Decimal = Decimal("0"),
        performed_by=None,
    ) -> Invoice:
        """
        Generate and persist an invoice for a billing period.
        Returns the created Invoice instance.
        """

        # ── 1. Ensure UsageMetric exists ──────────────────────────────────────
        usage, _ = UsageMetric.objects.get_or_create(
            tenant_schema=subscription.tenant_schema,
            period_start=period_start,
            period_end=period_end,
            defaults={"subscription": subscription},
        )

        # ── 2. Calculate commissions ──────────────────────────────────────────
        engine = CommissionEngine()
        subtotal, line_items = engine.calculate(subscription, usage, proration_factor)

        # ── 3. Tax + late fee ─────────────────────────────────────────────────
        tax_amount = (subtotal * (tax_rate / Decimal("100"))).quantize(Decimal("0.01"))
        total_amount = (subtotal + tax_amount + late_fee).quantize(Decimal("0.01"))

        # ── 4. Invoice number: INV-YYYYMM-SCHEMA-SEQ ──────────────────────────
        month_str = period_start.strftime("%Y%m")
        schema_tag = subscription.tenant_schema.upper()[:6]
        seq = (
            Invoice.objects.filter(
                tenant_schema=subscription.tenant_schema,
                billing_period_start__year=period_start.year,
                billing_period_start__month=period_start.month,
            ).count()
            + 1
        )
        invoice_number = f"INV-{month_str}-{schema_tag}-{seq:04d}"

        # Due 15 days from today
        due_date = timezone.now().date() + relativedelta(days=15)

        # ── 5. Persist ────────────────────────────────────────────────────────
        invoice = Invoice.objects.create(
            invoice_number=invoice_number,
            tenant_schema=subscription.tenant_schema,
            tenant_name=subscription.tenant_name,
            subscription=subscription,
            billing_period_start=period_start,
            billing_period_end=period_end,
            usage_metric=usage,
            subtotal=subtotal,
            tax_rate=tax_rate,
            tax_amount=tax_amount,
            late_fee=late_fee,
            total_amount=total_amount,
            due_date=due_date,
            is_prorated=is_prorated,
            proration_factor=proration_factor,
        )

        # ── 6. Line items ─────────────────────────────────────────────────────
        for item in line_items:
            InvoiceItem.objects.create(invoice=invoice, **item)

        if late_fee > 0:
            InvoiceItem.objects.create(
                invoice=invoice,
                rule_type="LATE_FEE",
                description="Late Payment Fee",
                quantity=Decimal("1"),
                unit_rate=late_fee,
                amount=late_fee,
            )

        # ── 7. Audit log ──────────────────────────────────────────────────────
        BillingAuditLog.objects.create(
            tenant_schema=subscription.tenant_schema,
            action=BillingAuditLog.Action.INVOICE_GENERATED,
            performed_by_id=getattr(performed_by, "id", None),
            performed_by_email=getattr(performed_by, "email", ""),
            related_invoice_id=invoice.id,
            related_subscription_id=subscription.id,
            details={
                "invoice_number": invoice_number,
                "period": f"{period_start} → {period_end}",
                "subtotal": str(subtotal),
                "tax_rate": str(tax_rate),
                "tax_amount": str(tax_amount),
                "late_fee": str(late_fee),
                "total_amount": str(total_amount),
                "is_prorated": is_prorated,
                "proration_factor": str(proration_factor),
                "line_items": len(line_items),
            },
        )

        return invoice

    # ── Proration helper ──────────────────────────────────────────────────────

    def calculate_proration_factor(
        self, subscription: TenantSubscription, upgrade_date
    ) -> Decimal:
        """
        Returns the fraction of the billing period remaining from upgrade_date.
        Used when a tenant upgrades their plan mid-cycle.
        """
        period_start = subscription.start_date
        period_end = subscription.end_date
        total_days = max((period_end - period_start).days, 1)
        remaining_days = max((period_end - upgrade_date).days, 0)
        return Decimal(remaining_days) / Decimal(total_days)
