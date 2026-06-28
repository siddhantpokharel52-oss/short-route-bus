from django.contrib import admin
from .models import Vendor, PurchaseRequest, PurchaseOrder


@admin.register(Vendor)
class VendorAdmin(admin.ModelAdmin):
    list_display = ["name", "contact", "category", "rating"]


@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(admin.ModelAdmin):
    list_display = ["po_no", "vendor", "total_amount", "status", "issued_date"]
