from rest_framework.viewsets import ModelViewSet
from rest_framework.response import Response
from django.utils import timezone
from .models import NotificationTemplate, NotificationLog, NotificationSubscription
from .serializers import NotificationTemplateSerializer, NotificationLogSerializer, NotificationSubscriptionSerializer
from backend.apps.users.permissions import IsSuperAdmin, IsOperationsRole


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
