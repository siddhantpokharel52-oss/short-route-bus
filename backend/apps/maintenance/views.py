from rest_framework.viewsets import ModelViewSet
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from django.db.models import Sum
from .models import MaintenanceSchedule, ServiceRecord, Workshop
from .serializers import MaintenanceScheduleSerializer, ServiceRecordSerializer, WorkshopSerializer
from backend.apps.users.permissions import IsMaintenanceRole


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success, "data": data, "message": message,
        "errors": errors, "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


class MaintenanceScheduleViewSet(ModelViewSet):
    serializer_class = MaintenanceScheduleSerializer
    permission_classes = [IsMaintenanceRole]
    filterset_fields = ["vehicle_id", "status", "service_type"]
    ordering_fields = ["due_date", "status"]

    def get_queryset(self):
        # A schedule cancelled via Fleet's "mark available anyway" confirm
        # (VehicleViewSet.confirm_available) stays in the database as the
        # audit trail -- it just shouldn't clutter the active list anymore.
        return MaintenanceSchedule.objects.exclude(status=MaintenanceSchedule.Status.CANCELLED)

    def perform_create(self, serializer):
        # Scheduling a service takes the vehicle off the road for that
        # window -- surfaced on Fleet's "Available" toggle as IN_MAINTENANCE,
        # matching the existing Vehicle.Status choice (already defined,
        # never actually set anywhere before this).
        schedule = serializer.save()
        from backend.apps.fleet.models import Vehicle
        Vehicle.objects.filter(id=schedule.vehicle_id, is_deleted=False).update(
            status=Vehicle.Status.IN_MAINTENANCE
        )

    @action(detail=False, methods=["get"])
    def due(self, request):
        qs = MaintenanceSchedule.objects.filter(status__in=["DUE", "OVERDUE"]).order_by("due_date")
        serializer = self.get_serializer(qs, many=True)
        return api_response(data=serializer.data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """
        The ordinary, non-conflicting counterpart to Fleet's
        confirm-available (VehicleViewSet.confirm_available, which force-
        cancels a still-pending schedule) -- this is for when the service
        actually finished. Only reactivates the vehicle if nothing else is
        still pending for it, so completing one of two open schedules
        doesn't put a vehicle back on the road while the other is unresolved.
        """
        schedule = self.get_object()
        if schedule.status == MaintenanceSchedule.Status.COMPLETED:
            return api_response(success=False, message="Already marked complete.", status_code=400)
        if schedule.status == MaintenanceSchedule.Status.CANCELLED:
            return api_response(success=False, message="A cancelled schedule can't be completed.", status_code=400)

        schedule.status = MaintenanceSchedule.Status.COMPLETED
        schedule.save(update_fields=["status", "updated_at"])

        from backend.apps.fleet.models import Vehicle
        still_pending = MaintenanceSchedule.objects.filter(
            vehicle_id=schedule.vehicle_id,
            status__in=[
                MaintenanceSchedule.Status.UPCOMING,
                MaintenanceSchedule.Status.DUE,
                MaintenanceSchedule.Status.OVERDUE,
            ],
        ).exists()
        message = "Maintenance marked complete."
        if not still_pending:
            Vehicle.objects.filter(id=schedule.vehicle_id, is_deleted=False).update(status=Vehicle.Status.ACTIVE)
            message += " Vehicle is available again."

        return api_response(data=self.get_serializer(schedule).data, message=message)


class ServiceRecordViewSet(ModelViewSet):
    queryset = ServiceRecord.objects.all()
    serializer_class = ServiceRecordSerializer
    permission_classes = [IsMaintenanceRole]
    filterset_fields = ["vehicle_id"]
    ordering_fields = ["start_date"]

    @action(detail=False, methods=["get"], url_path="cost-summary")
    def cost_summary(self, request):
        period = request.query_params.get("period", "monthly")
        today = timezone.now().date()
        if period == "monthly":
            start = today.replace(day=1)
        else:
            from datetime import timedelta
            start = today - timedelta(days=365)
        total = ServiceRecord.objects.filter(
            start_date__gte=start
        ).aggregate(t=Sum("total_cost"))["t"] or 0
        return api_response(data={"period": period, "total_cost": str(total)})


class WorkshopViewSet(ModelViewSet):
    queryset = Workshop.objects.filter(is_active=True)
    serializer_class = WorkshopSerializer
    permission_classes = [IsMaintenanceRole]
    search_fields = ["name", "specialization"]
