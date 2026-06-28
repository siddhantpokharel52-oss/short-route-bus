from rest_framework import generics, status, views
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet
from django.utils import timezone
from datetime import timedelta
from .models import Vehicle, VehicleDocument, VehicleInsurance, VehicleGPS
from .serializers import (
    VehicleSerializer, VehicleDocumentSerializer,
    VehicleInsuranceSerializer, VehicleGPSSerializer, VehicleExpiryAlertSerializer,
)
from backend.apps.users.permissions import IsFleetRole, IsOperationsRole


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success,
        "data": data,
        "message": message,
        "errors": errors,
        "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


class VehicleViewSet(ModelViewSet):
    serializer_class = VehicleSerializer
    permission_classes = [IsFleetRole]
    filterset_fields = ["status", "fuel_type", "make"]
    search_fields = ["registration_no", "make", "model", "chassis_no"]
    ordering_fields = ["registration_no", "make", "created_at", "status"]

    def get_queryset(self):
        return Vehicle.objects.filter(is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(created_by_id=self.request.user.id)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return api_response(data=serializer.data, message="Vehicle updated successfully.")

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["is_deleted", "deleted_at"])

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        vehicle = self.get_object()
        docs = VehicleDocumentSerializer(vehicle.documents.filter(is_deleted=False), many=True)
        return api_response(data={"documents": docs.data})

    @action(detail=False, methods=["get"], url_path="expiry-alerts")
    def expiry_alerts(self, request):
        days = int(request.query_params.get("days", 30))
        cutoff = timezone.now().date() + timedelta(days=days)
        expiring = VehicleDocument.objects.filter(
            is_deleted=False,
            expiry_date__lte=cutoff,
            expiry_date__gte=timezone.now().date(),
        ).select_related("vehicle").order_by("expiry_date")
        serializer = VehicleExpiryAlertSerializer(expiring, many=True)
        return api_response(
            data=serializer.data,
            message=f"Documents expiring within {days} days.",
        )


class VehicleDocumentViewSet(ModelViewSet):
    serializer_class = VehicleDocumentSerializer
    permission_classes = [IsFleetRole]

    def get_queryset(self):
        return VehicleDocument.objects.filter(
            vehicle_id=self.kwargs["vehicle_pk"],
            is_deleted=False,
        )

    def perform_create(self, serializer):
        vehicle = Vehicle.objects.get(pk=self.kwargs["vehicle_pk"])
        serializer.save(vehicle=vehicle)
        # Schedule expiry alert check
        from backend.apps.notifications.tasks import check_document_expiry
        check_document_expiry.delay(str(serializer.instance.id))
