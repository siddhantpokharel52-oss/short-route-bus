import uuid
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin, BaseUserManager
from django.db import models
from django.utils import timezone


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("Email is required")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", User.Role.SUPER_ADMIN)
        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    class Role(models.TextChoices):
        # Platform roles
        SUPER_ADMIN = "SUPER_ADMIN", "Super Admin"
        TRANSPORT_AUTHORITY_OFFICER = "TRANSPORT_AUTHORITY_OFFICER", "Transport Authority Officer"
        REVENUE_AUDITOR = "REVENUE_AUDITOR", "Revenue Auditor"
        COMPLIANCE_OFFICER = "COMPLIANCE_OFFICER", "Compliance Officer"
        PLATFORM_SUPPORT = "PLATFORM_SUPPORT", "Platform Support"
        # Tenant roles
        COMPANY_ADMIN = "COMPANY_ADMIN", "Company Admin"
        OPERATIONS_MANAGER = "OPERATIONS_MANAGER", "Operations Manager"
        DISPATCHER = "DISPATCHER", "Dispatcher"
        FLEET_MANAGER = "FLEET_MANAGER", "Fleet Manager"
        MAINTENANCE_MANAGER = "MAINTENANCE_MANAGER", "Maintenance Manager"
        FINANCE_OFFICER = "FINANCE_OFFICER", "Finance Officer"
        HR_OFFICER = "HR_OFFICER", "HR Officer"
        STATION_MANAGER = "STATION_MANAGER", "Station Manager"
        # Operational roles
        DRIVER = "DRIVER", "Driver"
        CONDUCTOR = "CONDUCTOR", "Conductor"
        INSPECTOR = "INSPECTOR", "Inspector"
        # Public
        PASSENGER = "PASSENGER", "Passenger"
        STUDENT = "STUDENT", "Student"
        TOURIST = "TOURIST", "Tourist"

    class Language(models.TextChoices):
        ENGLISH = "en", "English"
        NEPALI = "ne", "Nepali"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    full_name_en = models.CharField(max_length=255)
    full_name_ne = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    role = models.CharField(max_length=50, choices=Role.choices, default=Role.PASSENGER)
    language_preference = models.CharField(max_length=2, choices=Language.choices, default=Language.ENGLISH)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    is_2fa_enabled = models.BooleanField(default=False)
    failed_login_attempts = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    tenant_schema = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["full_name_en"]

    objects = UserManager()

    class Meta:
        indexes = [
            models.Index(fields=["email"]),
            models.Index(fields=["role"]),
            models.Index(fields=["tenant_schema"]),
        ]

    def __str__(self):
        return f"{self.email} ({self.role})"

    @property
    def is_platform_role(self):
        platform_roles = {
            self.Role.SUPER_ADMIN,
            self.Role.TRANSPORT_AUTHORITY_OFFICER,
            self.Role.REVENUE_AUDITOR,
            self.Role.COMPLIANCE_OFFICER,
            self.Role.PLATFORM_SUPPORT,
        }
        return self.role in platform_roles

    def increment_failed_login(self):
        from django.conf import settings
        self.failed_login_attempts += 1
        if self.failed_login_attempts >= settings.MAX_LOGIN_ATTEMPTS:
            self.locked_until = timezone.now() + timezone.timedelta(
                minutes=settings.LOGIN_LOCKOUT_DURATION_MINUTES
            )
        self.save(update_fields=["failed_login_attempts", "locked_until"])

    def reset_failed_login(self):
        self.failed_login_attempts = 0
        self.locked_until = None
        self.save(update_fields=["failed_login_attempts", "locked_until"])

    @property
    def is_locked(self):
        if self.locked_until and timezone.now() < self.locked_until:
            return True
        return False
