from celery import shared_task
import logging

logger = logging.getLogger(__name__)


def _log_notification(recipient, channel, template_code, status, error="", payload=None):
    from .models import NotificationLog, NotificationTemplate
    try:
        template = NotificationTemplate.objects.get(code=template_code) if template_code else None
    except NotificationTemplate.DoesNotExist:
        template = None
    NotificationLog.objects.create(
        recipient=recipient,
        channel=channel,
        template=template,
        status=status,
        error_message=error,
        payload=payload or {},
    )


@shared_task(queue="notifications")
def send_sms_task(phone, message, template_code=None):
    """Send SMS via configured gateway."""
    from django.conf import settings
    import requests
    try:
        if not settings.SMS_API_URL or not settings.SMS_API_KEY:
            logger.warning("SMS gateway not configured.")
            _log_notification(phone, "SMS", template_code, "FAILED", "Gateway not configured")
            return
        response = requests.post(
            settings.SMS_API_URL,
            data={"token": settings.SMS_API_KEY, "to": phone, "text": message},
            timeout=10,
        )
        response.raise_for_status()
        _log_notification(phone, "SMS", template_code, "SENT")
    except Exception as e:
        logger.error(f"SMS send failed to {phone}: {e}")
        _log_notification(phone, "SMS", template_code, "FAILED", str(e))


@shared_task(queue="notifications")
def send_email_task(to_email, subject, body, template_code=None):
    """Send email notification."""
    from django.core.mail import send_mail
    from django.conf import settings
    try:
        send_mail(
            subject=subject,
            message=body,
            from_email=settings.EMAIL_HOST_USER,
            recipient_list=[to_email],
            fail_silently=False,
        )
        _log_notification(to_email, "EMAIL", template_code, "SENT")
    except Exception as e:
        logger.error(f"Email send failed to {to_email}: {e}")
        _log_notification(to_email, "EMAIL", template_code, "FAILED", str(e))


@shared_task(queue="notifications")
def send_push_task(fcm_token, title, body, data=None, template_code=None):
    """Send push notification via FCM."""
    from django.conf import settings
    import requests
    try:
        if not settings.FCM_SERVER_KEY:
            logger.warning("FCM not configured.")
            return
        headers = {
            "Authorization": f"key={settings.FCM_SERVER_KEY}",
            "Content-Type": "application/json",
        }
        payload = {
            "to": fcm_token,
            "notification": {"title": title, "body": body},
            "data": data or {},
        }
        requests.post(
            "https://fcm.googleapis.com/fcm/send",
            json=payload,
            headers=headers,
            timeout=10,
        )
        _log_notification(fcm_token, "PUSH", template_code, "SENT")
    except Exception as e:
        logger.error(f"Push send failed: {e}")
        _log_notification(fcm_token, "PUSH", template_code, "FAILED", str(e))


@shared_task(queue="emergency")
def broadcast_emergency_task(message, tenant_ids=None):
    """Broadcast emergency alert to all affected trips."""
    from channels.layers import get_channel_layer
    from asgiref.sync import async_to_sync
    channel_layer = get_channel_layer()
    group = "dispatch"
    async_to_sync(channel_layer.group_send)(
        group,
        {"type": "live_alert", "data": {"alert_type": "EMERGENCY", "message": message}},
    )


@shared_task
def send_diversion_notification(diversion_id):
    """Notify drivers and dispatchers about a route diversion."""
    logger.info(f"Diversion notification triggered for {diversion_id}")


@shared_task
def send_trip_cancellation_notification(trip_id):
    """Notify passengers about trip cancellation."""
    logger.info(f"Trip cancellation notification for {trip_id}")


@shared_task
def check_document_expiry(document_id):
    """Check if a vehicle document will expire soon and alert."""
    from backend.apps.fleet.models import VehicleDocument
    from datetime import timedelta
    from django.utils import timezone
    try:
        doc = VehicleDocument.objects.get(pk=document_id)
        days = doc.days_to_expiry
        if days <= 30:
            send_sms_task.delay(
                "admin",
                f"Vehicle {doc.vehicle.registration_no} {doc.doc_type} expires in {days} days.",
                "DOCUMENT_EXPIRY_ALERT",
            )
    except Exception as e:
        logger.error(f"Document expiry check failed: {e}")


@shared_task
def send_low_balance_alert(card_id):
    """Alert passenger about low smart card balance."""
    logger.info(f"Low balance alert for card {card_id}")
