import uuid
from django.db import models


class Driver(models.Model):
    class EmploymentType(models.TextChoices):
        PERMANENT = "PERMANENT", "Permanent"
        CONTRACT = "CONTRACT", "Contract"
        PART_TIME = "PART_TIME", "Part Time"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        ON_LEAVE = "ON_LEAVE", "On Leave"
        SUSPENDED = "SUSPENDED", "Suspended"
        INACTIVE = "INACTIVE", "Inactive"

    class Gender(models.TextChoices):
        MALE = "MALE", "Male"
        FEMALE = "FEMALE", "Female"
        OTHER = "OTHER", "Other"

    class Shift(models.TextChoices):
        MORNING = "MORNING", "Morning (5am–12pm)"
        DAY = "DAY", "Day (12pm–6pm)"
        EVENING = "EVENING", "Evening (6pm–10pm)"
        NIGHT = "NIGHT", "Night (10pm–5am)"

    class BloodGroup(models.TextChoices):
        A_POS = "A+", "A+"
        A_NEG = "A-", "A-"
        B_POS = "B+", "B+"
        B_NEG = "B-", "B-"
        AB_POS = "AB+", "AB+"
        AB_NEG = "AB-", "AB-"
        O_POS = "O+", "O+"
        O_NEG = "O-", "O-"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee_id = models.CharField(max_length=20, unique=True)

    # ── Personal Information ─────────────────────────────────────
    full_name_en = models.CharField(max_length=255)
    full_name_ne = models.CharField(max_length=255, blank=True)
    gender = models.CharField(max_length=10, choices=Gender.choices, default=Gender.MALE)
    dob = models.DateField()
    citizenship_no = models.CharField(max_length=50)
    phone = models.CharField(max_length=20)
    address = models.TextField()
    emergency_contact_name = models.CharField(max_length=255, blank=True)
    emergency_contact_number = models.CharField(max_length=20, blank=True)
    photo = models.ImageField(upload_to="driver_photos/", null=True, blank=True)

    # ── License Information ──────────────────────────────────────
    license_no = models.CharField(max_length=50, unique=True)
    license_category = models.CharField(max_length=10)
    license_issue_date = models.DateField(null=True, blank=True)
    license_expiry = models.DateField()
    license_issuing_authority = models.CharField(max_length=255, blank=True)

    # ── Employment Information ───────────────────────────────────
    employment_type = models.CharField(max_length=15, choices=EmploymentType.choices, default=EmploymentType.PERMANENT)
    date_of_joining = models.DateField(null=True, blank=True)
    experience_years = models.PositiveSmallIntegerField(default=0)
    previous_employer = models.CharField(max_length=255, blank=True)
    shift = models.CharField(max_length=10, choices=Shift.choices, blank=True)
    # UUID cross-references (no FK across schemas)
    route_id = models.UUIDField(null=True, blank=True)
    bus_id = models.UUIDField(null=True, blank=True)

    # ── Medical Information ──────────────────────────────────────
    blood_group = models.CharField(max_length=5, choices=BloodGroup.choices, blank=True)
    medical_conditions = models.TextField(blank=True)
    last_medical_checkup_date = models.DateField(null=True, blank=True)

    # ── Salary & Wages ───────────────────────────────────────────
    basic_salary = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    allowances = models.JSONField(default=list, blank=True)
    # allowances format: [{"title": "Transport", "amount": 2000}, ...]

    # ── System fields ────────────────────────────────────────────
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.ACTIVE)
    user_id = models.UUIDField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["employee_id"]
        indexes = [
            models.Index(fields=["employee_id"]),
            models.Index(fields=["license_no"]),
            models.Index(fields=["status"]),
            models.Index(fields=["license_expiry"]),
        ]

    def __str__(self):
        return f"{self.employee_id} - {self.full_name_en}"


class DriverTraining(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    driver = models.ForeignKey(Driver, on_delete=models.CASCADE, related_name="trainings")
    training_name = models.CharField(max_length=255)
    provider = models.CharField(max_length=255)
    date = models.DateField()
    score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    certificate = models.FileField(upload_to="training_certs/", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]


class DriverMedical(models.Model):
    class Result(models.TextChoices):
        FIT = "FIT", "Fit"
        UNFIT = "UNFIT", "Unfit"
        CONDITIONAL = "CONDITIONAL", "Conditionally Fit"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    driver = models.ForeignKey(Driver, on_delete=models.CASCADE, related_name="medicals")
    examination_date = models.DateField()
    doctor = models.CharField(max_length=255)
    result = models.CharField(max_length=15, choices=Result.choices)
    valid_until = models.DateField()
    remarks = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-examination_date"]


class DriverAttendance(models.Model):
    class AttendanceStatus(models.TextChoices):
        PRESENT = "PRESENT", "Present"
        ABSENT = "ABSENT", "Absent"
        LATE = "LATE", "Late"
        HALF_DAY = "HALF_DAY", "Half Day"
        ON_LEAVE = "ON_LEAVE", "On Leave"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    driver = models.ForeignKey(Driver, on_delete=models.CASCADE, related_name="attendances")
    date = models.DateField()
    check_in = models.DateTimeField(null=True, blank=True)
    check_out = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=AttendanceStatus.choices, default=AttendanceStatus.PRESENT)

    class Meta:
        unique_together = [["driver", "date"]]
        indexes = [models.Index(fields=["driver", "date"])]


