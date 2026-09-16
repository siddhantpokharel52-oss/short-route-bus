from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_nested.routers import NestedDefaultRouter
from . import views

router = DefaultRouter()
router.register("periods", views.RosterPeriodViewSet, basename="roster-period")

periods_router = NestedDefaultRouter(router, "periods", lookup="period")
periods_router.register("duties", views.DutyViewSet, basename="roster-duty")

urlpatterns = [
    path("", include(router.urls)),
    path("", include(periods_router.urls)),
    path("my-duties/", views.MyDutiesView.as_view(), name="my-duties"),
    path("policy/", views.RotationPolicyView.as_view(), name="rotation-policy"),
    path("reports/fair-share/", views.FairShareReportView.as_view(), name="fair-share-report"),
]
