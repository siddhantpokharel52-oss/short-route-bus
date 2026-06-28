from rest_framework import views
from rest_framework.response import Response
from django.utils import timezone
from .models import TenantAnalyticsSnapshot, CityAnalyticsSnapshot
from backend.apps.users.permissions import IsOperationsRole, IsTransportAuthority


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success, "data": data, "message": message,
        "errors": errors, "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


class TenantKPIView(views.APIView):
    """
    GET /analytics/kpis/
    Live KPIs for the tenant analytics dashboard. Computed on-the-fly
    from fleet, scheduling, and ticketing models in the tenant schema.
    """
    permission_classes = [IsOperationsRole]

    def get(self, request):
        from datetime import timedelta
        from django.db.models import Count, Sum, Q
        from backend.apps.fleet.models import Vehicle
        from backend.apps.scheduling.models import Trip
        from backend.apps.ticketing.models import Ticket
        from backend.apps.platform.models import Route

        today = timezone.now().date()
        yesterday = today - timedelta(days=1)

        # ── Fleet ──────────────────────────────────────────────────────────
        total_vehicles = Vehicle.objects.filter(is_deleted=False).count()
        active_vehicles = Vehicle.objects.filter(status="ACTIVE", is_deleted=False).count()
        breakdown_vehicles = Vehicle.objects.filter(status="BREAKDOWN", is_deleted=False).count()
        fleet_utilization = round(active_vehicles / total_vehicles * 100, 1) if total_vehicles else 0
        breakdown_rate = round(breakdown_vehicles / total_vehicles * 100, 1) if total_vehicles else 0

        # ── Trips today ────────────────────────────────────────────────────
        trips_qs = Trip.objects.filter(date=today, is_deleted=False)
        trips_total = trips_qs.count()
        trips_completed = trips_qs.filter(status="COMPLETED").count()
        trips_cancelled = trips_qs.filter(status="CANCELLED").count()
        trips_on_time = trips_qs.filter(
            status="COMPLETED"
        ).filter(Q(delay_minutes__isnull=True) | Q(delay_minutes=0)).count()
        on_time_performance = round(trips_on_time / trips_completed * 100, 1) if trips_completed else 0

        # ── Tickets / Revenue today ────────────────────────────────────────
        tickets_today = Ticket.objects.filter(issued_at__date=today, is_deleted=False)
        total_passengers = tickets_today.count()
        total_revenue = tickets_today.aggregate(r=Sum("fare_paid"))["r"] or 0
        avg_revenue_per_trip = round(float(total_revenue) / trips_total, 2) if trips_total else 0

        # ── Passenger trend vs yesterday ───────────────────────────────────
        passengers_yesterday = Ticket.objects.filter(issued_at__date=yesterday, is_deleted=False).count()
        passenger_trend = (
            round((total_passengers - passengers_yesterday) / passengers_yesterday * 100, 1)
            if passengers_yesterday else 0
        )

        # ── Top routes by trip count today ─────────────────────────────────
        route_trips = list(
            Trip.objects.filter(date=today, is_deleted=False)
            .values("route_id")
            .annotate(trip_count=Count("id"))
            .order_by("-trip_count")[:5]
        )
        route_ids = [r["route_id"] for r in route_trips]
        routes_map = (
            {str(r.id): r.route_code for r in Route.objects.filter(id__in=route_ids)}
            if route_ids else {}
        )
        top_routes = [
            {
                "route": routes_map.get(str(r["route_id"]), str(r["route_id"])[:8]),
                "passengers": r["trip_count"],
            }
            for r in route_trips
        ]

        return api_response(data={
            "fleet_utilization": fleet_utilization,
            "fleet_util_trend": 0,
            "on_time_performance": on_time_performance,
            "total_passengers": total_passengers,
            "passenger_trend": passenger_trend,
            "avg_revenue_per_trip": avg_revenue_per_trip,
            "total_revenue_today": float(total_revenue),
            "breakdown_rate": breakdown_rate,
            "fuel_efficiency": 0,
            "avg_speed": 0,
            "total_distance": 0,
            "trips_total": trips_total,
            "trips_completed": trips_completed,
            "trips_cancelled": trips_cancelled,
            "total_vehicles": total_vehicles,
            "active_vehicles": active_vehicles,
            "top_routes": top_routes,
        })


