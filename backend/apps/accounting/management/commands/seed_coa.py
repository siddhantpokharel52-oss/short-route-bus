"""
Management command: seed_coa
Populates the Chart of Accounts with the standard bus-transport COA.
Safe to run multiple times (get_or_create on code).

Usage:
    python manage.py seed_coa --all-tenants
    python manage.py seed_coa --schema=sajha_yatayat
"""

from django.core.management.base import BaseCommand
from django.db import connection


# ─── COA Definition ──────────────────────────────────────────────────────────
# Format: (code, name, account_type, parent_code, description)

COA_TREE = [
    # ── ASSETS ──────────────────────────────────────────────────────────────
    ("1000", "Assets", "ASSET", None, "Total Assets"),
    ("1100", "Current Assets", "ASSET", "1000", "Short-term assets"),
    ("1110", "Cash in Hand", "ASSET", "1100", "Physical cash at depot/POS"),
    ("1120", "Cash at Bank", "ASSET", "1100", "Company bank accounts"),
    ("1130", "Accounts Receivable – Ticket Agents", "ASSET", "1100", "Amounts owed by ticketing agents"),
    ("1140", "Accounts Receivable – Corporate Clients", "ASSET", "1100", "Amounts owed by corporate pass holders"),
    ("1150", "Fuel Inventory", "ASSET", "1100", "Fuel stock valued at cost"),
    ("1160", "Spare Parts Inventory", "ASSET", "1100", "Bus spare parts at cost"),
    ("1170", "Prepaid Expenses", "ASSET", "1100", "Advance payments for insurance etc."),
    ("1200", "Fixed Assets", "ASSET", "1000", "Long-term assets"),
    ("1210", "Bus Fleet – Cost", "ASSET", "1200", "Gross cost of all buses"),
    ("1220", "Accumulated Depreciation – Bus Fleet", "ASSET", "1200", "Contra: accumulated depreciation on buses"),
    ("1230", "Office Equipment", "ASSET", "1200", "Computers, printers, POS machines"),
    ("1240", "Depot & Building", "ASSET", "1200", "Owned depot property"),
    ("1250", "Furniture & Fixtures", "ASSET", "1200", "Depot furniture"),

    # ── LIABILITIES ─────────────────────────────────────────────────────────
    ("2000", "Liabilities", "LIABILITY", None, "Total Liabilities"),
    ("2100", "Current Liabilities", "LIABILITY", "2000", "Short-term obligations"),
    ("2110", "Accounts Payable – Fuel Suppliers", "LIABILITY", "2100", "Amounts owed to fuel vendors"),
    ("2120", "Accounts Payable – Maintenance Vendors", "LIABILITY", "2100", "Workshop / spare parts payables"),
    ("2130", "Salaries Payable", "LIABILITY", "2100", "Accrued but unpaid wages"),
    ("2140", "Tax Payable", "LIABILITY", "2100", "VAT, income tax liabilities"),
    ("2150", "Advance Fares Collected", "LIABILITY", "2100", "Pre-sold monthly/seasonal passes"),
    ("2200", "Long-Term Liabilities", "LIABILITY", "2000", ""),
    ("2210", "Loan – Bus Purchase", "LIABILITY", "2200", "Bank loans for fleet acquisition"),
    ("2220", "Lease Obligations", "LIABILITY", "2200", "Finance lease on buses/equipment"),

    # ── EQUITY ──────────────────────────────────────────────────────────────
    ("3000", "Equity", "EQUITY", None, "Owner's Equity"),
    ("3100", "Owner's Capital", "EQUITY", "3000", "Initial and additional capital contributions"),
    ("3200", "Retained Earnings", "EQUITY", "3000", "Accumulated profits from prior years"),
    ("3300", "Current Year Earnings", "EQUITY", "3000", "Net profit for the current year"),
    ("3400", "Drawings", "EQUITY", "3000", "Owner withdrawals"),

    # ── INCOME ──────────────────────────────────────────────────────────────
    ("4000", "Income", "INCOME", None, "Total Revenue"),
    ("4100", "Ticket Sales Revenue", "INCOME", "4000", "Single-trip ticket revenue"),
    ("4200", "Monthly Pass Revenue", "INCOME", "4000", "Monthly commuter pass sales"),
    ("4300", "Daily Pass Revenue", "INCOME", "4000", "Day-pass sales"),
    ("4400", "Student Pass Revenue", "INCOME", "4000", "Subsidised student pass sales"),
    ("4500", "Smart Card Revenue", "INCOME", "4000", "Revenue from smart card top-ups"),
    ("4600", "Advertising Revenue", "INCOME", "4000", "Bus body / bus stop advertisement income"),
    ("4700", "Charter & Rental Income", "INCOME", "4000", "Private hire / charter bus income"),
    ("4800", "Government Subsidy Income", "INCOME", "4000", "Transport authority subsidies"),
    ("4900", "Other Income", "INCOME", "4000", "Miscellaneous operating income"),

    # ── EXPENSES ────────────────────────────────────────────────────────────
    ("5000", "Expenses", "EXPENSE", None, "Total Expenses"),
    ("5100", "Fuel Expenses", "EXPENSE", "5000", "Diesel / CNG consumption"),
    ("5200", "Bus Maintenance & Repairs", "EXPENSE", "5000", "Scheduled and breakdown repair costs"),
    ("5300", "Driver Salaries", "EXPENSE", "5000", "Basic wages paid to drivers"),
    ("5310", "Driver Allowances", "EXPENSE", "5000", "Transport, meal, and other driver allowances"),
    ("5400", "Conductor Salaries", "EXPENSE", "5000", "Basic wages paid to conductors"),
    ("5410", "Conductor Allowances", "EXPENSE", "5000", "Transport, meal, and other conductor allowances"),
    ("5500", "Depreciation – Bus Fleet", "EXPENSE", "5000", "Annual depreciation on buses"),
    ("5600", "Depot Operating Costs", "EXPENSE", "5000", "Electricity, water, security at depot"),
    ("5700", "Insurance Expenses", "EXPENSE", "5000", "Bus and liability insurance premiums"),
    ("5800", "Administrative Expenses", "EXPENSE", "5000", "Office, communications, stationery"),
    ("5900", "Finance Charges", "EXPENSE", "5000", "Loan interest and bank charges"),
    ("5910", "Tax Expense", "EXPENSE", "5000", "Income tax and vehicle tax"),
]


