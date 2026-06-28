from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register("tickets", views.TicketViewSet, basename="ticket")

urlpatterns = [
    path("", include(router.urls)),
    path("tickets/<str:uid>/verify/", views.VerifyTicketView.as_view(), name="verify-ticket"),
    path("passes/daily/issue/", views.IssueDailyPassView.as_view(), name="issue-daily-pass"),
    path("passes/monthly/issue/", views.IssueMonthlyPassView.as_view(), name="issue-monthly-pass"),
    path("passes/student/issue/", views.IssueStudentPassView.as_view(), name="issue-student-pass"),
]