class TenantTripTrendView(views.APIView):
    """
    GET /analytics/trips/trend/?days=30
    Returns daily trips, passengers, and revenue for the last N days.
    """
    permission_classes = [IsOperationsRole]

    def get(self, request):
        from datetime import timedelta
        from django.db.models import Count, Sum
        from django.db.models.functions import TruncDate
        from backend.apps.scheduling.models import Trip
        from backend.apps.ticketing.models import Ticket

        days = min(int(request.query_params.get("days", 30)), 90)
        today = timezone.now().date()
        from_date = today - timedelta(days=days - 1)

        # Trips grouped by date
        trips_by_day = {
            item["date"]: item["count"]
            for item in Trip.objects.filter(date__gte=from_date, is_deleted=False)
            .values("date")
            .annotate(count=Count("id"))
        }

        # Tickets grouped by date (using TruncDate on issued_at DateTimeField)
        tickets_qs = (
            Ticket.objects.filter(issued_at__date__gte=from_date, is_deleted=False)
            .annotate(day=TruncDate("issued_at"))
            .values("day")
            .annotate(count=Count("id"), revenue=Sum("fare_paid"))
        )
        tickets_by_day = {
            item["day"]: {"count": item["count"], "revenue": float(item["revenue"] or 0)}
            for item in tickets_qs
        }

        trend = []
        for i in range(days):
            day = from_date + timedelta(days=i)
            td = tickets_by_day.get(day, {"count": 0, "revenue": 0.0})
            trend.append({
                "date": day.isoformat(),
                "trips": trips_by_day.get(day, 0),
                "passengers": td["count"],
                "revenue": td["revenue"],
            })

        return api_response(data=trend)


class TenantDashboardView(views.APIView):
    permission_classes = [IsOperationsRole]

    def get(self, request):
        from django_tenants.utils import get_tenant
        tenant = get_tenant(request)
        today = timezone.now().date()
        snapshot = TenantAnalyticsSnapshot.objects.filter(
            tenant_schema=tenant.schema_name,
            snapshot_date=today,
        ).first()

        if not snapshot:
            # Compute live if no snapshot
            from backend.apps.fleet.models import Vehicle
            from backend.apps.staff.models import Driver
            from backend.apps.scheduling.models import Trip
            from backend.apps.revenue.models import DailyRevenue
            from backend.apps.complaints.models import Complaint
            from django.db.models import Sum

            data = {
                "total_vehicles": Vehicle.objects.filter(is_deleted=False).count(),
                "active_vehicles": Vehicle.objects.filter(status=Vehicle.Status.ACTIVE, is_deleted=False).count(),
                "total_drivers": Driver.objects.filter(is_deleted=False).count(),
                "trips_today": Trip.objects.filter(date=today, is_deleted=False).count(),
                "daily_revenue": str(
                    DailyRevenue.objects.filter(date=today).aggregate(t=Sum("net_revenue"))["t"] or 0
                ),
                "open_complaints": Complaint.objects.filter(
                    status__in=["SUBMITTED", "ASSIGNED", "IN_PROGRESS"]
                ).count(),
            }
        else:
            data = {
                "total_vehicles": snapshot.total_vehicles,
                "active_vehicles": snapshot.active_vehicles,
                "total_drivers": snapshot.total_drivers,
                "trips_today": snapshot.trips_today,
                "daily_revenue": str(snapshot.daily_revenue),
                "on_time_rate": str(snapshot.on_time_rate),
                "fleet_utilization": str(snapshot.fleet_utilization),
                "open_complaints": snapshot.open_complaints,
            }

        return api_response(data=data, message="Dashboard data retrieved.")


class CityAnalyticsView(views.APIView):
    permission_classes = [IsTransportAuthority]

    def get(self, request):
        date_from = request.query_params.get("date_from", str(timezone.now().date()))
        date_to = request.query_params.get("date_to", str(timezone.now().date()))
        snapshots = CityAnalyticsSnapshot.objects.filter(
            snapshot_date__gte=date_from,
            snapshot_date__lte=date_to,
        ).order_by("-snapshot_date")
        data = list(snapshots.values(
            "snapshot_date", "total_daily_passengers", "total_active_routes",
            "total_active_buses", "total_revenue", "total_complaints", "fleet_availability_ratio",
        ))
        return api_response(data=data)
