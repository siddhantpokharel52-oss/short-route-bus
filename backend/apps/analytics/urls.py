from django.urls import path
from . import views

urlpatterns = [
    path("dashboard/", views.TenantDashboardView.as_view(), name="tenant-dashboard"),
    path("city/", views.CityAnalyticsView.as_view(), name="city-analytics"),
    path("kpis/", views.TenantKPIView.as_view(), name="tenant-kpis"),
    path("trips/trend/", views.TenantTripTrendView.as_view(), name="trip-trend"),
    path("tickets/live/", views.TicketRevenueLiveView.as_view(), name="tickets-live"),
    path("city/tickets/live/", views.CityTicketRevenueLiveView.as_view(), name="city-tickets-live"),
]
