from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet
from rest_framework.response import Response
from django.utils import timezone
from .models import NotificationTemplate, NotificationLog, NotificationSubscription
from .serializers import NotificationTemplateSerializer, NotificationLogSerializer, NotificationSubscriptionSerializer
from backend.apps.users.permissions import IsSuperAdmin, IsOperationsRole

# The 5 notification categories a staff member can toggle -- same list the
# (previously unwired) Preferences UI already showed. Kept here rather than
# on the model since NotificationSubscription.event_type is deliberately a
# free-text CharField shared with whatever event types the outbound
# SMS/email/push side eventually sends (see NotificationTemplate) -- this is
# just the subset exposed as a personal on/off switch today.
STAFF_NOTIFICATION_EVENT_TYPES = [
    "DOCUMENT_EXPIRY",
    "LOW_STOCK",
    "TRIP_CANCELLATION",
    "MAINTENANCE_REMINDER",
    "REVENUE_REPORT",
]


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success, "data": data, "message": message,
        "errors": errors, "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


class NotificationTemplateViewSet(ModelViewSet):
    queryset = NotificationTemplate.objects.all()
    serializer_class = NotificationTemplateSerializer
    permission_classes = [IsSuperAdmin]
    search_fields = ["code", "channel"]


class NotificationLogViewSet(ModelViewSet):
    queryset = NotificationLog.objects.all()
    serializer_class = NotificationLogSerializer
    permission_classes = [IsOperationsRole]
    filterset_fields = ["status", "channel"]
    http_method_names = ["get", "head", "options"]


class MyNotificationSubscriptionViewSet(ModelViewSet):
    """A staff member's own notification on/off switches -- self-service,
    any authenticated user, scoped to their own rows only. `NotificationSubscription`
    already existed (user_id/event_type/channel/is_active) but had no endpoint
    at all until now -- the Preferences page's notification checkboxes
    previously had nothing to read from or save to."""
    serializer_class = NotificationSubscriptionSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return NotificationSubscription.objects.filter(user_id=self.request.user.id)

    @action(detail=False, methods=["get"], url_path="defaults")
    def defaults(self, request):
        """Every togglable event type, defaulting to on unless the user has
        an explicit row saying otherwise -- matches the old unwired UI's
        `defaultChecked` behavior, now backed by real data."""
        existing = {s.event_type: s.is_active for s in self.get_queryset()}
        return Response({
            "success": True,
            "data": [
                {"event_type": et, "is_active": existing.get(et, True)}
                for et in STAFF_NOTIFICATION_EVENT_TYPES
            ],
            "message": "Success", "errors": None,
            "meta": {"timestamp": timezone.now().isoformat()},
        })

    @action(detail=False, methods=["post"], url_path="set")
    def set_subscription(self, request):
        event_type = request.data.get("event_type")
        if event_type not in STAFF_NOTIFICATION_EVENT_TYPES:
            return api_response(
                success=False, message="Unknown event_type.", status_code=status.HTTP_400_BAD_REQUEST,
            )
        channel = request.data.get("channel", "EMAIL")
        is_active = bool(request.data.get("is_active", True))
        obj, _ = NotificationSubscription.objects.update_or_create(
            user_id=request.user.id, event_type=event_type, channel=channel,
            defaults={"is_active": is_active},
        )
        return api_response(data=NotificationSubscriptionSerializer(obj).data)
