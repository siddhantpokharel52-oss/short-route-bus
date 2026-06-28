from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register("timetables", views.TimetableViewSet, basename="timetable")
router.register("trips", views.TripViewSet, basename="trip")
router.register("driver-shifts", views.DriverShiftViewSet, basename="driver-shift")

urlpatterns = [
    path("", include(router.urls)),
    path("auto-schedule/", views.AutoScheduleView.as_view(), name="auto-schedule"),
    # Today's operations dashboard
    path("today-dashboard/", views.TodayDashboardView.as_view(), name="today-dashboard"),
    # Live tracking helpers
    path("eta/", views.ETAView.as_view(), name="eta"),
    path("headway/", views.HeadwayView.as_view(), name="headway"),
    path("playback/", views.PlaybackView.as_view(), name="playback"),
    path("live-positions/", views.LivePositionsView.as_view(), name="live-positions"),
    path("routes/<uuid:route_id>/polyline/", views.RoutePolylineView.as_view(), name="route-polyline"),
]
