from django.contrib import admin
from .models import Document, DocumentAlert


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ["entity_type", "entity_id", "doc_category", "expiry_date", "verified"]
    list_filter = ["entity_type", "doc_category", "verified"]
