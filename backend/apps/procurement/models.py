import uuid
from django.db import models


class Vendor(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    contact = models.CharField(max_length=50)
    address = models.TextField()
    tax_pan = models.CharField(max_length=20, blank=True)
    bank_details = models.JSONField(default=dict, blank=True)
    category = models.CharField(max_length=100, blank=True)
    rating = models.DecimalField(max_digits=3, decimal_places=1, default=5.0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class PurchaseRequest(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING = "PENDING", "Pending Approval"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    requested_by_id = models.UUIDField()
    items = models.JSONField(default=list)
    total_estimate = models.DecimalField(max_digits=14, decimal_places=2)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    approved_by_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status"])]


class PurchaseOrder(models.Model):
    class Status(models.TextChoices):
        ISSUED = "ISSUED", "Issued"
        DELIVERED = "DELIVERED", "Delivered"
        CANCELLED = "CANCELLED", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    purchase_request = models.ForeignKey(
        PurchaseRequest, null=True, blank=True, on_delete=models.SET_NULL, related_name="orders"
    )
    vendor = models.ForeignKey(Vendor, on_delete=models.PROTECT, related_name="orders")
    po_no = models.CharField(max_length=30, unique=True)
    items = models.JSONField(default=list)
    total_amount = models.DecimalField(max_digits=14, decimal_places=2)
    issued_date = models.DateField()
    delivery_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ISSUED)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-issued_date"]


class GoodsReceipt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    purchase_order = models.OneToOneField(PurchaseOrder, on_delete=models.CASCADE, related_name="receipt")
    received_by_id = models.UUIDField()
    received_date = models.DateField()
    items_received = models.JSONField(default=list)
    remarks = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        self.purchase_order.status = PurchaseOrder.Status.DELIVERED
        self.purchase_order.save(update_fields=["status"])
