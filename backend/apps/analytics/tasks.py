from celery import shared_task


@shared_task(queue="analytics")
def refresh_tenant_analytics():
    """Nightly: refresh analytics snapshots for all tenants."""
    from backend.apps.tenants.models import Tenant
    from django_tenants.utils import schema_context
    from django.utils import timezone
    from .models import TenantAnalyticsSnapshot

    today = timezone.now().date()
    for tenant in Tenant.objects.filter(status=Tenant.Status.ACTIVE):
        try:
            with schema_context(tenant.schema_name):
                from backend.apps.fleet.models import Vehicle
                from backend.apps.staff.models import Driver
                from backend.apps.scheduling.models import Trip
                from backend.apps.complaints.models import Complaint

                total = Vehicle.objects.filter(is_deleted=False).count()
                active = Vehicle.objects.filter(status="ACTIVE", is_deleted=False).count()
                utilization = (active / total * 100) if total > 0 else 0
                revenue = 0

                TenantAnalyticsSnapshot.objects.update_or_create(
                    tenant_schema=tenant.schema_name,
                    snapshot_date=today,
                    defaults={
                        "total_vehicles": total,
                        "active_vehicles": active,
                        "total_drivers": Driver.objects.filter(is_deleted=False).count(),
                        "trips_today": Trip.objects.filter(date=today, is_deleted=False).count(),
                        "daily_revenue": revenue,
                        "fleet_utilization": utilization,
                        "open_complaints": Complaint.objects.filter(
                            status__in=["SUBMITTED", "ASSIGNED", "IN_PROGRESS"]
                        ).count(),
                    }
                )
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Analytics refresh failed for {tenant.schema_name}: {e}")

    return f"Analytics refreshed for {today}"


@shared_task(queue="analytics")
def refresh_city_analytics():
    """Nightly: refresh city-level analytics."""
    from backend.apps.tenants.models import Tenant
    from backend.apps.platform.models import Route
    from django.utils import timezone
    from .models import CityAnalyticsSnapshot

    today = timezone.now().date()
    total_passengers = 0
    total_revenue = 0

    for tenant in Tenant.objects.filter(status=Tenant.Status.ACTIVE):
        from django_tenants.utils import schema_context
        with schema_context(tenant.schema_name):
            from backend.apps.ticketing.models import Ticket
            from django.db.models import Sum
            agg = Ticket.objects.filter(created_at__date=today).aggregate(
                p=Sum("passenger_count"), r=Sum("fare")
            )
            total_passengers += agg["p"] or 0
            total_revenue += agg["r"] or 0

    CityAnalyticsSnapshot.objects.update_or_create(
        snapshot_date=today,
        defaults={
            "total_daily_passengers": total_passengers,
            "total_active_routes": Route.objects.filter(status="APPROVED").count(),
            "total_revenue": total_revenue,
        }
    )
    return f"City analytics refreshed for {today}"
