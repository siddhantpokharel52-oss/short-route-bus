"""
One-time data repair: some JournalEntry rows were created before the Chart
of Accounts was seeded for their tenant (see the seed_coa-on-tenant-creation
fix), so they were saved with zero JournalEntryLine rows and show NPR 0.00
everywhere. This reconstructs the missing lines for every such entry, across
every tenant schema, using the same account-code logic as
backend/apps/accounting/signals.py. Safe to re-run -- it only touches
entries that currently have zero lines.

Run from the Django container:
  python backend/manage.py shell < backend/scripts/backfill_journal_lines.py
"""
from decimal import Decimal
from django_tenants.utils import get_tenant_model, schema_context
from backend.apps.accounting.models import JournalEntry, JournalEntryLine
from backend.apps.accounting.signals import _get_account, _update_balances

PAYMENT_MAP = {
    "CASH": "1110", "SMART_CARD": "1120", "ESEWA": "1120",
    "KHALTI": "1120", "FONEPAY": "1120", "CONNECTIPS": "1120",
}

total_fixed = 0
total_skipped = 0

for tenant in get_tenant_model().objects.exclude(schema_name="public"):
    with schema_context(tenant.schema_name):
        broken = [je for je in JournalEntry.objects.all() if je.lines.count() == 0]
        if not broken:
            continue
        print(f"--- {tenant.schema_name}: {len(broken)} entries with no lines ---")

        for je in broken:
            lines = []

            if je.source_type == "TICKET":
                from backend.apps.ticketing.models import Ticket
                t = Ticket.objects.filter(pk=je.source_id).first()
                if not t:
                    print(f"  SKIP {je.entry_no} -- source ticket not found")
                    total_skipped += 1
                    continue
                debit_code = PAYMENT_MAP.get(t.payment_method, "1110")
                lines = [
                    (debit_code, t.fare_paid, 0, "Cash/Bank received"),
                    ("4100", 0, t.fare_paid, "Ticket Sales Revenue"),
                ]

            elif je.source_type == "FUEL":
                from backend.apps.fuel.models import FuelCost
                f = FuelCost.objects.filter(pk=je.source_id).first()
                if not f:
                    print(f"  SKIP {je.entry_no} -- source fuel cost not found")
                    total_skipped += 1
                    continue
                lines = [
                    ("5100", f.total_cost, 0, "Fuel purchase"),
                    ("2110", 0, f.total_cost, "Accounts Payable – Fuel Supplier"),
                ]

            elif je.source_type == "MAINTENANCE":
                from backend.apps.maintenance.models import ServiceRecord
                sr = ServiceRecord.objects.filter(pk=je.source_id).first()
                if not sr:
                    print(f"  SKIP {je.entry_no} -- source service record not found")
                    total_skipped += 1
                    continue
                lines = [
                    ("5200", sr.total_cost, 0, "Maintenance & Repairs"),
                    ("2120", 0, sr.total_cost, "Accounts Payable – Maintenance Vendor"),
                ]

            elif je.source_type == "SALARY":
                from backend.apps.accounting.models import SalaryPayment
                sp = SalaryPayment.objects.filter(pk=je.source_id).first()
                if not sp:
                    print(f"  SKIP {je.entry_no} -- source salary payment not found")
                    total_skipped += 1
                    continue
                salary_acct = "5300" if sp.employee_type == "DRIVER" else "5400"
                allow_acct = "5310" if sp.employee_type == "DRIVER" else "5410"
                lines = [(salary_acct, sp.basic_salary, 0, f"Basic salary – {sp.employee_name}")]
                if sp.total_allowances:
                    lines.append((allow_acct, sp.total_allowances, 0, f"Allowances – {sp.employee_name}"))
                lines.append(("1110", 0, sp.net_pay, "Net salary paid"))
                if sp.deductions:
                    lines.append(("2130", 0, sp.deductions, "Salary deductions payable"))

            else:
                print(f"  SKIP {je.entry_no} -- unknown source_type {je.source_type}")
                total_skipped += 1
                continue

            created_any = False
            for code, debit, credit, desc in lines:
                account = _get_account(code)
                if account is None:
                    print(f"  MISSING ACCOUNT {code} -- cannot fully backfill {je.entry_no}")
                    continue
                JournalEntryLine.objects.create(
                    journal_entry=je, account=account, description=desc,
                    debit=Decimal(str(debit)), credit=Decimal(str(credit)),
                )
                created_any = True
            if created_any:
                _update_balances(je)
                total_fixed += 1
                print(f"  FIXED {je.entry_no}")

print(f"\nDone. Fixed {total_fixed} entries, skipped {total_skipped}.")
