from django.contrib import admin
from .models import InventoryItem, StockMovement, StockAlert


@admin.register(InventoryItem)
class InventoryItemAdmin(admin.ModelAdmin):
    list_display = ["item_code", "name", "category", "current_stock", "reorder_level"]
    list_filter = ["category"]
