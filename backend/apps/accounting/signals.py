"""
Auto-generate double-entry journal entries from operational events:
  - Ticket sale  → Debit Cash/Bank, Credit Ticket Revenue
  - Fuel cost    → Debit Fuel Expense, Credit Accounts Payable (Fuel)
  - Maintenance  → Debit Maintenance Expense, Credit Accounts Payable (Maint.)
  - Salary paid  → Debit Salary Expense, Credit Cash/Bank
"""

from django.db.models.signals import post_save
from django.dispatch import receiver
from decimal import Decimal


# ─── helpers ────────────────────────────────────────────────────────────────

def _get_account(code):
    """Return ChartOfAccount by code, or None if not yet seeded."""
    from backend.apps.accounting.models import ChartOfAccount
    try:
        return ChartOfAccount.objects.get(code=code)
    except ChartOfAccount.DoesNotExist:
        return None


def _make_journal_entry(date, description, source_type, source_id, ref, lines):
    """
    Create + post a JournalEntry with the given lines.
    lines: list of (account_code, debit, credit, line_desc, vehicle_id, route_id)
    """
    from backend.apps.accounting.models import JournalEntry, JournalEntryLine

    entry_no = JournalEntry.generate_entry_no(date)
    je = JournalEntry.objects.create(
        entry_no=entry_no,
        date=date,
        description=description,
        status=JournalEntry.Status.POSTED,
        source_type=source_type,
        source_id=source_id,
        reference_no=ref,
    )
    for code, debit, credit, line_desc, vehicle_id, route_id in lines:
        account = _get_account(code)
        if account is None:
            continue
        JournalEntryLine.objects.create(
            journal_entry=je,
            account=account,
            description=line_desc,
            debit=Decimal(str(debit)),
            credit=Decimal(str(credit)),
            vehicle_id=vehicle_id,
            route_id=route_id,
        )
    # Update account balances
    _update_balances(je)
    return je


def _update_balances(journal_entry):
    """
    Recompute cached balance on each account touched by this JE.
    Assets/Expenses: balance += debit - credit
    Liabilities/Equity/Income: balance += credit - debit
    """
    from django.db.models import Sum, F
    from backend.apps.accounting.models import ChartOfAccount, JournalEntryLine

    account_ids = (
        journal_entry.lines.values_list("account_id", flat=True).distinct()
    )
    for acct in ChartOfAccount.objects.filter(id__in=account_ids):
        lines = JournalEntryLine.objects.filter(
            account=acct,
            journal_entry__status="POSTED",
        )
        total_debit = lines.aggregate(t=Sum("debit"))["t"] or Decimal("0")
        total_credit = lines.aggregate(t=Sum("credit"))["t"] or Decimal("0")
        if acct.is_debit_normal:
            acct.balance = total_debit - total_credit
        else:
            acct.balance = total_credit - total_debit
        acct.save(update_fields=["balance"])


# ─── TICKET SALE ────────────────────────────────────────────────────────────

@receiver(post_save, sender="ticketing.Ticket")
def on_ticket_created(sender, instance, created, **kwargs):
    if not created or instance.is_deleted:
        return

    # Choose debit account based on payment method
    payment_map = {
        "CASH": "1110",
        "SMART_CARD": "1120",
        "ESEWA": "1120",
        "KHALTI": "1120",
        "FONEPAY": "1120",
        "CONNECTIPS": "1120",
    }
    debit_code = payment_map.get(instance.payment_method, "1110")

    from django.utils import timezone
    date = instance.issued_at.date() if instance.issued_at else timezone.now().date()

    _make_journal_entry(
        date=date,
        description=f"Ticket sale – {instance.ticket_uid}",
        source_type="TICKET",
        source_id=instance.pk,
        ref=instance.ticket_uid,
        lines=[
            (debit_code, instance.fare_paid, 0, "Cash/Bank received", None, None),
            ("4100", 0, instance.fare_paid, "Ticket Sales Revenue", None, getattr(instance, "route_id", None)),
        ],
    )


# ─── FUEL COST ──────────────────────────────────────────────────────────────

@receiver(post_save, sender="fuel.FuelCost")
def on_fuel_cost_created(sender, instance, created, **kwargs):
    if not created:
        return

    issuance = instance.fuel_issuance
    _make_journal_entry(
        date=issuance.date,
        description=f"Fuel purchase – {issuance.fuel_type} {issuance.quantity_liters}L @ {issuance.station}",
        source_type="FUEL",
        source_id=instance.pk,
        ref=str(instance.pk)[:8],
        lines=[
            ("5100", instance.total_cost, 0, f"Fuel – {issuance.fuel_type}", str(issuance.vehicle_id), None),
            ("2110", 0, instance.total_cost, "Accounts Payable – Fuel Supplier", None, None),
        ],
    )


# ─── MAINTENANCE / REPAIR ───────────────────────────────────────────────────

@receiver(post_save, sender="maintenance.ServiceRecord")
def on_service_record_completed(sender, instance, created, **kwargs):
    # Only journal when the record is closed (end_date set) and has a cost
    if not instance.end_date or not instance.total_cost:
        return
    # Guard against re-entry: check if a JE already exists for this record
    from backend.apps.accounting.models import JournalEntry
    if JournalEntry.objects.filter(
        source_type=JournalEntry.SourceType.MAINTENANCE,
        source_id=instance.pk,
    ).exists():
        return

    _make_journal_entry(
        date=instance.end_date,
        description=f"Bus maintenance – Vehicle {str(instance.vehicle_id)[:8]}",
        source_type="MAINTENANCE",
        source_id=instance.pk,
        ref=str(instance.pk)[:8],
        lines=[
            ("5200", instance.total_cost, 0, "Maintenance & Repairs", str(instance.vehicle_id), None),
            ("2120", 0, instance.total_cost, "Accounts Payable – Maintenance Vendor", None, None),
        ],
    )


# ─── SALARY PAYMENT ─────────────────────────────────────────────────────────

@receiver(post_save, sender="accounting.SalaryPayment")
def on_salary_paid(sender, instance, created, **kwargs):
    if instance.status != "PAID":
        return
    if instance.journal_entry_id:
        return  # already journalised

    # Salary expense account depends on employee type
    salary_acct = "5300" if instance.employee_type == "DRIVER" else "5400"
    allow_acct = "5310" if instance.employee_type == "DRIVER" else "5410"

    lines = [
        (salary_acct, instance.basic_salary, 0,
         f"Basic salary – {instance.employee_name}", None, None),
    ]
    if instance.total_allowances:
        lines.append(
            (allow_acct, instance.total_allowances, 0,
             f"Allowances – {instance.employee_name}", None, None)
        )
    # Credit cash for net pay; deductions go back to payable
    lines.append(
        ("1110", 0, instance.net_pay, "Net salary paid", None, None)
    )
    if instance.deductions:
        lines.append(
            ("2130", 0, instance.deductions, "Salary deductions payable", None, None)
        )

    from backend.apps.accounting.models import JournalEntry, JournalEntryLine
    je = _make_journal_entry(
        date=instance.payment_date,
        description=f"Salary – {instance.employee_name} ({instance.period_from} to {instance.period_to})",
        source_type="SALARY",
        source_id=instance.pk,
        ref=str(instance.pk)[:8],
        lines=lines,
    )
    # Link back without triggering signal again
    SalaryPayment = sender
    SalaryPayment.objects.filter(pk=instance.pk).update(journal_entry=je)
