from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://kvbms_user:kvbms_password@db:5432/kvbms"
    REDIS_URL: str = "redis://redis:6379/0"
    JWT_SECRET_KEY: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    GPS_DEVIATION_THRESHOLD_M: float = 200.0
    SPEED_ALERT_THRESHOLD_KMH: float = 60.0
    DELAY_ALERT_THRESHOLD_MINUTES: int = 10
    FUEL_MILEAGE_DEVIATION_THRESHOLD: float = 0.20
    PUBLIC_API_RATE_LIMIT: int = 100
    # Internal (docker-network) address of the Django service, used only to proxy
    # ticket creation/validation through the real Django views (see public_api/router.py)
    # so their existing business logic is reused rather than reimplemented here.
    DJANGO_INTERNAL_BASE_URL: str = "http://django:8000"
    # django-tenants resolves which schema/urlconf to use purely from the
    # request's Host header -- it has no idea "django:8000" (the docker
    # network hostname baked into DJANGO_INTERNAL_BASE_URL above) means
    # anything. Every other internal call to Django (see _proxy_to_django in
    # public_api/router.py) is tenant-scoped and already sets its own
    # Host header to the right tenant's real domain; this one is for the
    # public-schema-only apps.users.PartnerProvisionView, so it needs the
    # public schema's own registered domain instead. Same value as Django's
    # TENANT_BASE_DOMAIN setting, which is exactly this.
    DJANGO_PUBLIC_DOMAIN: str = "citybus.com.np"

    # Federated login (see partner_api/router.py) — token-exchange for Yatroo.
    # Yatroo-specific by design, not a generic multi-partner system — see
    # that module's docstring for why.
    YATROO_HMAC_SECRET: str = "change-me-in-production"
    # Same value as Django's settings.INTERNAL_SERVICE_KEY — proves the
    # partner-provision call actually came from this service, not an external
    # caller who found the URL. Two copies of one shared secret, not two
    # different secrets.
    INTERNAL_SERVICE_KEY: str = "change-me-in-production"
    FEDERATED_LOGIN_TOKEN_EXPIRY_SECONDS: int = 3600
    FEDERATED_LOGIN_TIMESTAMP_WINDOW_SECONDS: int = 120
    FEDERATED_LOGIN_NONCE_TTL_SECONDS: int = 300

    class Config:
        env_file = ".env"


settings = Settings()
