from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register("vendors", views.VendorViewSet, basename="vendor")
router.register("purchase-requests", views.PurchaseRequestViewSet, basename="purchase-request")
router.register("purchase-orders", views.PurchaseOrderViewSet, basename="purchase-order")

urlpatterns = [path("", include(router.urls))]
