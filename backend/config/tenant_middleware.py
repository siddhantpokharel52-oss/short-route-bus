"""
TenantSchemaMiddleware
─────────────────────
When the frontend (tenant portal) sends requests to the public-schema domain
(localhost / django:8000), django-tenants routes them to the public schema by
default. This middleware inspects the `X-Tenant-Slug` request header (set by
the Axios interceptor in api.ts for all tenant users) and switches the
database connection to the correct tenant schema so that TENANT_APPS tables
(staff, fleet, scheduling, …) are queried from the right schema.

Security: we only switch if the slug matches an existing tenant; the JWT
already limits what the authenticated user can do inside that schema.
"""

from django.db import connection


class TenantSchemaMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        slug = request.headers.get("X-Tenant-Slug", "").strip().lower()
        if slug:
            try:
                from backend.apps.tenants.models import Tenant
                tenant = Tenant.objects.get(schema_name=slug)
                connection.set_tenant(tenant)
            except Exception:
                # Unknown slug or DB error — leave schema unchanged
                pass

        response = self.get_response(request)
        return response
