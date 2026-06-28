import os
from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

app = Celery("kvbms")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

app.conf.task_routes = {
    "backend.apps.notifications.tasks.send_sms_task": {"queue": "notifications"},
    "backend.apps.notifications.tasks.send_email_task": {"queue": "notifications"},
    "backend.apps.notifications.tasks.send_push_task": {"queue": "notifications"},
    "backend.apps.notifications.tasks.broadcast_emergency_task": {"queue": "emergency"},
    "backend.apps.analytics.tasks.*": {"queue": "analytics"},
}
