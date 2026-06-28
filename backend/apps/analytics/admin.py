from django.contrib import admin
from .models import TenantAnalyticsSnapshot, CityAnalyticsSnapshot


@admin.register(TenantAnalyticsSnapshot)
class TenantAnalyticsSnapshotAdmin(admin.ModelAdmin):
    list_display = ["tenant_schema", "snapshot_date", "daily_revenue", "fleet_utilization"]
    ordering = ["-snapshot_date"]


@admin.register(CityAnalyticsSnapshot)
class CityAnalyticsSnapshotAdmin(admin.ModelAdmin):
    list_display = ["snapshot_date", "total_daily_passengers", "total_revenue"]
    ordering = ["-snapshot_date"]