class DriverViolation(models.Model):
    class Severity(models.TextChoices):
        LOW = "LOW", "Low"
        MEDIUM = "MEDIUM", "Medium"
        HIGH = "HIGH", "High"
        CRITICAL = "CRITICAL", "Critical"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    driver = models.ForeignKey(Driver, on_delete=models.CASCADE, related_name="violations")
    violation_type = models.CharField(max_length=100)
    date = models.DateField()
    description = models.TextField()
    action_taken = models.TextField(blank=True)
    severity = models.CharField(max_length=10, choices=Severity.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]


class DriverPerformance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    driver = models.ForeignKey(Driver, on_delete=models.CASCADE, related_name="performance_records")
    month = models.DateField(help_text="First day of the month")
    trips_completed = models.PositiveIntegerField(default=0)
    on_time_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    complaints_received = models.PositiveSmallIntegerField(default=0)
    safety_score = models.DecimalField(max_digits=5, decimal_places=2, default=100)

    class Meta:
        unique_together = [["driver", "month"]]
        ordering = ["-month"]


class Conductor(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        INACTIVE = "INACTIVE", "Inactive"
        SUSPENDED = "SUSPENDED", "Suspended"

    class Gender(models.TextChoices):
        MALE = "MALE", "Male"
        FEMALE = "FEMALE", "Female"
        OTHER = "OTHER", "Other"

    class EmploymentType(models.TextChoices):
        PERMANENT = "PERMANENT", "Permanent"
        CONTRACT = "CONTRACT", "Contract"
        PART_TIME = "PART_TIME", "Part Time"

    class Shift(models.TextChoices):
        MORNING = "MORNING", "Morning (5am–12pm)"
        DAY = "DAY", "Day (12pm–6pm)"
        EVENING = "EVENING", "Evening (6pm–10pm)"
        NIGHT = "NIGHT", "Night (10pm–5am)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee_id = models.CharField(max_length=20, unique=True)

    # Personal
    full_name_en = models.CharField(max_length=255)
    full_name_ne = models.CharField(max_length=255, blank=True)
    gender = models.CharField(max_length=10, choices=Gender.choices, blank=True)
    dob = models.DateField(null=True, blank=True)
    citizenship_no = models.CharField(max_length=50)
    phone = models.CharField(max_length=20)
    address = models.TextField(blank=True)
    emergency_contact_name = models.CharField(max_length=255, blank=True)
    emergency_contact_number = models.CharField(max_length=20, blank=True)
    blood_group = models.CharField(max_length=5, blank=True)
    photo = models.ImageField(upload_to="conductor_photos/", null=True, blank=True)

    # Employment
    employment_type = models.CharField(max_length=15, choices=EmploymentType.choices, default=EmploymentType.PERMANENT)
    date_of_joining = models.DateField(null=True, blank=True)
    shift = models.CharField(max_length=10, choices=Shift.choices, blank=True)

    # Assignment
    assigned_vehicle_id = models.UUIDField(null=True, blank=True)
    assigned_route_id = models.UUIDField(null=True, blank=True)

    # ── Salary & Wages ───────────────────────────────────────────
    basic_salary = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    allowances = models.JSONField(default=list, blank=True)
    # allowances format: [{"title": "Transport", "amount": 2000}, ...]

    status = models.CharField(max_length=15, choices=Status.choices, default=Status.ACTIVE)
    user_id = models.UUIDField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["employee_id"]
        indexes = [models.Index(fields=["employee_id"]), models.Index(fields=["status"])]

    def __str__(self):
        return f"{self.employee_id} - {self.full_name_en}"


class ConductorAttendance(models.Model):
    class AttendanceStatus(models.TextChoices):
        PRESENT = "PRESENT", "Present"
        ABSENT = "ABSENT", "Absent"
        ON_LEAVE = "ON_LEAVE", "On Leave"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conductor = models.ForeignKey(Conductor, on_delete=models.CASCADE, related_name="attendances")
    date = models.DateField()
    check_in = models.DateTimeField(null=True, blank=True)
    check_out = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=AttendanceStatus.choices, default=AttendanceStatus.PRESENT)

    class Meta:
        unique_together = [["conductor", "date"]]


class TicketCollection(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conductor = models.ForeignKey(Conductor, on_delete=models.CASCADE, related_name="collections")
    trip_id = models.UUIDField()
    total_tickets = models.PositiveIntegerField(default=0)
    cash_collected = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    card_collected = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    submitted_at = models.DateTimeField(auto_now_add=True)
    verified_by_id = models.UUIDField(null=True, blank=True)
    is_verified = models.BooleanField(default=False)

    class Meta:
        ordering = ["-submitted_at"]
        indexes = [models.Index(fields=["conductor", "trip_id"])]


class BusCompany(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company_name = models.CharField(max_length=255)
    registration_no = models.CharField(max_length=100)
    address = models.TextField()
    contact_phone = models.CharField(max_length=20)
    contact_email = models.EmailField(blank=True)
    logo = models.ImageField(upload_to="company_logos/", null=True, blank=True)
    tax_pan = models.CharField(max_length=20, blank=True)
    established_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "Bus Companies"

    def __str__(self):
        return self.company_name


class CompanyLicense(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(BusCompany, on_delete=models.CASCADE, related_name="licenses")
    license_type = models.CharField(max_length=100)
    license_no = models.CharField(max_length=100)
    issued_date = models.DateField()
    expiry_date = models.DateField()
    issuing_authority = models.CharField(max_length=255)
    document = models.FileField(upload_to="company_licenses/", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-expiry_date"]
        indexes = [models.Index(fields=["company", "expiry_date"])]