def _seed_for_schema(stdout, style):
    from backend.apps.accounting.models import ChartOfAccount
    created_count = 0
    code_to_obj = {}

    for code, name, atype, parent_code, desc in COA_TREE:
        parent = code_to_obj.get(parent_code) if parent_code else None
        obj, created = ChartOfAccount.objects.get_or_create(
            code=code,
            defaults={
                "name": name,
                "account_type": atype,
                "parent": parent,
                "description": desc,
                "is_system": True,
                "is_active": True,
            },
        )
        if not created and obj.parent != parent:
            obj.parent = parent
            obj.save(update_fields=["parent"])
        code_to_obj[code] = obj
        if created:
            created_count += 1

    stdout.write(
        style.SUCCESS(
            f"  Schema '{connection.schema_name}': "
            f"{created_count} new / {len(COA_TREE) - created_count} existing"
        )
    )


class Command(BaseCommand):
    help = "Seed the Chart of Accounts for bus transport operations (per tenant schema)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--schema",
            type=str,
            help="Seed a specific tenant schema (e.g. sajha_yatayat)",
        )
        parser.add_argument(
            "--all-tenants",
            action="store_true",
            help="Seed all active tenant schemas",
        )

    def handle(self, *args, **options):
        from backend.apps.tenants.models import Tenant

        if options.get("schema"):
            schema = options["schema"]
            try:
                tenant = Tenant.objects.get(schema_name=schema)
            except Tenant.DoesNotExist:
                self.stderr.write(self.style.ERROR(f"Tenant '{schema}' not found."))
                return
            connection.set_tenant(tenant)
            _seed_for_schema(self.stdout, self.style)

        elif options.get("all_tenants"):
            tenants = Tenant.objects.filter(status="ACTIVE").exclude(schema_name="public")
            self.stdout.write(f"Seeding {tenants.count()} tenant(s)...")
            for tenant in tenants:
                connection.set_tenant(tenant)
                _seed_for_schema(self.stdout, self.style)

        else:
            # If already in a tenant context (e.g. called from within a tenant shell)
            _seed_for_schema(self.stdout, self.style)

        self.stdout.write(self.style.SUCCESS("COA seeding complete."))
