from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_nested.routers import NestedDefaultRouter
from . import views

router = DefaultRouter()
router.register("vehicles", views.VehicleViewSet, basename="vehicle")

vehicles_router = NestedDefaultRouter(router, "vehicles", lookup="vehicle")
vehicles_router.register("documents", views.VehicleDocumentViewSet, basename="vehicle-document")

urlpatterns = [
    path("", include(router.urls)),
    path("", include(vehicles_router.urls)),
]
