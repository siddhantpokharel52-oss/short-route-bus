from django.contrib import admin
from .models import Vehicle, VehicleDocument, VehicleInsurance, VehicleGPS


@admin.register(Vehicle)
class VehicleAdmin(admin.ModelAdmin):
    list_display = ["registration_no", "make", "model", "year", "status", "fuel_type"]
    list_filter = ["status", "fuel_type"]
    search_fields = ["registration_no", "make", "model", "chassis_no"]


@admin.register(VehicleDocument)
class VehicleDocumentAdmin(admin.ModelAdmin):
    list_display = ["vehicle", "doc_type", "doc_no", "expiry_date"]
    list_filter = ["doc_type"]


@admin.register(VehicleGPS)
class VehicleGPSAdmin(admin.ModelAdmin):
    list_display = ["vehicle", "device_id", "imei", "status"]
