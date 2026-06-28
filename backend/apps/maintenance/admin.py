from django.contrib import admin
from .models import MaintenanceSchedule, ServiceRecord, Workshop


@admin.register(MaintenanceSchedule)
class MaintenanceScheduleAdmin(admin.ModelAdmin):
    list_display = ["vehicle_id", "service_type", "due_date", "status"]
    list_filter = ["status", "service_type"]


@admin.register(ServiceRecord)
class ServiceRecordAdmin(admin.ModelAdmin):
    list_display = ["vehicle_id", "start_date", "end_date", "total_cost"]


@admin.register(Workshop)
class WorkshopAdmin(admin.ModelAdmin):
    list_display = ["name", "contact", "rating", "is_active"]
