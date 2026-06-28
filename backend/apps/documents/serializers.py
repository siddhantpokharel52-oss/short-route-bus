from rest_framework import serializers
from .models import Document, DocumentAlert


class DocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Document
        fields = [
            "id", "entity_type", "entity_id", "doc_category", "doc_type",
            "file_path", "file_size", "doc_no", "issued_date", "expiry_date",
            "uploaded_by_id", "uploaded_at", "verified", "verified_by_id", "verified_at",
        ]
        read_only_fields = ["id", "uploaded_at", "verified", "verified_by_id", "verified_at"]


class DocumentAlertSerializer(serializers.ModelSerializer):
    class Meta:
        model = DocumentAlert
        fields = ["id", "document", "days_to_expiry", "alert_type", "sent_at", "resolved"]
        read_only_fields = ["id", "sent_at"]
