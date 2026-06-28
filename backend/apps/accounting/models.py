import uuid
from django.db import models
from django.core.exceptions import ValidationError
from decimal import Decimal


class ChartOfAccount(models.Model):
    """
    Double-entry Chart of Accounts with parent-child hierarchy.
    Pre-seeded for bus transport; tenant can extend but not delete system accounts.
    """

    class AccountType(models.TextChoices):
        ASSET = "ASSET", "Asset"
        LIABILITY = "LIABILITY", "Liability"
        EQUITY = "EQUITY", "Equity"
        INCOME = "INCOME", "Income"
        EXPENSE = "EXPENSE", "Expense"

    class AccountNature(models.TextChoices):
        DEBIT = "DEBIT", "Debit"
        CREDIT = "CREDIT", "Credit"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=20, unique=True)          # e.g. "1110"
    name = models.CharField(max_length=255)
    account_type = models.CharField(max_length=15, choices=AccountType.choices)
    account_nature = models.CharField(
        max_length=6, choices=AccountNature.choices, default=AccountNature.DEBIT
    )
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="children",
    )
    description = models.TextField(blank=True)
    is_system = models.BooleanField(default=False)   # system accounts cannot be deleted
    is_active = models.BooleanField(default=True)
    is_group = models.BooleanField(default=False)          # True = has/can have children
    is_posting_allowed = models.BooleanField(default=True) # False for group accounts
    level_no = models.PositiveSmallIntegerField(default=1) # 1 = root
    # Denormalised balance cache (updated by signal after each posted JE line)
    balance = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]
        indexes = [
            models.Index(fields=["account_type"]),
            models.Index(fields=["code"]),
            models.Index(fields=["parent", "code"]),
        ]

    def __str__(self):
        return f"{self.code} – {self.name}"

    # ── Nature helpers ────────────────────────────────────────────────────────
    @property
    def is_debit_normal(self):
        """Assets and Expenses increase with debits."""
        return self.account_type in (self.AccountType.ASSET, self.AccountType.EXPENSE)

    # ── Auto-derive fields on every save ─────────────────────────────────────
    def save(self, *args, **kwargs):
        # 1. Account nature always mirrors account type
        debit_types = {self.AccountType.ASSET, self.AccountType.EXPENSE}
        self.account_nature = (
            self.AccountNature.DEBIT
            if self.account_type in debit_types
            else self.AccountNature.CREDIT
        )

        # 2. Compute level_no by traversing the parent chain
        if self.parent_id:
            try:
                parent_obj = type(self).objects.get(pk=self.parent_id)
                self.level_no = parent_obj.level_no + 1
            except type(self).DoesNotExist:
                self.level_no = 1
        else:
            self.level_no = 1

        # 3. Group accounts may not accept direct postings
        if self.is_group:
            self.is_posting_allowed = False

        super().save(*args, **kwargs)

        # 4. Propagate upward: parent becomes a group account automatically
        if self.parent_id:
            type(self).objects.filter(pk=self.parent_id).update(
                is_group=True, is_posting_allowed=False
            )


class JournalEntry(models.Model):
    """
    A double-entry journal entry header.  Lines must balance (sum debits == sum credits).
    """

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        POSTED = "POSTED", "Posted"
        REVERSED = "REVERSED", "Reversed"

    class SourceType(models.TextChoices):
        MANUAL = "MANUAL", "Manual Entry"
        TICKET = "TICKET", "Ticket Sale"
        FUEL = "FUEL", "Fuel Purchase"
        MAINTENANCE = "MAINTENANCE", "Maintenance / Repair"
        SALARY = "SALARY", "Salary Payment"
        DEPRECIATION = "DEPRECIATION", "Depreciation"
        PASS = "PASS", "Pass Sale"
        CHARTER = "CHARTER", "Charter / Rental"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    entry_no = models.CharField(max_length=30, unique=True)      # JE-20240101-0001
    date = models.DateField()
    description = models.TextField()
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.DRAFT
    )
    source_type = models.CharField(
        max_length=15, choices=SourceType.choices, default=SourceType.MANUAL
    )
    source_id = models.UUIDField(null=True, blank=True)          # FK UUID to originating record
    reference_no = models.CharField(max_length=100, blank=True)  # ticket UID, fuel ID, etc.
    created_by_id = models.UUIDField(null=True, blank=True)
    # Reversal tracking
    reversed_entry = models.OneToOneField(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reversal_of",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-created_at"]
        indexes = [
            models.Index(fields=["date"]),
            models.Index(fields=["status"]),
            models.Index(fields=["source_type"]),
            models.Index(fields=["entry_no"]),
        ]

    def __str__(self):
        return f"{self.entry_no} ({self.date})"

    @property
    def total_debit(self):
        return self.lines.aggregate(t=models.Sum("debit"))["t"] or Decimal("0")

    @property
    def total_credit(self):
        return self.lines.aggregate(t=models.Sum("credit"))["t"] or Decimal("0")

    def clean(self):
        if self.pk:
            td = self.total_debit
            tc = self.total_credit
            if td != tc:
                raise ValidationError(
                    f"Journal entry does not balance: debit {td} ≠ credit {tc}"
                )

    @classmethod
    def generate_entry_no(cls, date):
        date_str = date.strftime("%Y%m%d")
        prefix = f"JE-{date_str}-"
        last = (
            cls.objects.filter(entry_no__startswith=prefix)
            .order_by("-entry_no")
            .values_list("entry_no", flat=True)
            .first()
        )
        seq = int(last.split("-")[-1]) + 1 if last else 1
        return f"{prefix}{seq:04d}"


class JournalEntryLine(models.Model):
    """A single debit or credit line within a journal entry."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    journal_entry = models.ForeignKey(
        JournalEntry, on_delete=models.CASCADE, related_name="lines"
    )
    account = models.ForeignKey(
        ChartOfAccount, on_delete=models.PROTECT, related_name="journal_lines"
    )
    description = models.CharField(max_length=500, blank=True)
    debit = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0"))
    credit = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0"))
    # Optional dimension tags for route/vehicle reporting
    vehicle_id = models.UUIDField(null=True, blank=True)
    route_id = models.UUIDField(null=True, blank=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        side = f"Dr {self.debit}" if self.debit else f"Cr {self.credit}"
        return f"{self.account.code} | {side}"

    def clean(self):
        if self.debit and self.credit:
            raise ValidationError("A line cannot have both debit and credit amounts.")
        if not self.debit and not self.credit:
            raise ValidationError("A line must have either a debit or credit amount.")


class SalaryPayment(models.Model):
    """
    Tracks processed payroll runs per employee.
    Posting generates a JournalEntry automatically via signal.
    """

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PAID = "PAID", "Paid"

    class EmployeeType(models.TextChoices):
        DRIVER = "DRIVER", "Driver"
        CONDUCTOR = "CONDUCTOR", "Conductor"
        STAFF = "STAFF", "Other Staff"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee_id = models.UUIDField()
    employee_name = models.CharField(max_length=255)
    employee_type = models.CharField(max_length=10, choices=EmployeeType.choices)
    period_from = models.DateField()
    period_to = models.DateField()
    payment_date = models.DateField()
    basic_salary = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    total_allowances = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    deductions = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    net_pay = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    payment_method = models.CharField(max_length=20, default="BANK_TRANSFER")
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    journal_entry = models.OneToOneField(
        JournalEntry,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="salary_payment",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-payment_date"]
        indexes = [
            models.Index(fields=["employee_id"]),
            models.Index(fields=["status"]),
        ]

    def __str__(self):
        return f"{self.employee_name} – {self.period_from} to {self.period_to}"
