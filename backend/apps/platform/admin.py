from django.contrib import admin
from .models import Stop, Route, RouteStop, RouteAssignment, TicketType, FareMatrix, SmartCard


@admin.register(Stop)
class StopAdmin(admin.ModelAdmin):
    list_display = ["stop_code", "name_en", "zone", "status"]
    search_fields = ["stop_code", "name_en", "name_ne"]
    list_filter = ["status", "zone"]


@admin.register(Route)
class RouteAdmin(admin.ModelAdmin):
    list_display = ["route_code", "name_en", "route_type", "status"]
    search_fields = ["route_code", "name_en"]
    list_filter = ["status", "route_type"]


@admin.register(RouteAssignment)
class RouteAssignmentAdmin(admin.ModelAdmin):
    list_display = ["route", "tenant", "share_percentage", "status", "start_date"]
    list_filter = ["status"]


@admin.register(TicketType)
class TicketTypeAdmin(admin.ModelAdmin):
    list_display = ["code", "name_en", "validity_hours", "is_active"]


@admin.register(SmartCard)
class SmartCardAdmin(admin.ModelAdmin):
    list_display = ["card_no", "passenger", "balance", "status"]
    search_fields = ["card_no"]
    list_filter = ["status"]
