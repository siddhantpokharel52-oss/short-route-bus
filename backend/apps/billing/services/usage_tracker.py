"""
Usage Tracker
=============
Collects per-tenant usage data (tickets, transactions, active buses, revenue)
by temporarily switching the DB connection to each tenant's schema,
then saving the aggregated result as a UsageMetric in the public schema.

Called by:
  - Celery tasks (nightly/monthly scheduled runs)
  - Admin manually via POST /billing/subscriptions/{id}/collect-usage/
"""

from decimal import Decimal
from django.db import connection

from backend.apps.billing.models import UsageMetric, TenantSubscription, BillingAuditLog


class UsageTracker:

    def collect_for_subscription(
        self,
        subscription: TenantSubscription,
        period_start,
        period_end,
        performed_by=None,
    ) -> UsageMetric:
        """
        Switches to the tenant schema, queries tenant-specific tables,
        then switches back to the public schema and upserts a UsageMetric.
        """
        from backend.apps.tenants.models import Tenant

        try:
            tenant = Tenant.objects.get(schema_name=subscription.tenant_schema)
        except Tenant.DoesNotExist:
            raise ValueError(
                f"Tenant schema '{subscription.tenant_schema}' not found."
            )

        # ── Switch to tenant schema ────────────────────────────────────────
        connection.set_tenant(tenant)
        try:
            tickets, transactions, active_buses, revenue = self._collect(
                period_start, period_end
            )
        finally:
            # Always restore to public schema
            connection.set_schema_to_public()

        # ── Upsert metric in public schema ─────────────────────────────────
        metric, created = UsageMetric.objects.update_or_create(
            tenant_schema=subscription.tenant_schema,
            period_start=period_start,
            period_end=period_end,
            defaults={
                "subscription": subscription,
                "total_tickets_sold": tickets,
                "total_transactions": transactions,
                "active_buses": active_buses,
                "revenue_generated": revenue,
            },
        )

        BillingAuditLog.objects.create(
            tenant_schema=subscription.tenant_schema,
            action=BillingAuditLog.Action.USAGE_COLLECTED,
            performed_by_id=getattr(performed_by, "id", None),
            performed_by_email=getattr(performed_by, "email", "system"),
            related_subscription_id=subscription.id,
            details={
                "period": f"{period_start} → {period_end}",
                "tickets": tickets,
                "transactions": transactions,
                "active_buses": active_buses,
                "revenue": str(revenue),
                "created": created,
            },
        )

        return metric

    def _collect(self, period_start, period_end):
        """
        Query the currently-active tenant schema for usage data.
        All models are accessed through django.apps to avoid cross-schema
        ORM FK confusion.
        """
        from django.apps import apps
        from django.db.models import Sum

        tickets = 0
        transactions = 0
        active_buses = 0
        revenue = Decimal("0")

        # ── Tickets ───────────────────────────────────────────────────────
        try:
            Ticket = apps.get_model("ticketing", "Ticket")
            qs = Ticket.objects.filter(
                created_at__date__gte=period_start,
                created_at__date__lte=period_end,
            )
            tickets = qs.count()
            revenue = qs.aggregate(total=Sum("fare"))["total"] or Decimal("0")
        except (LookupError, Exception):
            pass

        # ── Transactions ──────────────────────────────────────────────────
        transactions = tickets  # one transaction per ticket

        # ── Active buses ──────────────────────────────────────────────────
        try:
            Vehicle = apps.get_model("fleet", "Vehicle")
            active_buses = Vehicle.objects.filter(
                status="ACTIVE", is_deleted=False
            ).count()
        except (LookupError, Exception):
            pass

        return tickets, transactions, active_buses, revenue
