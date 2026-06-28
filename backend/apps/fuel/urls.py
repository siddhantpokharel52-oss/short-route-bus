from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register("issuances", views.FuelIssuanceViewSet, basename="fuel-issuance")
router.register("mileage", views.MileageRecordViewSet, basename="mileage")
router.register("alerts", views.FuelAlertViewSet, basename="fuel-alert")

urlpatterns = [path("", include(router.urls))]
