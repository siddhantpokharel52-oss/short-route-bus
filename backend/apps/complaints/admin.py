from django.contrib import admin
from .models import Complaint, ComplaintResolution


@admin.register(Complaint)
class ComplaintAdmin(admin.ModelAdmin):
    list_display = ["complaint_no", "complaint_type", "status", "submitted_at"]
    list_filter = ["status", "complaint_type"]
    search_fields = ["complaint_no", "vehicle_no"]
