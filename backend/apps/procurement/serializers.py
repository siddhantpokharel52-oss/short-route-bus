from rest_framework import serializers
from .models import Vendor, PurchaseRequest, PurchaseOrder, GoodsReceipt


class VendorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vendor
        fields = ["id", "name", "contact", "address", "tax_pan", "category", "rating", "is_active", "created_at"]
        read_only_fields = ["id", "created_at"]


class PurchaseRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = PurchaseRequest
        fields = ["id", "requested_by_id", "items", "total_estimate", "status", "approved_by_id", "created_at"]
        read_only_fields = ["id", "created_at", "approved_by_id"]


class PurchaseOrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = PurchaseOrder
        fields = [
            "id", "purchase_request", "vendor", "po_no", "items",
            "total_amount", "issued_date", "delivery_date", "status", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class GoodsReceiptSerializer(serializers.ModelSerializer):
    class Meta:
        model = GoodsReceipt
        fields = ["id", "purchase_order", "received_by_id", "received_date", "items_received", "remarks", "created_at"]
        read_only_fields = ["id", "created_at"]
