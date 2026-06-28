from django.contrib import admin
from .models import FuelIssuance, MileageRecord, FuelAlert


@admin.register(FuelIssuance)
class FuelIssuanceAdmin(admin.ModelAdmin):
    list_display = ["vehicle_id", "date", "fuel_type", "quantity_liters", "station"]


@admin.register(FuelAlert)
class FuelAlertAdmin(admin.ModelAdmin):
    list_display = ["vehicle_id", "alert_type", "resolved", "created_at"]
