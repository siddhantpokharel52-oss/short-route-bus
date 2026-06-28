from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    PricingPlanViewSet,
    TenantSubscriptionViewSet,
    InvoiceViewSet,
    PaymentViewSet,
    BillingAuditLogViewSet,
)

router = DefaultRouter()
router.register(r"plans", PricingPlanViewSet, basename="billing-plans")
router.register(r"subscriptions", TenantSubscriptionViewSet, basename="billing-subscriptions")
router.register(r"invoices", InvoiceViewSet, basename="billing-invoices")
router.register(r"payments", PaymentViewSet, basename="billing-payments")
router.register(r"audit-logs", BillingAuditLogViewSet, basename="billing-audit-logs")

urlpatterns = [
    path("", include(router.urls)),
]
