from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register("items", views.InventoryItemViewSet, basename="inventory-item")
router.register("movements", views.StockMovementViewSet, basename="stock-movement")
router.register("alerts", views.StockAlertViewSet, basename="stock-alert")

urlpatterns = [path("", include(router.urls))]
