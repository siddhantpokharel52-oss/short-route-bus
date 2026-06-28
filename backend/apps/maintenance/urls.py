from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register("schedules", views.MaintenanceScheduleViewSet, basename="maintenance-schedule")
router.register("service-records", views.ServiceRecordViewSet, basename="service-record")
router.register("workshops", views.WorkshopViewSet, basename="workshop")

urlpatterns = [path("", include(router.urls))]
