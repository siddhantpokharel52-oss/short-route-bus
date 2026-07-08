"""
TenantSchemaMiddleware
─────────────────────
When the frontend (tenant portal) sends requests to the public-schema domain
(localhost / django:8000), django-tenants routes them to the public schema by
default. This middleware inspects the `X-Tenant-Slug` request header (set by
the Axios interceptor in api.ts for all tenant users) and switches the
database connection to the correct tenant schema so that TENANT_APPS tables
(staff, fleet, scheduling, …) are queried from the right schema.

Security: the slug is client-supplied, so it must be checked against the
*authenticated* user's own tenant before it's trusted — otherwise any logged
-in user could send a different tenant's slug and read/write that tenant's
data (role permission classes like IsFleetRole only check request.user.role,
never which schema is active). DRF's permission_classes can't do this check
reliably: a view that sets its own permission_classes list (which is nearly
every view in this codebase) replaces DEFAULT_PERMISSION_CLASSES rather than
extending it, so a check added only via settings would silently never run.
This middleware resolves the JWT directly (via JWTAuthentication) so the
check happens unconditionally, in one place, before the schema is switched.
"""

from django.db import connection
from django.http import JsonResponse


_SENTINEL = object()


def _authenticate_jwt(request):
    """Resolve the request's JWT user.

    Returns:
        (user, expired) where:
          user    – the resolved User, or None
          expired – True if a Bearer token was present but authentication failed
                    (expired or invalid token). False if no token was sent.
    """
    auth_header = request.headers.get("Authorization", "")
    has_token = auth_header.lower().startswith("bearer ")
    try:
        from rest_framework_simplejwt.authentication import JWTAuthentication
        result = JWTAuthentication().authenticate(request)
        if result is not None:
            user, _token = result
            return user, False
    except Exception:
        pass
    return None, has_token  # None user; expired=True only when a token was supplied


class TenantSchemaMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        slug = request.headers.get("X-Tenant-Slug", "").strip().lower()
        if slug:
            try:
                from backend.apps.tenants.models import Tenant
                tenant = Tenant.objects.get(schema_name=slug)
            except Exception:
                tenant = None  # unknown slug — leave schema unchanged

            if tenant is not None:
                user, token_expired = _authenticate_jwt(request)

                if user is None and token_expired:
                    # Bearer token was present but expired/invalid → 401 so
                    # the Axios refresh interceptor retries with a fresh token.
                    return JsonResponse(
                        {
                            "success": False,
                            "data": None,
                            "message": "Authentication required.",
                            "errors": {"detail": "Token is expired or invalid."},
                        },
                        status=401,
                    )

                if user is not None:
                    # Valid JWT — verify it belongs to this tenant before
                    # switching schema (prevents cross-tenant data leakage).
                    user_schema = (getattr(user, "tenant_schema", "") or "").lower()
                    if slug != user_schema:
                        return JsonResponse(
                            {
                                "success": False,
                                "data": None,
                                "message": "Permission denied.",
                                "errors": {"detail": "X-Tenant-Slug does not match your account's tenant."},
                            },
                            status=403,
                        )

                # No JWT at all (unauthenticated request, e.g. /auth/login/).
                # Pass through — the view's permission_classes handle auth.
                connection.set_tenant(tenant)

        response = self.get_response(request)
        return response
