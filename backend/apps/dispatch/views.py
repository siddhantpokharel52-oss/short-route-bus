import math
import json
from rest_framework.viewsets import ModelViewSet
from rest_framework import views, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone
from django.conf import settings
from .models import DailyAllocation, DispatchLog
from .serializers import DailyAllocationSerializer, DispatchLogSerializer
from backend.apps.users.permissions import IsOperationsRole


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success,
        "data": data,
        "message": message,
        "errors": errors,
        "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


def haversine(lat1, lon1, lat2, lon2):
    """Distance between two GPS coordinates in meters."""
    R = 6371000
    phi1, phi2 = math.radians(float(lat1)), math.radians(float(lat2))
    dphi = math.radians(float(lat2) - float(lat1))
    dlambda = math.radians(float(lon2) - float(lon1))
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def get_redis_client():
    import redis
    redis_url = getattr(settings, "REDIS_URL", "redis://redis:6379/0")
    return redis.Redis.from_url(redis_url, decode_responses=True)


class DailyAllocationViewSet(ModelViewSet):
    serializer_class = DailyAllocationSerializer
    permission_classes = [IsOperationsRole]
    filterset_fields = ["date", "route_id", "status", "vehicle_id"]
    ordering_fields = ["date", "shift_start", "status"]

    def get_queryset(self):
        return DailyAllocation.objects.all()

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from backend.apps.fleet.models import Vehicle
        vehicle_id = request.data.get("vehicle_id")
        route_id = request.data.get("route_id")

        # Update vehicle status to ASSIGNED
        if vehicle_id:
            Vehicle.objects.filter(pk=vehicle_id).update(
                status="ASSIGNED",
                assigned_route_id=route_id,
            )

        allocation = serializer.save(
            created_by_id=request.user.id if request.user else None
        )

        # Audit log
        DispatchLog.objects.create(
            allocation=allocation,
            action_type=DispatchLog.ActionType.ASSIGN,
            vehicle_id=allocation.vehicle_id,
            route_id=allocation.route_id,
            performed_by_id=request.user.id if request.user else None,
            notes=f"Bus assigned to route for {allocation.date}",
        )

        return api_response(
            data=DailyAllocationSerializer(allocation).data,
            message="Bus assigned to route successfully.",
            status_code=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        """PATCH / PUT — edit allocation + audit log + vehicle status sync."""
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)

        old_vehicle_id = str(instance.vehicle_id)
        new_vehicle_id = str(request.data.get("vehicle_id", old_vehicle_id))

        allocation = serializer.save()

        # If vehicle changed, release old → assign new
        if old_vehicle_id != new_vehicle_id:
            from backend.apps.fleet.models import Vehicle
            Vehicle.objects.filter(pk=old_vehicle_id).update(status="ACTIVE", assigned_route_id=None)
            Vehicle.objects.filter(pk=new_vehicle_id).update(
                status="ASSIGNED", assigned_route_id=allocation.route_id
            )

        DispatchLog.objects.create(
            allocation=allocation,
            action_type=DispatchLog.ActionType.STATUS_UPDATE,
            vehicle_id=allocation.vehicle_id,
            route_id=allocation.route_id,
            performed_by_id=request.user.id if request.user else None,
            notes=f"Allocation updated for {allocation.date}",
        )
        return api_response(
            data=DailyAllocationSerializer(allocation).data,
            message="Allocation updated successfully.",
        )

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        """DELETE — remove allocation, free the vehicle, log the action."""
        instance = self.get_object()

        from backend.apps.fleet.models import Vehicle
        Vehicle.objects.filter(pk=instance.vehicle_id).update(
            status="ACTIVE", assigned_route_id=None
        )

        DispatchLog.objects.create(
            action_type=DispatchLog.ActionType.REMOVE,
            vehicle_id=instance.vehicle_id,
            route_id=instance.route_id,
            performed_by_id=request.user.id if request.user else None,
            notes=f"Allocation deleted for {instance.date} (vehicle {instance.vehicle_id})",
        )

        instance.delete()
        return api_response(message="Allocation deleted successfully.")

    @action(detail=False, methods=["get"])
    def today(self, request):
        today = timezone.now().date()
        qs = DailyAllocation.objects.filter(date=today).order_by("shift_start")
        return api_response(
            data=self.get_serializer(qs, many=True).data,
            message=f"Today's allocations ({today})",
        )

    @action(detail=True, methods=["post"])
    def breakdown(self, request, pk=None):
        """Mark a bus as broken down and cancel its allocation."""
        allocation = self.get_object()
        reason = request.data.get("reason", "Bus breakdown")

        from backend.apps.fleet.models import Vehicle
        Vehicle.objects.filter(pk=allocation.vehicle_id).update(status="BREAKDOWN")

        allocation.status = DailyAllocation.Status.CANCELLED
        allocation.notes = f"BREAKDOWN: {reason}"
        allocation.save(update_fields=["status", "notes", "updated_at"])

        DispatchLog.objects.create(
            allocation=allocation,
            action_type=DispatchLog.ActionType.BREAKDOWN,
            vehicle_id=allocation.vehicle_id,
            route_id=allocation.route_id,
            performed_by_id=request.user.id if request.user else None,
            notes=reason,
        )
        return api_response(message="Bus marked as breakdown. Assign a replacement bus.")

    @action(detail=True, methods=["post"])
    def reassign(self, request, pk=None):
        """Assign a replacement bus for a broken/cancelled allocation."""
        old_allocation = self.get_object()
        new_vehicle_id = request.data.get("replacement_vehicle_id")
        if not new_vehicle_id:
            return api_response(
                success=False,
                message="replacement_vehicle_id is required.",
                status_code=400,
            )

        from backend.apps.fleet.models import Vehicle

        # Check for existing allocation conflict
        if DailyAllocation.objects.filter(
            date=old_allocation.date,
            vehicle_id=new_vehicle_id,
            status__in=[DailyAllocation.Status.PENDING, DailyAllocation.Status.ACTIVE],
        ).exists():
            return api_response(
                success=False,
                message="This vehicle is already allocated to another route today.",
                status_code=400,
            )

        new_alloc = DailyAllocation.objects.create(
            date=old_allocation.date,
            route_id=old_allocation.route_id,
            vehicle_id=new_vehicle_id,
            driver_id=request.data.get("driver_id") or old_allocation.driver_id,
            conductor_id=old_allocation.conductor_id,
            shift_start=old_allocation.shift_start,
            shift_end=old_allocation.shift_end,
            status=DailyAllocation.Status.ACTIVE,
            notes=f"Replacement for breakdown vehicle {old_allocation.vehicle_id}",
            created_by_id=request.user.id if request.user else None,
        )

        Vehicle.objects.filter(pk=new_vehicle_id).update(
            status="ASSIGNED",
            assigned_route_id=old_allocation.route_id,
        )

        DispatchLog.objects.create(
            allocation=new_alloc,
            action_type=DispatchLog.ActionType.REASSIGN,
            vehicle_id=new_vehicle_id,
            route_id=old_allocation.route_id,
            performed_by_id=request.user.id if request.user else None,
            notes=f"Replacing vehicle {old_allocation.vehicle_id}",
            metadata={"replaced_allocation_id": str(old_allocation.id)},
        )

        return api_response(
            data=DailyAllocationSerializer(new_alloc).data,
            message="Replacement bus assigned successfully.",
        )

    @action(detail=True, methods=["post"])
    def remove(self, request, pk=None):
        """Remove a bus from its route assignment."""
        allocation = self.get_object()
        reason = request.data.get("reason", "Removed from route")

        from backend.apps.fleet.models import Vehicle
        Vehicle.objects.filter(pk=allocation.vehicle_id).update(
            status="ACTIVE",
            assigned_route_id=None,
        )

        allocation.status = DailyAllocation.Status.CANCELLED
        allocation.notes = reason
        allocation.save(update_fields=["status", "notes", "updated_at"])

        DispatchLog.objects.create(
            allocation=allocation,
            action_type=DispatchLog.ActionType.REMOVE,
            vehicle_id=allocation.vehicle_id,
            route_id=allocation.route_id,
            performed_by_id=request.user.id if request.user else None,
            notes=reason,
        )
        return api_response(message="Bus removed from route.")


