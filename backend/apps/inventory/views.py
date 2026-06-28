from rest_framework.viewsets import ModelViewSet
from rest_framework.response import Response
from django.utils import timezone
from .models import InventoryItem, StockMovement, StockAlert
from .serializers import InventoryItemSerializer, StockMovementSerializer, StockAlertSerializer
from backend.apps.users.permissions import IsMaintenanceRole


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success, "data": data, "message": message,
        "errors": errors, "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


class InventoryItemViewSet(ModelViewSet):
    queryset = InventoryItem.objects.filter(is_deleted=False)
    serializer_class = InventoryItemSerializer
    permission_classes = [IsMaintenanceRole]
    filterset_fields = ["category"]
    search_fields = ["item_code", "name"]


class StockMovementViewSet(ModelViewSet):
    queryset = StockMovement.objects.all()
    serializer_class = StockMovementSerializer
    permission_classes = [IsMaintenanceRole]
    filterset_fields = ["item", "movement_type", "date"]


class StockAlertViewSet(ModelViewSet):
    queryset = StockAlert.objects.all()
    serializer_class = StockAlertSerializer
    permission_classes = [IsMaintenanceRole]
    filterset_fields = ["resolved", "alert_type"]
