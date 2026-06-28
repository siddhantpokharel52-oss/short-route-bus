import math
import json
from rest_framework import generics, status, views
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet
from rest_framework.permissions import IsAuthenticated, AllowAny
from django.utils import timezone
from django.conf import settings
from .models import Timetable, Trip, DriverShift, AutoScheduleConfig
from .serializers import (
    TimetableSerializer, TripSerializer, DriverShiftSerializer,
    AutoScheduleConfigSerializer,
)
from backend.apps.users.permissions import IsOperationsRole, IsFleetRole


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success,
        "data": data,
        "message": message,
        "errors": errors,
        "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


def haversine(lat1, lon1, lat2, lon2):
    """Great-circle distance in meters."""
    R = 6371000
    phi1, phi2 = math.radians(float(lat1)), math.radians(float(lat2))
    dphi = math.radians(float(lat2) - float(lat1))
    dlambda = math.radians(float(lon2) - float(lon1))
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def get_redis():
    import redis as redis_lib
    redis_url = getattr(settings, "REDIS_URL", "redis://redis:6379/0")
    return redis_lib.Redis.from_url(redis_url, decode_responses=True)


class TimetableViewSet(ModelViewSet):
    queryset = Timetable.objects.filter(is_active=True)
    serializer_class = TimetableSerializer
    permission_classes = [IsOperationsRole]
    filterset_fields = ["route_id", "day_type"]
    ordering_fields = ["effective_date", "created_at"]


