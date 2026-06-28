from django.urls import path
from . import views

urlpatterns = [
    path("stops/", views.StopViewSet.as_view({"get": "list"}), name="public-stops"),
    path("stops/<uuid:pk>/arrivals/", views.StopViewSet.as_view({"get": "arrivals"}), name="public-stop-arrivals"),
    path("fares/", views.PublicFareInquiryView.as_view(), name="public-fares"),
]
