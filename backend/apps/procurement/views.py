from rest_framework.viewsets import ModelViewSet
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from .models import Vendor, PurchaseRequest, PurchaseOrder, GoodsReceipt
from .serializers import VendorSerializer, PurchaseRequestSerializer, PurchaseOrderSerializer, GoodsReceiptSerializer
from backend.apps.users.permissions import IsFinanceRole


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success, "data": data, "message": message,
        "errors": errors, "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


class VendorViewSet(ModelViewSet):
    queryset = Vendor.objects.filter(is_active=True)
    serializer_class = VendorSerializer
    permission_classes = [IsFinanceRole]
    search_fields = ["name", "category"]


class PurchaseRequestViewSet(ModelViewSet):
    queryset = PurchaseRequest.objects.all()
    serializer_class = PurchaseRequestSerializer
    permission_classes = [IsFinanceRole]
    filterset_fields = ["status"]

    def perform_create(self, serializer):
        serializer.save(requested_by_id=self.request.user.id)


class PurchaseOrderViewSet(ModelViewSet):
    queryset = PurchaseOrder.objects.all()
    serializer_class = PurchaseOrderSerializer
    permission_classes = [IsFinanceRole]
    filterset_fields = ["status", "vendor"]

    @action(detail=True, methods=["patch"])
    def receive(self, request, pk=None):
        po = self.get_object()
        serializer = GoodsReceiptSerializer(data={**request.data, "purchase_order": po.id, "received_by_id": str(request.user.id)})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return api_response(data=serializer.data, message="Goods received.")
