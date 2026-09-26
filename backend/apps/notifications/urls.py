from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register("templates", views.NotificationTemplateViewSet, basename="notification-template")
router.register("logs", views.NotificationLogViewSet, basename="notification-log")
router.register("my-subscriptions", views.MyNotificationSubscriptionViewSet, basename="my-notification-subscription")

urlpatterns = [path("", include(router.urls))]
