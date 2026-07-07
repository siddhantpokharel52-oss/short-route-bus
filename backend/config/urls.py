from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView, SpectacularRedocView

urlpatterns = [
    path("admin/", admin.site.urls),
    # API Documentation
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
    # Auth
    path("api/v1/auth/", include("backend.apps.users.urls")),
    # Platform endpoints (shared schema)
    path("api/v1/platform/", include("backend.apps.tenants.urls")),
    path("api/v1/platform/", include("backend.apps.platform.urls")),
    # Tenant endpoints
    path("api/v1/operator/", include("backend.apps.staff.urls")),
    path("api/v1/fleet/", include("backend.apps.fleet.urls")),
    path("api/v1/scheduling/", include("backend.apps.scheduling.urls")),
    path("api/v1/dispatch/", include("backend.apps.dispatch.urls")),
    path("api/v1/ticketing/", include("backend.apps.ticketing.urls")),
    path("api/v1/maintenance/", include("backend.apps.maintenance.urls")),
    path("api/v1/fuel/", include("backend.apps.fuel.urls")),
    path("api/v1/procurement/", include("backend.apps.procurement.urls")),
    path("api/v1/incidents/", include("backend.apps.incidents.urls")),
    path("api/v1/operator/complaints/", include("backend.apps.complaints.urls")),
    path("api/v1/documents/", include("backend.apps.documents.urls")),
    path("api/v1/analytics/", include("backend.apps.analytics.urls")),
    path("api/v1/accounting/", include("backend.apps.accounting.urls")),
    path("api/v1/notifications/", include("backend.apps.notifications.urls")),
    path("api/v1/rbac/", include("backend.apps.rbac.urls")),
    # Health check
    path("health/", include("backend.apps.users.health_urls")),
    # Prometheus metrics
    path("", include("django_prometheus.urls")),
]

if settings.DEBUG:
    import debug_toolbar
    urlpatterns = [path("__debug__/", include(debug_toolbar.urls))] + urlpatterns
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
