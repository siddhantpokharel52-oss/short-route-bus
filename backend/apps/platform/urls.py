from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register("stops", views.StopViewSet, basename="stop")
router.register("routes", views.RouteViewSet, basename="route")
router.register("ticket-types", views.TicketTypeViewSet, basename="ticket-type")
router.register("fare-matrix", views.FareMatrixViewSet, basename="fare-matrix")
router.register("smart-cards", views.SmartCardViewSet, basename="smart-card")

urlpatterns = [
    path("", include(router.urls)),
    path("tenants/<str:schema>/fleet/", views.TenantFleetView.as_view(), name="tenant-fleet"),
]
