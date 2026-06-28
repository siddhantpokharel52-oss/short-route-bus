import uuid
import decimal
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="ChartOfAccount",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("code", models.CharField(max_length=20, unique=True)),
                ("name", models.CharField(max_length=255)),
                ("account_type", models.CharField(
                    choices=[
                        ("ASSET", "Asset"),
                        ("LIABILITY", "Liability"),
                        ("EQUITY", "Equity"),
                        ("INCOME", "Income"),
                        ("EXPENSE", "Expense"),
                    ],
                    max_length=15,
                )),
                ("description", models.TextField(blank=True)),
                ("is_system", models.BooleanField(default=False)),
                ("is_active", models.BooleanField(default=True)),
                ("balance", models.DecimalField(decimal_places=2, default=decimal.Decimal("0"), max_digits=18)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("parent", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="children",
                    to="accounting.chartofaccount",
                )),
            ],
            options={"ordering": ["code"]},
        ),
        migrations.CreateModel(
            name="JournalEntry",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("entry_no", models.CharField(max_length=30, unique=True)),
                ("date", models.DateField()),
                ("description", models.TextField()),
                ("status", models.CharField(
                    choices=[("DRAFT", "Draft"), ("POSTED", "Posted"), ("REVERSED", "Reversed")],
                    default="DRAFT",
                    max_length=10,
                )),
                ("source_type", models.CharField(
                    choices=[
                        ("MANUAL", "Manual Entry"),
                        ("TICKET", "Ticket Sale"),
                        ("FUEL", "Fuel Purchase"),
                        ("MAINTENANCE", "Maintenance / Repair"),
                        ("SALARY", "Salary Payment"),
                        ("DEPRECIATION", "Depreciation"),
                        ("PASS", "Pass Sale"),
                        ("CHARTER", "Charter / Rental"),
                    ],
                    default="MANUAL",
                    max_length=15,
                )),
                ("source_id", models.UUIDField(blank=True, null=True)),
                ("reference_no", models.CharField(blank=True, max_length=100)),
                ("created_by_id", models.UUIDField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("reversed_entry", models.OneToOneField(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="reversal_of",
                    to="accounting.journalentry",
                )),
            ],
            options={"ordering": ["-date", "-created_at"]},
        ),
        migrations.CreateModel(
            name="JournalEntryLine",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("description", models.CharField(blank=True, max_length=500)),
                ("debit", models.DecimalField(decimal_places=2, default=decimal.Decimal("0"), max_digits=15)),
                ("credit", models.DecimalField(decimal_places=2, default=decimal.Decimal("0"), max_digits=15)),
                ("vehicle_id", models.UUIDField(blank=True, null=True)),
                ("route_id", models.UUIDField(blank=True, null=True)),
                ("account", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="journal_lines",
                    to="accounting.chartofaccount",
                )),
                ("journal_entry", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="lines",
                    to="accounting.journalentry",
                )),
            ],
            options={"ordering": ["id"]},
        ),
        migrations.CreateModel(
            name="SalaryPayment",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("employee_id", models.UUIDField()),
                ("employee_name", models.CharField(max_length=255)),
                ("employee_type", models.CharField(
                    choices=[("DRIVER", "Driver"), ("CONDUCTOR", "Conductor"), ("STAFF", "Other Staff")],
                    max_length=10,
                )),
                ("period_from", models.DateField()),
                ("period_to", models.DateField()),
                ("payment_date", models.DateField()),
                ("basic_salary", models.DecimalField(decimal_places=2, default=decimal.Decimal("0"), max_digits=12)),
                ("total_allowances", models.DecimalField(decimal_places=2, default=decimal.Decimal("0"), max_digits=12)),
                ("deductions", models.DecimalField(decimal_places=2, default=decimal.Decimal("0"), max_digits=12)),
                ("net_pay", models.DecimalField(decimal_places=2, default=decimal.Decimal("0"), max_digits=12)),
                ("payment_method", models.CharField(default="BANK_TRANSFER", max_length=20)),
                ("notes", models.TextField(blank=True)),
                ("status", models.CharField(
                    choices=[("DRAFT", "Draft"), ("PAID", "Paid")],
                    default="DRAFT",
                    max_length=10,
                )),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("journal_entry", models.OneToOneField(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="salary_payment",
                    to="accounting.journalentry",
                )),
            ],
            options={"ordering": ["-payment_date"]},
        ),
        # Indexes
        migrations.AddIndex(
            model_name="chartofaccount",
            index=models.Index(fields=["account_type"], name="accounting_coa_type_idx"),
        ),
        migrations.AddIndex(
            model_name="chartofaccount",
            index=models.Index(fields=["code"], name="accounting_coa_code_idx"),
        ),
        migrations.AddIndex(
            model_name="journalentry",
            index=models.Index(fields=["date"], name="accounting_je_date_idx"),
        ),
        migrations.AddIndex(
            model_name="journalentry",
            index=models.Index(fields=["status"], name="accounting_je_status_idx"),
        ),
        migrations.AddIndex(
            model_name="journalentry",
            index=models.Index(fields=["source_type"], name="accounting_je_source_idx"),
        ),
        migrations.AddIndex(
            model_name="journalentry",
            index=models.Index(fields=["entry_no"], name="accounting_je_no_idx"),
        ),
        migrations.AddIndex(
            model_name="salarypayment",
            index=models.Index(fields=["employee_id"], name="accounting_sp_emp_idx"),
        ),
        migrations.AddIndex(
            model_name="salarypayment",
            index=models.Index(fields=["status"], name="accounting_sp_status_idx"),
        ),
    ]
