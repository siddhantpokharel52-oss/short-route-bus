"""Test settings — fast, in-memory databases where possible."""
from .base import *  # noqa

# Use a separate test database
DATABASES = {
    "default": {
        "ENGINE": "django_tenants.postgresql_backend",
        "NAME": os.environ.get("TEST_DB_NAME", "kvbms_test"),
        "USER": os.environ.get("DB_USER", "kvbms"),
        "PASSWORD": os.environ.get("DB_PASSWORD", "kvbms"),
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5432"),
        "TEST": {
            "NAME": "test_kvbms",
        },
    }
}

# Speed up password hashing in tests
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# Disable Celery tasks in tests
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True

# Use in-memory channel layers
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    }
}

# Disable email sending
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

# Use local file storage for tests
DEFAULT_FILE_STORAGE = "django.core.files.storage.FileSystemStorage"
MEDIA_ROOT = "/tmp/kvbms_test_media"

# Disable Sentry
SENTRY_DSN = ""

# Fast JWT for tests
SIMPLE_JWT = {
    **SIMPLE_JWT,
    "ACCESS_TOKEN_LIFETIME": __import__("datetime").timedelta(hours=1),
    "REFRESH_TOKEN_LIFETIME": __import__("datetime").timedelta(days=1),
}

# Logging — minimal during tests
LOGGING = {
    "version": 1,
    "disable_existing_loggers": True,
    "handlers": {"null": {"class": "logging.NullHandler"}},
    "root": {"handlers": ["null"]},
}
