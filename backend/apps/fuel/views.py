from rest_framework.viewsets import ModelViewSet
from rest_framework.response import Response
from django.utils import timezone
from .models import FuelIssuance, MileageRecord, FuelAlert
from .serializers import FuelIssuanceSerializer, MileageRecordSerializer, FuelAlertSerializer
from backend.apps.users.permissions import IsFleetRole


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success, "data": data, "message": message,
        "errors": errors, "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


class FuelIssuanceViewSet(ModelViewSet):
    queryset = FuelIssuance.objects.all()
    serializer_class = FuelIssuanceSerializer
    permission_classes = [IsFleetRole]
    filterset_fields = ["vehicle_id", "date"]
    ordering_fields = ["date"]


class MileageRecordViewSet(ModelViewSet):
    queryset = MileageRecord.objects.all()
    serializer_class = MileageRecordSerializer
    permission_classes = [IsFleetRole]
    filterset_fields = ["vehicle_id"]


class FuelAlertViewSet(ModelViewSet):
    queryset = FuelAlert.objects.all()
    serializer_class = FuelAlertSerializer
    permission_classes = [IsFleetRole]
    filterset_fields = ["vehicle_id", "resolved", "alert_type"]
