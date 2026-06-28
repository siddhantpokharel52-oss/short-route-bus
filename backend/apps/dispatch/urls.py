from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register("allocations", views.DailyAllocationViewSet, basename="allocation")

urlpatterns = [
    path("", include(router.urls)),
    path("logs/", views.DispatchLogListView.as_view(), name="dispatch-logs"),
    path("generate-schedule/", views.GenerateScheduleView.as_view(), name="generate-schedule"),
]
