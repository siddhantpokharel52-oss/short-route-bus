from django.apps import AppConfig


class AccountingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "backend.apps.accounting"
    label = "accounting"
    verbose_name = "Accounting"

    def ready(self):
        import backend.apps.accounting.signals  # noqa: F401
