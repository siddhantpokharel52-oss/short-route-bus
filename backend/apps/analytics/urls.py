from django.urls import path
from . import views

urlpatterns = [
    path("dashboard/", views.TenantDashboardView.as_view(), name="tenant-dashboard"),
    path("city/", views.CityAnalyticsView.as_view(), name="city-analytics"),
    path("kpis/", views.TenantKPIView.as_view(), name="tenant-kpis"),
    path("trips/trend/", views.TenantTripTrendView.as_view(), name="trip-trend"),
]
