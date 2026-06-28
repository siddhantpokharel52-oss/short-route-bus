from django.urls import path
from .views import ComplaintViewSet

urlpatterns = [
    path("", ComplaintViewSet.as_view({"post": "create"}), name="public-complaint-submit"),
]
