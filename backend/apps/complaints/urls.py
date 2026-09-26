from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register("my-issue-reports", views.MyIssueReportViewSet, basename="my-issue-report")
router.register("", views.ComplaintViewSet, basename="complaint")

urlpatterns = [path("", include(router.urls))]
