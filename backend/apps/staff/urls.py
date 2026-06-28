from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register("drivers", views.DriverViewSet, basename="driver")
router.register("conductors", views.ConductorViewSet, basename="conductor")
router.register("licenses", views.CompanyLicenseViewSet, basename="company-license")

urlpatterns = [
    path("", include(router.urls)),
    path("profile/", views.BusCompanyView.as_view(), name="operator-profile"),
    path("company/", views.BusCompanyView.as_view(), name="operator-company"),  # alias used by frontend
    path("summary/", views.OperatorSummaryView.as_view(), name="operator-summary"),
]
