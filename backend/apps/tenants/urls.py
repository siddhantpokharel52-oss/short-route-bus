from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_nested import routers as nested_routers
from . import views

router = DefaultRouter()
router.register("tenants", views.TenantViewSet, basename="tenant")

tenants_router = nested_routers.NestedDefaultRouter(router, "tenants", lookup="tenant")
tenants_router.register("documents", views.TenantDocumentViewSet, basename="tenant-document")

urlpatterns = [
    path("", include(router.urls)),
    path("", include(tenants_router.urls)),
]
