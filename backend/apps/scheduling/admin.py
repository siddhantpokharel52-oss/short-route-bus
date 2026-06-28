from django.contrib import admin
from .models import Timetable, TimetableSlot, Trip, DriverShift


@admin.register(Timetable)
class TimetableAdmin(admin.ModelAdmin):
    list_display = ["route_id", "day_type", "version", "effective_date", "is_active"]


@admin.register(Trip)
class TripAdmin(admin.ModelAdmin):
    list_display = ["trip_code", "route_id", "date", "status", "driver_id"]
    list_filter = ["status", "date"]
    search_fields = ["trip_code"]
