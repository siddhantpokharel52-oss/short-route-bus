"""
Billing Celery Tasks
====================
Scheduled tasks for:
  - Collecting usage metrics from all active tenant schemas
  - Auto-generating monthly invoices
  - Marking overdue invoices
  - Expiring subscriptions past end_date
  - Sending billing reminders (future: via Notifications app)
"""

from celery import shared_task
from django.utils import timezone
from dateutil.relativedelta import relativedelta
import logging

logger = logging.getLogger("billing.tasks")


@shared_task(name="billing.collect_all_usage_metrics")
def collect_all_usage_metrics():
    """
    Nightly task: collect usage data for every active subscription.
    Runs against the current billing period.
    """
    from backend.apps.billing.models import TenantSubscription
    from backend.apps.billing.services.usage_tracker import UsageTracker

    today = timezone.now().date()
    tracker = UsageTracker()
    active = TenantSubscription.objects.filter(
        status__in=["ACTIVE", "TRIAL"]
    ).select_related("plan")

    collected = 0
    errors = 0

    for sub in active:
        try:
            tracker.collect_for_subscription(
                subscription=sub,
                period_start=sub.start_date,
                period_end=sub.end_date,
            )
            collected += 1
        except Exception as exc:
            logger.error("Usage collection failed for %s: %s", sub.tenant_schema, exc)
            errors += 1

    logger.info("Usage collection done: %d collected, %d errors.", collected, errors)
    return {"collected": collected, "errors": errors}


@shared_task(name="billing.auto_generate_monthly_invoices")
def auto_generate_monthly_invoices():
    """
    Monthly task: generate invoices for subscriptions whose billing period ends today.
    Skips if an invoice already exists for this period.
    """
    from backend.apps.billing.models import TenantSubscription, Invoice
    from backend.apps.billing.services.invoice_generator import InvoiceGenerator

    today = timezone.now().date()
    gen = InvoiceGenerator()
    generated = 0
    skipped = 0

    # Find subscriptions that end today and have auto_renew enabled
    due_subs = TenantSubscription.objects.filter(
        status="ACTIVE",
        end_date=today,
        auto_renew=True,
    ).select_related("plan")

    for sub in due_subs:
        # Skip if invoice already exists for this period
        exists = Invoice.objects.filter(
            subscription=sub,
            billing_period_start=sub.start_date,
            billing_period_end=sub.end_date,
        ).exists()
        if exists:
            skipped += 1
            continue

        try:
            invoice = gen.generate(
                subscription=sub,
                period_start=sub.start_date,
                period_end=sub.end_date,
            )
            logger.info("Auto-generated invoice %s for %s", invoice.invoice_number, sub.tenant_schema)
            generated += 1
        except Exception as exc:
            logger.error("Invoice generation failed for %s: %s", sub.tenant_schema, exc)

    logger.info("Auto-invoicing: %d generated, %d skipped.", generated, skipped)
    return {"generated": generated, "skipped": skipped}


@shared_task(name="billing.mark_overdue_invoices")
def mark_overdue_invoices():
    """
    Daily task: mark PENDING invoices as OVERDUE if past due_date.
    """
    from backend.apps.billing.models import Invoice

    today = timezone.now().date()
    overdue = Invoice.objects.filter(
        payment_status=Invoice.PaymentStatus.PENDING,
        due_date__lt=today,
    )
    count = overdue.count()
    overdue.update(payment_status=Invoice.PaymentStatus.OVERDUE)
    logger.info("Marked %d invoices as OVERDUE.", count)
    return {"overdue_count": count}


@shared_task(name="billing.expire_subscriptions")
def expire_subscriptions():
    """
    Daily task: expire subscriptions past end_date (and past grace period).
    """
    from backend.apps.billing.models import TenantSubscription, BillingAuditLog

    today = timezone.now().date()
    to_expire = TenantSubscription.objects.filter(
        status__in=["ACTIVE", "TRIAL"],
        end_date__lt=today,
    ).exclude(grace_period_end__gte=today)

    count = 0
    for sub in to_expire:
        sub.status = TenantSubscription.Status.EXPIRED
        sub.save(update_fields=["status", "updated_at"])
        BillingAuditLog.objects.create(
            tenant_schema=sub.tenant_schema,
            action=BillingAuditLog.Action.SUBSCRIPTION_EXPIRED,
            details={"end_date": str(sub.end_date)},
        )
        count += 1

    logger.info("Expired %d subscriptions.", count)
    return {"expired": count}


@shared_task(name="billing.auto_renew_subscriptions")
def auto_renew_subscriptions():
    """
    Daily task: auto-renew subscriptions that expire today and have auto_renew=True.
    Extends end_date by one billing cycle.
    """
    from backend.apps.billing.models import TenantSubscription, BillingAuditLog

    today = timezone.now().date()
    to_renew = TenantSubscription.objects.filter(
        status="ACTIVE",
        end_date=today,
        auto_renew=True,
    )

    count = 0
    for sub in to_renew:
        old_end = sub.end_date
        sub.start_date = sub.end_date
        sub.end_date = sub.compute_next_billing_date()
        sub.save(update_fields=["start_date", "end_date", "updated_at"])
        BillingAuditLog.objects.create(
            tenant_schema=sub.tenant_schema,
            action=BillingAuditLog.Action.SUBSCRIPTION_RENEWED,
            details={"old_end": str(old_end), "new_end": str(sub.end_date)},
        )
        count += 1

    logger.info("Auto-renewed %d subscriptions.", count)
    return {"renewed": count}
