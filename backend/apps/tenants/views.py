from rest_framework import generics, status, views
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet
from django.utils import timezone
from django_tenants.utils import schema_context, get_public_schema_name
from .models import Tenant, TenantSubscription, TenantDocument
from .serializers import (
    TenantSerializer, TenantDetailSerializer, TenantSubscriptionSerializer,
    TenantDocumentSerializer, TenantAnalyticsSerializer,
)
from backend.apps.users.permissions import IsSuperAdmin, IsPlatformRole


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success,
        "data": data,
        "message": message,
        "errors": errors,
        "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


class TenantViewSet(ModelViewSet):
    # Exclude the public schema tenant — it's platform infrastructure (resolves
    # localhost/django/nginx domains), not a real bus-operator tenant, and must
    # never be shown as activatable/suspendable in the onboarding UI.
    queryset = Tenant.objects.exclude(schema_name=get_public_schema_name())
    permission_classes = [IsSuperAdmin]
    serializer_class = TenantSerializer
    filterset_fields = ["status", "plan_type"]
    search_fields = ["name", "schema_name", "contact_email"]
    ordering_fields = ["name", "created_at", "status"]

    def get_serializer_class(self):
        if self.action == "retrieve":
            return TenantDetailSerializer
        return TenantSerializer

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(queryset, many=True)
        return api_response(data=serializer.data, message="Tenants retrieved.")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tenant = serializer.save(created_by=request.user)
        response_data = TenantSerializer(tenant).data
        # Include created admin credentials if an admin was created
        admin_info = getattr(tenant, "_created_admin", None)
        if admin_info:
            response_data["admin_credentials"] = admin_info
        return api_response(
            data=response_data,
            message="Tenant registered. Awaiting document verification.",
            status_code=status.HTTP_201_CREATED,
        )

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance)
        return api_response(data=serializer.data)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return api_response(data=serializer.data, message="Tenant updated.")

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        tenant = self.get_object()
        unverified_docs = tenant.documents.filter(verified=False)
        if unverified_docs.exists():
            return api_response(
                success=False,
                message="All documents must be verified before activation.",
                errors={"documents": ["Unverified documents exist."]},
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        tenant.status = Tenant.Status.ACTIVE
        tenant.save(update_fields=["status", "updated_at"])
        return api_response(message=f"Tenant '{tenant.name}' activated successfully.")

    @action(detail=True, methods=["post"])
    def suspend(self, request, pk=None):
        tenant = self.get_object()
        reason = request.data.get("reason", "")
        tenant.status = Tenant.Status.SUSPENDED
        tenant.save(update_fields=["status", "updated_at"])
        return api_response(message=f"Tenant '{tenant.name}' suspended.")

    @action(detail=True, methods=["get"])
    def analytics(self, request, pk=None):
        tenant = self.get_object()
        data = {
            "tenant_id": str(tenant.id),
            "tenant_name": tenant.name,
            "status": tenant.status,
            "plan": tenant.plan_type,
            "total_vehicles": 0,
            "active_routes": 0,
            "total_drivers": 0,
            "monthly_revenue": 0,
        }
        try:
            with schema_context(tenant.schema_name):
                from backend.apps.fleet.models import Vehicle
                from backend.apps.staff.models import Driver
                data["total_vehicles"] = Vehicle.objects.count()
                data["total_drivers"] = Driver.objects.count()
        except Exception:
            pass
        return api_response(data=data)

    @action(detail=True, methods=["post"])
    def subscription(self, request, pk=None):
        tenant = self.get_object()
        serializer = TenantSubscriptionSerializer(data={**request.data, "tenant": tenant.id})
        serializer.is_valid(raise_exception=True)
        sub = serializer.save()
        tenant.plan_type = sub.plan
        tenant.save(update_fields=["plan_type", "updated_at"])
        return api_response(
            data=serializer.data,
            message="Subscription updated.",
            status_code=status.HTTP_201_CREATED,
        )


class TenantDocumentViewSet(ModelViewSet):
    permission_classes = [IsSuperAdmin]
    serializer_class = TenantDocumentSerializer

    def get_queryset(self):
        return TenantDocument.objects.filter(tenant_id=self.kwargs["tenant_pk"])

    def perform_create(self, serializer):
        tenant = Tenant.objects.get(pk=self.kwargs["tenant_pk"])
        serializer.save(tenant=tenant)

    @action(detail=True, methods=["post"])
    def verify(self, request, tenant_pk=None, pk=None):
        doc = self.get_object()
        doc.verified = True
        doc.verified_by = request.user
        doc.verified_at = timezone.now()
        doc.save(update_fields=["verified", "verified_by", "verified_at"])
        return api_response(message="Document verified.")
