from django.contrib import admin
from .models import Incident, InsuranceClaim


@admin.register(Incident)
class IncidentAdmin(admin.ModelAdmin):
    list_display = ["incident_no", "type", "severity", "status", "reported_at"]
    list_filter = ["type", "severity", "status"]