class DispatchLogListView(views.APIView):
    permission_classes = [IsOperationsRole]

    def get(self, request):
        date_filter = request.query_params.get("date")
        qs = DispatchLog.objects.select_related("allocation").all()
        if date_filter:
            qs = qs.filter(timestamp__date=date_filter)
        serializer = DispatchLogSerializer(qs[:100], many=True)
        return api_response(data=serializer.data, message="Dispatch logs")


class GenerateScheduleView(views.APIView):
    """
    Generate a full daily trip schedule for a route.
    Takes vehicle assignments and operating hours, creates staggered trips.
    """
    permission_classes = [IsOperationsRole]

    def post(self, request):
        import datetime

        route_id = request.data.get("route_id")
        date_str = request.data.get("date", str(timezone.now().date()))
        vehicle_ids = request.data.get("vehicle_ids", [])
        operating_start = request.data.get("operating_start", "05:00")
        operating_end = request.data.get("operating_end", "21:00")
        headway_minutes = int(request.data.get("headway_minutes", 15))
        trip_duration_minutes = int(request.data.get("trip_duration_minutes", 45))
        layover_minutes = int(request.data.get("layover_minutes", 10))

        if not route_id:
            return api_response(success=False, message="route_id is required.", status_code=400)
        if not vehicle_ids:
            return api_response(success=False, message="At least one vehicle_id is required.", status_code=400)

        from backend.apps.scheduling.models import Trip
        from backend.apps.fleet.models import Vehicle

        target_date = datetime.date.fromisoformat(date_str)
        start_h, start_m = map(int, operating_start.split(":"))
        end_h, end_m = map(int, operating_end.split(":"))
        start_total = start_h * 60 + start_m
        end_total = end_h * 60 + end_m
        trip_cycle = trip_duration_minutes + layover_minutes

        created_trips = []
        allocations_created = []

        for idx, vehicle_id in enumerate(vehicle_ids):
            # Update vehicle to ASSIGNED
            Vehicle.objects.filter(pk=vehicle_id).update(
                status="ASSIGNED",
                assigned_route_id=route_id,
            )

            # Create/update DailyAllocation for this vehicle
            alloc, created = DailyAllocation.objects.update_or_create(
                date=target_date,
                vehicle_id=vehicle_id,
                defaults={
                    "route_id": route_id,
                    "shift_start": f"{start_h:02d}:{start_m:02d}",
                    "shift_end": f"{end_h:02d}:{end_m:02d}",
                    "status": DailyAllocation.Status.ACTIVE,
                    "created_by_id": request.user.id if request.user else None,
                },
            )
            if created:
                allocations_created.append(str(alloc.id))

            # Stagger bus start: Bus 1 starts at operating_start,
            # Bus 2 starts headway_minutes later, etc.
            bus_departure = start_total + (idx * headway_minutes)

            # Generate round trips for this bus throughout the day
            while bus_departure + trip_duration_minutes <= end_total:
                dep_h = bus_departure // 60
                dep_m = bus_departure % 60
                arr_total = bus_departure + trip_duration_minutes
                arr_h = arr_total // 60
                arr_m = arr_total % 60

                # Unique trip code
                trip_code = (
                    f"{route_id[:8].upper()}-"
                    f"{date_str}-"
                    f"{dep_h:02d}{dep_m:02d}-"
                    f"{str(vehicle_id)[:4].upper()}"
                )

                if not Trip.objects.filter(trip_code=trip_code).exists():
                    trip = Trip.objects.create(
                        trip_code=trip_code,
                        vehicle_id=vehicle_id,
                        driver_id=alloc.driver_id or vehicle_id,
                        conductor_id=alloc.conductor_id,
                        route_id=route_id,
                        date=target_date,
                        status=Trip.Status.SCHEDULED,
                        scheduled_departure_time=datetime.time(dep_h, dep_m),
                        scheduled_arrival_time=datetime.time(arr_h % 24, arr_m),
                        timetable_slot=None,
                    )
                    created_trips.append({
                        "trip_id": str(trip.id),
                        "trip_code": trip_code,
                        "vehicle_id": str(vehicle_id),
                        "scheduled_departure": f"{dep_h:02d}:{dep_m:02d}",
                        "scheduled_arrival": f"{arr_h % 24:02d}:{arr_m:02d}",
                    })

                bus_departure += trip_cycle

        # Log the generation event
        DispatchLog.objects.create(
            action_type=DispatchLog.ActionType.GENERATE_SCHEDULE,
            route_id=route_id,
            performed_by_id=request.user.id if request.user else None,
            notes=f"Generated {len(created_trips)} trips for {date_str}",
            metadata={
                "vehicle_count": len(vehicle_ids),
                "trips_created": len(created_trips),
                "operating_hours": f"{operating_start}–{operating_end}",
                "headway_minutes": headway_minutes,
            },
        )

        return api_response(
            data={
                "trips_created": len(created_trips),
                "allocations_created": len(allocations_created),
                "trips": created_trips,
            },
            message=f"Schedule generated: {len(created_trips)} trips for {date_str}",
            status_code=status.HTTP_201_CREATED,
        )