class TripViewSet(ModelViewSet):
    serializer_class = TripSerializer
    permission_classes = [IsOperationsRole]
    filterset_fields = ["status", "route_id", "date"]
    search_fields = ["trip_code"]
    ordering_fields = ["date", "trip_code", "status"]

    def get_queryset(self):
        return Trip.objects.filter(is_deleted=False)

    def create(self, request, *args, **kwargs):
        from backend.apps.fleet.models import Vehicle
        vehicle_id = request.data.get("vehicle_id")
        if vehicle_id:
            try:
                vehicle = Vehicle.objects.get(pk=vehicle_id, is_deleted=False)
                if not vehicle.is_available_for_trip:
                    return api_response(
                        success=False,
                        message="Vehicle is not available — expired documents or under maintenance.",
                        errors={"vehicle_id": ["Vehicle is unavailable."]},
                        status_code=status.HTTP_400_BAD_REQUEST,
                    )
            except Vehicle.DoesNotExist:
                pass

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        trip = serializer.save()
        return api_response(
            data=TripSerializer(trip).data,
            message="Trip created successfully.",
            status_code=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["get"])
    def today(self, request):
        today = timezone.now().date()
        trips = Trip.objects.filter(date=today, is_deleted=False).order_by("trip_code")
        return api_response(data=self.get_serializer(trips, many=True).data, message=f"Today's trips ({today})")

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        trip = self.get_object()
        if trip.status not in (Trip.Status.SCHEDULED, Trip.Status.DELAYED):
            return api_response(
                success=False,
                message=f"Cannot start a trip in '{trip.status}' state.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        trip.status = Trip.Status.IN_PROGRESS
        trip.actual_departure = timezone.now()
        # Clear delay fields when trip actually departs
        trip.delay_reason = ""
        trip.delay_minutes = None
        trip.save(update_fields=["status", "actual_departure", "delay_reason", "delay_minutes", "updated_at"])

        # Update vehicle to IN_SERVICE
        try:
            from backend.apps.fleet.models import Vehicle
            Vehicle.objects.filter(pk=trip.vehicle_id).update(status="IN_SERVICE")
        except Exception:
            pass

        return api_response(data=TripSerializer(trip).data, message=f"Trip {trip.trip_code} started.")

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        trip = self.get_object()
        if trip.status != Trip.Status.IN_PROGRESS:
            return api_response(
                success=False, message="Trip is not in progress.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        trip.status = Trip.Status.COMPLETED
        trip.actual_arrival = timezone.now()
        trip.save(update_fields=["status", "actual_arrival", "updated_at"])

        # Return vehicle to ASSIGNED (ready for next trip)
        try:
            from backend.apps.fleet.models import Vehicle
            Vehicle.objects.filter(pk=trip.vehicle_id).update(status="ASSIGNED")
        except Exception:
            pass

        return api_response(data=TripSerializer(trip).data, message=f"Trip {trip.trip_code} completed.")

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        trip = self.get_object()
        reason = request.data.get("reason", "")
        if not reason:
            return api_response(
                success=False, message="Cancellation reason is required.",
                errors={"reason": ["This field is required."]},
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        if trip.status == Trip.Status.COMPLETED:
            return api_response(
                success=False, message="Cannot cancel a completed trip.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        trip.status = Trip.Status.CANCELLED
        trip.cancellation_reason = reason
        trip.save(update_fields=["status", "cancellation_reason", "updated_at"])

        from backend.apps.notifications.tasks import send_trip_cancellation_notification
        send_trip_cancellation_notification.delay(str(trip.id))
        return api_response(data=TripSerializer(trip).data, message=f"Trip {trip.trip_code} cancelled.")

    @action(detail=True, methods=["post"])
    def delay(self, request, pk=None):
        from datetime import timedelta, datetime as dt

        trip = self.get_object()
        if trip.status not in (Trip.Status.SCHEDULED, Trip.Status.IN_PROGRESS):
            return api_response(
                success=False,
                message=f"Cannot mark a trip as delayed when it is '{trip.status}'.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        reason = request.data.get("reason", "").strip()
        if not reason:
            return api_response(
                success=False,
                message="A delay reason is required.",
                errors={"reason": ["This field is required."]},
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        delay_minutes_raw = request.data.get("delay_minutes")
        try:
            delay_minutes = int(delay_minutes_raw) if delay_minutes_raw is not None else None
        except (ValueError, TypeError):
            delay_minutes = None

        # ── Resolve effective scheduled times (explicit field > slot fallback) ────
        effective_dep = (
            trip.scheduled_departure_time
            or (trip.timetable_slot.departure_time if trip.timetable_slot else None)
        )
        effective_arr = (
            trip.scheduled_arrival_time
            or (trip.timetable_slot.arrival_time if trip.timetable_slot else None)
        )

        update_fields = ["status", "delay_reason", "delay_minutes", "updated_at"]

        if delay_minutes:
            delta = timedelta(minutes=delay_minutes)
            if trip.status == Trip.Status.SCHEDULED:
                # Bus has NOT departed → push both departure and arrival forward
                if effective_dep:
                    trip.scheduled_departure_time = (
                        dt.combine(trip.date, effective_dep) + delta
                    ).time()
                    update_fields.append("scheduled_departure_time")
                if effective_arr:
                    trip.scheduled_arrival_time = (
                        dt.combine(trip.date, effective_arr) + delta
                    ).time()
                    update_fields.append("scheduled_arrival_time")
            else:
                # IN_PROGRESS → bus already departed, only push estimated arrival
                if effective_arr:
                    trip.scheduled_arrival_time = (
                        dt.combine(trip.date, effective_arr) + delta
                    ).time()
                    update_fields.append("scheduled_arrival_time")

        trip.status = Trip.Status.DELAYED
        trip.delay_reason = reason
        trip.delay_minutes = delay_minutes
        trip.save(update_fields=list(dict.fromkeys(update_fields)))  # preserve order, no dupes

        # ── Cascade: push all later trips of the same vehicle on the same day ────
        cascaded = 0
        if delay_minutes and trip.vehicle_id and effective_dep:
            delta = timedelta(minutes=delay_minutes)
            subsequent = (
                Trip.objects.filter(
                    vehicle_id=trip.vehicle_id,
                    date=trip.date,
                    is_deleted=False,
                    scheduled_departure_time__gt=effective_dep,
                )
                .exclude(status__in=[Trip.Status.COMPLETED, Trip.Status.CANCELLED])
                .exclude(pk=trip.pk)
                .select_related("timetable_slot")
            )
            for sub in subsequent:
                sub_dep = sub.scheduled_departure_time or (
                    sub.timetable_slot.departure_time if sub.timetable_slot else None
                )
                sub_arr = sub.scheduled_arrival_time or (
                    sub.timetable_slot.arrival_time if sub.timetable_slot else None
                )
                sub_fields = ["updated_at"]
                if sub_dep:
                    sub.scheduled_departure_time = (
                        dt.combine(sub.date, sub_dep) + delta
                    ).time()
                    sub_fields.append("scheduled_departure_time")
                if sub_arr:
                    sub.scheduled_arrival_time = (
                        dt.combine(sub.date, sub_arr) + delta
                    ).time()
                    sub_fields.append("scheduled_arrival_time")
                sub.save(update_fields=sub_fields)
                cascaded += 1

        msg = f"Trip {trip.trip_code} marked as delayed."
        if cascaded:
            msg += f" {cascaded} subsequent trip(s) rescheduled by +{delay_minutes} min."
        return api_response(data=TripSerializer(trip).data, message=msg)


class DriverShiftViewSet(ModelViewSet):
    queryset = DriverShift.objects.all()
    serializer_class = DriverShiftSerializer
    permission_classes = [IsOperationsRole]
    filterset_fields = ["driver_id", "date"]


class AutoScheduleView(views.APIView):
    permission_classes = [IsOperationsRole]

    def post(self, request):
        from .tasks import auto_schedule_route
        route_id = request.data.get("route_id")
        date = request.data.get("date", str(timezone.now().date()))
        dispatch_time = request.data.get("dispatch_time", "06:00")
        if not route_id:
            return api_response(
                success=False, message="route_id is required.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        auto_schedule_route.delay(route_id, date)
        return api_response(message=f"Auto-scheduling triggered for route {route_id} on {date}.")


# ─────────────────────────────────────────────────────────────────────────────
# TODAY'S OPERATIONS DASHBOARD
# ─────────────────────────────────────────────────────────────────────────────

class TodayDashboardView(views.APIView):
    """
    Returns today's operational stats and trip list.
    Used by the Operations Dashboard page.
    """
    permission_classes = [IsOperationsRole]

    def get(self, request):
        today = timezone.now().date()
        trips = Trip.objects.filter(date=today, is_deleted=False)

        stats = {
            "date": str(today),
            "total_trips": trips.count(),
            "scheduled": trips.filter(status=Trip.Status.SCHEDULED).count(),
            "in_progress": trips.filter(status=Trip.Status.IN_PROGRESS).count(),
            "completed": trips.filter(status=Trip.Status.COMPLETED).count(),
            "cancelled": trips.filter(status=Trip.Status.CANCELLED).count(),
            "delayed": trips.filter(status=Trip.Status.DELAYED).count(),
        }

        # Count unique vehicles operating today
        vehicle_ids = trips.exclude(
            status=Trip.Status.CANCELLED
        ).values_list("vehicle_id", flat=True).distinct()
        stats["active_vehicles"] = len(set(vehicle_ids))

        # Count unique routes
        route_ids = trips.values_list("route_id", flat=True).distinct()
        stats["active_routes"] = len(set(route_ids))

        trips_data = TripSerializer(
            trips.order_by("scheduled_departure_time", "trip_code"),
            many=True,
        ).data

        # Get active alerts from Redis
        r = get_redis()
        tenant_slug = getattr(request, "tenant", None)
        tenant_slug = tenant_slug.schema_name if tenant_slug else "default"
        alerts_raw = r.lrange(f"alerts:{tenant_slug}", 0, 9)
        alerts = []
        for a in alerts_raw:
            try:
                alerts.append(json.loads(a))
            except Exception:
                pass

        return api_response(
            data={"stats": stats, "trips": trips_data, "alerts": alerts},
            message=f"Today's operations for {today}",
        )


# ─────────────────────────────────────────────────────────────────────────────
# ETA — Estimated Time of Arrival for route stops
# ─────────────────────────────────────────────────────────────────────────────

class ETAView(views.APIView):
    """
    Get estimated arrival time for each stop on a route,
    based on current GPS positions stored in Redis.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        route_id = request.query_params.get("route_id")
        if not route_id:
            return api_response(success=False, message="route_id is required.", status_code=400)

        # Fetch route stops from the public (shared) schema
        try:
            from django_tenants.utils import schema_context
            with schema_context("public"):
                from backend.apps.platform.models import RouteStop
                stops = list(
                    RouteStop.objects.filter(route_id=route_id)
                    .select_related("stop")
                    .order_by("sequence_no")
                )
        except Exception as e:
            return api_response(success=False, message=f"Could not fetch route stops: {e}", status_code=500)

        if not stops:
            return api_response(success=False, message="No stops found for this route.", status_code=404)

        # Get all current vehicle positions from Redis
        r = get_redis()
        keys = r.keys("vehicle:position:*")
        bus_positions = []
        for key in keys:
            data = r.get(key)
            if data:
                try:
                    bus_positions.append(json.loads(data))
                except Exception:
                    pass

        stop_etas = []
        for rs in stops:
            stop_lat = float(rs.stop.latitude)
            stop_lon = float(rs.stop.longitude)

            # Find the nearest bus to this stop
            nearest_bus = None
            min_distance = float("inf")
            for bus in bus_positions:
                bus_lat = float(bus.get("latitude", 0))
                bus_lon = float(bus.get("longitude", 0))
                dist = haversine(bus_lat, bus_lon, stop_lat, stop_lon)
                if dist < min_distance:
                    min_distance = dist
                    nearest_bus = bus

            eta_minutes = None
            stop_status = "UNKNOWN"
            if nearest_bus:
                speed_kmh = float(nearest_bus.get("speed", 20)) or 20
                if min_distance <= 50:          # within 50 m = arrived
                    eta_minutes = 0
                    stop_status = "ARRIVED"
                else:
                    eta_minutes = round((min_distance / 1000) / speed_kmh * 60)
                    stop_status = "UPCOMING"

            stop_etas.append({
                "stop_id": str(rs.stop.id),
                "stop_code": rs.stop.stop_code,
                "stop_name": rs.stop.name_en,
                "sequence_no": rs.sequence_no,
                "latitude": stop_lat,
                "longitude": stop_lon,
                "estimated_time_from_start": rs.estimated_time_from_start,
                "eta_minutes": eta_minutes,
                "status": stop_status,
                "nearest_bus_id": nearest_bus.get("vehicle_id") if nearest_bus else None,
                "distance_m": round(min_distance) if nearest_bus else None,
            })

        return api_response(data=stop_etas, message=f"ETA for route {route_id}")


# ─────────────────────────────────────────────────────────────────────────────
# HEADWAY — Bus spacing on a route
# ─────────────────────────────────────────────────────────────────────────────

class HeadwayView(views.APIView):
    """
    Calculate headway (spacing) between consecutive buses on a route.
    Alerts when buses are bunching (< MIN_HEADWAY_MINUTES apart).
    """
    permission_classes = [IsAuthenticated]
    MIN_HEADWAY_MINUTES = 3

    def get(self, request):
        route_id = request.query_params.get("route_id")
        if not route_id:
            return api_response(success=False, message="route_id is required.", status_code=400)

        # Get route stops to calculate position progress
        try:
            from django_tenants.utils import schema_context
            with schema_context("public"):
                from backend.apps.platform.models import RouteStop
                route_stops = list(
                    RouteStop.objects.filter(route_id=route_id)
                    .select_related("stop")
                    .order_by("sequence_no")
                )
        except Exception:
            route_stops = []

        stop_coords = [
            (float(rs.stop.latitude), float(rs.stop.longitude), rs.estimated_time_from_start)
            for rs in route_stops
        ]
        total_route_minutes = stop_coords[-1][2] if stop_coords else 45

        # Get active trips on this route today
        today = timezone.now().date()
        active_trip_vehicle_ids = set(
            Trip.objects.filter(
                route_id=route_id,
                date=today,
                status=Trip.Status.IN_PROGRESS,
                is_deleted=False,
            ).values_list("vehicle_id", flat=True)
        )

        # Get GPS positions from Redis
        r = get_redis()
        keys = r.keys("vehicle:position:*")
        route_buses = []

        for key in keys:
            data = r.get(key)
            if data:
                try:
                    pos = json.loads(data)
                    vid = pos.get("vehicle_id", "")
                    # Include bus if it has an active trip on this route,
                    # or if trip_id matches (fallback)
                    if vid and (vid in [str(x) for x in active_trip_vehicle_ids]):
                        route_buses.append(pos)
                except Exception:
                    pass

        def route_progress(bus_lat, bus_lon):
            """Returns 0-100 progress along the route polyline."""
            if not stop_coords:
                return 0
            min_dist = float("inf")
            nearest_idx = 0
            for i, (lat, lon, _) in enumerate(stop_coords):
                d = haversine(bus_lat, bus_lon, lat, lon)
                if d < min_dist:
                    min_dist = d
                    nearest_idx = i
            return (nearest_idx / max(len(stop_coords) - 1, 1)) * 100

        bus_headways = []
        for bus in route_buses:
            bus_lat = float(bus.get("latitude", 0))
            bus_lon = float(bus.get("longitude", 0))
            progress = route_progress(bus_lat, bus_lon)
            bus_headways.append({
                "vehicle_id": bus.get("vehicle_id"),
                "latitude": bus_lat,
                "longitude": bus_lon,
                "speed_kmh": float(bus.get("speed", 0)),
                "heading": float(bus.get("heading", 0)),
                "progress_pct": round(progress, 1),
                "timestamp": bus.get("timestamp"),
                "gap_ahead_minutes": None,
                "gap_ahead_km": None,
                "bunching_alert": False,
            })

        # Sort by progress (most advanced first)
        bus_headways.sort(key=lambda x: x["progress_pct"], reverse=True)

        alerts = []
        for i, bus in enumerate(bus_headways):
            if i > 0:
                ahead = bus_headways[i - 1]
                gap_pct = ahead["progress_pct"] - bus["progress_pct"]
                gap_minutes = round((gap_pct / 100) * total_route_minutes, 1)
                gap_km_approx = round(
                    (gap_pct / 100) * (total_route_minutes / 60) * 30, 2
                )  # rough estimate at 30 km/h avg

                bus["gap_ahead_minutes"] = gap_minutes
                bus["gap_ahead_km"] = gap_km_approx
                if gap_minutes < self.MIN_HEADWAY_MINUTES:
                    bus["bunching_alert"] = True
                    alerts.append({
                        "type": "BUNCHING",
                        "vehicle_id": bus["vehicle_id"],
                        "ahead_vehicle_id": ahead["vehicle_id"],
                        "gap_minutes": gap_minutes,
                        "message": f"Bus {bus['vehicle_id']} is only {gap_minutes} min behind the bus ahead — bunching risk!",
                    })

        return api_response(
            data={"buses": bus_headways, "alerts": alerts, "total_buses": len(bus_headways)},
            message=f"Headway data for route {route_id}",
        )


# ─────────────────────────────────────────────────────────────────────────────
# ROUTE POLYLINE — Return ordered stop coordinates for map rendering
# ─────────────────────────────────────────────────────────────────────────────

class RoutePolylineView(views.APIView):
    """
    Return the ordered [lat, lng] coordinates of all stops on a route.
    Used by the frontend Leaflet map to draw the route polyline.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, route_id):
        try:
            from django_tenants.utils import schema_context
            with schema_context("public"):
                from backend.apps.platform.models import RouteStop, Route
                try:
                    route = Route.objects.get(pk=route_id)
                except Route.DoesNotExist:
                    return api_response(
                        success=False,
                        message=f"Route {route_id} not found.",
                        status_code=404,
                    )
                stops = list(
                    RouteStop.objects.filter(route_id=route_id)
                    .select_related("stop")
                    .order_by("sequence_no")
                )
        except Exception as e:
            return api_response(success=False, message=str(e), status_code=500)

        coordinates = []
        skipped = 0
        for rs in stops:
            try:
                lat = float(rs.stop.latitude) if rs.stop.latitude is not None else None
                lon = float(rs.stop.longitude) if rs.stop.longitude is not None else None
                # Skip stops that have no coordinates or default (0, 0)
                if lat is None or lon is None or (lat == 0.0 and lon == 0.0):
                    skipped += 1
                    continue
                coordinates.append({
                    "sequence_no": rs.sequence_no,
                    "stop_id": str(rs.stop.id),
                    "stop_code": rs.stop.stop_code,
                    "name": rs.stop.name_en,
                    "latitude": lat,
                    "longitude": lon,
                    "estimated_time_from_start": rs.estimated_time_from_start,
                })
            except (TypeError, ValueError):
                skipped += 1
                continue

        total_stops = len(stops)
        mapped_stops = len(coordinates)
        if total_stops == 0:
            msg = f"Route {route.route_code} has no stops assigned yet. Add stops via Route Management."
        elif mapped_stops == 0:
            msg = f"Route {route.route_code} has {total_stops} stop(s) but none have GPS coordinates set."
        elif skipped > 0:
            msg = f"Polyline for route {route.route_code} ({mapped_stops}/{total_stops} stops have coordinates)"
        else:
            msg = f"Polyline for route {route.route_code}"

        return api_response(
            data={
                "route_id": str(route.id),
                "route_code": route.route_code,
                "name": route.name_en,
                "distance_km": float(route.distance_km),
                "coordinates": coordinates,
                "total_stops": total_stops,
                "mapped_stops": mapped_stops,
            },
            message=msg,
        )


# ─────────────────────────────────────────────────────────────────────────────
# GPS PLAYBACK — Historical bus movement replay
# ─────────────────────────────────────────────────────────────────────────────

class PlaybackView(views.APIView):
    """
    Return historical GPS positions stored in Redis time-series.
    The FastAPI GPS ingest stores the last 1000 events per vehicle.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        vehicle_id = request.query_params.get("vehicle_id")
        if not vehicle_id:
            return api_response(success=False, message="vehicle_id is required.", status_code=400)

        r = get_redis()
        ts_key = f"vehicle:ts:{vehicle_id}"
        raw_positions = r.lrange(ts_key, 0, -1)  # all stored (up to 1000)

        positions = []
        for raw in raw_positions:
            try:
                positions.append(json.loads(raw))
            except Exception:
                pass

        # Sort chronologically (Redis LPUSH means newest is at index 0)
        positions.sort(key=lambda x: x.get("timestamp", ""))

        return api_response(
            data={"vehicle_id": vehicle_id, "positions": positions, "count": len(positions)},
            message=f"Playback data: {len(positions)} positions for vehicle {vehicle_id}",
        )


# ─────────────────────────────────────────────────────────────────────────────
# LIVE POSITIONS (proxy from Redis) — for Django-side polling
# ─────────────────────────────────────────────────────────────────────────────

class LivePositionsView(views.APIView):
    """
    Return snapshot of all current vehicle positions from Redis.
    Alternative to FastAPI endpoint for environments where only Django is exposed.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        r = get_redis()
        keys = r.keys("vehicle:position:*")
        positions = []
        for key in keys:
            data = r.get(key)
            if data:
                try:
                    positions.append(json.loads(data))
                except Exception:
                    pass
        return api_response(data=positions, message=f"{len(positions)} vehicles tracked")
