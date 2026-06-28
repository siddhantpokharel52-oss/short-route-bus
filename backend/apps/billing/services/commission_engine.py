"""
Commission Engine — AMC Only
============================
Calculates monthly AMC charges for a TenantSubscription.

Billing Model:
  FIXED_AMOUNT  →  charge = rate (NPR per month)
  PERCENTAGE    →  charge = revenue_generated × (rate / 100)
"""

from decimal import Decimal
from typing import List, Dict, Any, Tuple


class CommissionEngine:

    def calculate(
        self,
        subscription: "TenantSubscription",
        usage: "UsageMetric",
        proration_factor: Decimal = Decimal("1.0000"),
    ) -> Tuple[Decimal, List[Dict[str, Any]]]:
        """
        Returns (total_amount, line_items).
        Only processes AMC rules; ignores any other rule types that may exist.
        """
        from backend.apps.billing.models import CommissionRule

        items: List[Dict[str, Any]] = []
        total = Decimal("0")

        if not subscription.plan_id:
            return total, items

        active_overrides = (
            subscription.rule_overrides
            .filter(is_active=True)
            .select_related("commission_rule")
        )

        for override in active_overrides:
            rule = override.commission_rule
            if not rule.is_active or rule.rule_type != CommissionRule.RuleType.AMC:
                continue

            rate = override.effective_rate()

            if rule.billing_model == CommissionRule.BillingModel.FIXED_AMOUNT:
                quantity = Decimal("1")
                unit_rate = rate
                amount = (rate * proration_factor).quantize(Decimal("0.01"))
                description = f"Monthly AMC — Fixed Charge (NPR {rate:,.2f}/month)"

            else:  # PERCENTAGE
                quantity = usage.revenue_generated
                unit_rate = rate / Decimal("100")
                amount = (usage.revenue_generated * unit_rate * proration_factor).quantize(Decimal("0.01"))
                description = f"Monthly AMC — {rate}% of revenue (NPR {usage.revenue_generated:,.2f})"

            total += amount
            items.append({
                "rule_type": rule.rule_type,
                "description": description,
                "quantity": quantity,
                "unit_rate": unit_rate,
                "amount": amount,
            })

        return total.quantize(Decimal("0.01")), items

    def preview(
        self,
        subscription: "TenantSubscription",
        usage: "UsageMetric",
        proration_factor: Decimal = Decimal("1.0000"),
    ) -> Dict[str, Any]:
        """Dry-run — no DB writes."""
        total, items = self.calculate(subscription, usage, proration_factor)
        return {
            "tenant_schema": subscription.tenant_schema,
            "tenant_name": subscription.tenant_name,
            "plan": subscription.plan.name if subscription.plan else None,
            "proration_factor": str(proration_factor),
            "line_items": [
                {
                    "rule_type": i["rule_type"],
                    "description": i["description"],
                    "quantity": str(i["quantity"]),
                    "unit_rate": str(i["unit_rate"]),
                    "amount": str(i["amount"]),
                }
                for i in items
            ],
            "subtotal": str(total),
        }
