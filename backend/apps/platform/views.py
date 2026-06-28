from rest_framework import generics, status, views
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet
from rest_framework.permissions import AllowAny
from django.utils import timezone
from django.db import transaction
from .models import (
    Stop, StopAnalytics, Route, RouteStop, RouteAssignment, RouteDiversion,
    TicketType, FareMatrix, SmartCard, CardTransaction, CardRecharge, FarePolicy,
)
from .serializers import (
    StopSerializer, StopAnalyticsSerializer, RouteSerializer, RouteStopSerializer,
    RouteAssignmentSerializer, RouteDiversionSerializer, TicketTypeSerializer,
    FareMatrixSerializer, SmartCardSerializer, CardTransactionSerializer,
    CardRechargeSerializer, FarePolicySerializer,
)
from backend.apps.users.permissions import IsSuperAdmin, IsPlatformRole, IsTransportAuthority, CanManageRoutes


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success,
        "data": data,
        "message": message,
        "errors": errors,
        "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


class StopViewSet(ModelViewSet):
    serializer_class = StopSerializer
    filterset_fields = ["status", "zone", "has_shelter"]
    search_fields = ["name_en", "name_ne", "stop_code"]
    ordering_fields = ["stop_code", "name_en", "created_at"]

    def get_queryset(self):
        return Stop.objects.filter(is_deleted=False)

    def get_permissions(self):
        if self.action in ["list", "retrieve"]:
            return [AllowAny()]
        return [CanManageRoutes()]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=["get"])
    def analytics(self, request, pk=None):
        stop = self.get_object()
        date_from = request.query_params.get("date_from")
        date_to = request.query_params.get("date_to")
        qs = StopAnalytics.objects.filter(stop=stop)
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)
        serializer = StopAnalyticsSerializer(qs, many=True)
        return api_response(data=serializer.data)

    @action(detail=True, methods=["get"], url_path="arrivals", permission_classes=[AllowAny])
    def arrivals(self, request, pk=None):
        stop = self.get_object()
        # Placeholder: real-time data comes from FastAPI GPS service
        return api_response(data={"stop_id": str(stop.id), "arrivals": []}, message="Live arrivals")


class RouteViewSet(ModelViewSet):
    queryset = Route.objects.filter(is_deleted=False)
    serializer_class = RouteSerializer
    filterset_fields = ["status", "route_type"]
    search_fields = ["route_code", "name_en", "name_ne"]
    ordering_fields = ["route_code", "name_en", "created_at"]

    def get_permissions(self):
        # "stops" is a read-only lookup action — allow unauthenticated access
        # (same policy as list/retrieve: route stop data is public)
        if self.action in ["list", "retrieve", "stops"]:
            return [AllowAny()]
        return [CanManageRoutes()]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        route = self.get_object()
        if route.status == Route.Status.APPROVED:
            return api_response(
                success=False,
                message="Route is already approved.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        if route.status == Route.Status.INACTIVE:
            return api_response(
                success=False,
                message="Cannot approve an inactive route. Reactivate it first.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        route.status = Route.Status.APPROVED
        route.approved_by = request.user
        route.approved_at = timezone.now()
        route.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
        return api_response(message=f"Route {route.route_code} approved.")

    @action(detail=True, methods=["get"], url_path="stops", permission_classes=[AllowAny])
    def stops(self, request, pk=None):
        """
        GET /platform/routes/{id}/stops/
        Returns the ordered list of stops for a route, wrapped in api_response.
        Used by the POS ticketing modal to populate From/To dropdowns.
        """
        route = self.get_object()
        qs = (
            route.route_stops
            .select_related("stop")
            .order_by("sequence_no")
        )
        data = [
            {
                "route_stop_id": str(rs.id),
                "stop_id": str(rs.stop.id),
                "name_en": rs.stop.name_en,
                "name_ne": rs.stop.name_ne,
                "stop_code": rs.stop.stop_code,
                "sequence_no": rs.sequence_no,
                "latitude": float(rs.stop.latitude),
                "longitude": float(rs.stop.longitude),
            }
            for rs in qs
        ]
        return api_response(data=data)

    @action(detail=True, methods=["post"], url_path="add-stop")
    def add_stop(self, request, pk=None):
        """
        POST /platform/routes/{id}/add-stop/
        Body: { name_en, name_ne?, latitude, longitude, is_terminal?, sequence_no? }
        Creates a Stop and links it to this route via RouteStop.
        """
        import secrets as _secrets
        route = self.get_object()

        # --- Create the Stop ---
        stop_code = request.data.get("stop_code") or f"KV{_secrets.token_hex(3).upper()}"
        stop_data = {
            "stop_code": stop_code,
            "name_en": request.data.get("name_en", ""),
            "name_ne": request.data.get("name_ne", ""),
            "latitude": request.data.get("latitude"),
            "longitude": request.data.get("longitude"),
            "capacity": request.data.get("capacity", 50),
            "status": "ACTIVE",
        }
        stop_ser = StopSerializer(data=stop_data)
        stop_ser.is_valid(raise_exception=True)
        stop = stop_ser.save(created_by=request.user)

        # --- Determine sequence number ---
        from django.db.models import Max
        max_seq = RouteStop.objects.filter(route=route).aggregate(m=Max("sequence_no"))["m"] or 0
        sequence_no = request.data.get("sequence_no", max_seq + 1)

        # --- Link to route ---
        route_stop = RouteStop.objects.create(
            route=route,
            stop=stop,
            sequence_no=sequence_no,
            estimated_time_from_start=request.data.get("estimated_time_from_start", 0),
        )

        # Update start/end stop on route
        if sequence_no == 1 or route.start_stop is None:
            route.start_stop = stop
        route.end_stop = stop
        route.save(update_fields=["start_stop", "end_stop", "updated_at"])

        return api_response(
            data={
                "stop": StopSerializer(stop).data,
                "route_stop_id": str(route_stop.id),
                "sequence_no": sequence_no,
            },
            message=f"Stop '{stop.name_en}' added to route {route.route_code}.",
            status_code=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="remove-stop")
    def remove_stop(self, request, pk=None):
        """
        POST /platform/routes/{id}/remove-stop/
        Body: { route_stop_id: <uuid> }
        Unlinks a stop from this route by deleting the RouteStop join record.
        The Stop record itself is NOT deleted (it may belong to other routes).
        """
        from django.shortcuts import get_object_or_404

        route = self.get_object()
        route_stop_id = request.data.get("route_stop_id")
        if not route_stop_id:
            return api_response(
                success=False,
                message="route_stop_id is required.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        route_stop = get_object_or_404(RouteStop, id=route_stop_id, route=route)
        stop_name = route_stop.stop.name_en
        route_stop.delete()

        # Recompute start_stop / end_stop on the route after removal
        remaining = RouteStop.objects.filter(route=route).order_by("sequence_no")
        if remaining.exists():
            route.start_stop = remaining.first().stop
            route.end_stop = remaining.last().stop
        else:
            route.start_stop = None
            route.end_stop = None
        route.save(update_fields=["start_stop", "end_stop", "updated_at"])

        return api_response(
            message=f"Stop '{stop_name}' removed from route {route.route_code}.",
        )

    @action(detail=True, methods=["post"])
    def assign(self, request, pk=None):
        route = self.get_object()
        data = {**request.data, "route": route.id}
        serializer = RouteAssignmentSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        assignment = serializer.save(approved_by=request.user)
        return api_response(
            data=RouteAssignmentSerializer(assignment).data,
            message="Route assigned to tenant.",
            status_code=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def diversion(self, request, pk=None):
        route = self.get_object()
        data = {**request.data, "route": route.id}
        serializer = RouteDiversionSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        diversion = serializer.save(created_by=request.user)
        # Trigger notification to affected drivers/dispatchers
        from backend.apps.notifications.tasks import send_diversion_notification
        send_diversion_notification.delay(str(diversion.id))
        return api_response(
            data=RouteDiversionSerializer(diversion).data,
            message="Diversion created. Notifications sent.",
            status_code=status.HTTP_201_CREATED,
        )


class TicketTypeViewSet(ModelViewSet):
    queryset = TicketType.objects.filter(is_active=True)
    serializer_class = TicketTypeSerializer

    def get_permissions(self):
        if self.action in ["list", "retrieve"]:
            return [AllowAny()]
        return [IsPlatformRole()]


class FareMatrixViewSet(ModelViewSet):
    queryset = FareMatrix.objects.all()
    serializer_class = FareMatrixSerializer
    permission_classes = [IsPlatformRole]
    filterset_fields = ["route", "ticket_type"]


class SmartCardViewSet(ModelViewSet):
    queryset = SmartCard.objects.filter(is_deleted=False)
    serializer_class = SmartCardSerializer
    permission_classes = [IsPlatformRole]
    lookup_field = "card_no"

    @action(detail=True, methods=["post"])
    def recharge(self, request, card_no=None):
        card = self.get_object()
        if card.status != SmartCard.Status.ACTIVE:
            return api_response(
                success=False,
                message="Card is not active.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        serializer = CardRechargeSerializer(data={**request.data, "card": card.id})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            recharge = serializer.save()
            card.balance += recharge.amount
            card.save(update_fields=["balance"])
            CardTransaction.objects.create(
                card=card,
                amount=recharge.amount,
                transaction_type=CardTransaction.TransactionType.RECHARGE,
                balance_after=card.balance,
            )
        if card.balance < 10:
            from backend.apps.notifications.tasks import send_low_balance_alert
            send_low_balance_alert.delay(str(card.id))
        return api_response(
            data={"card_no": card.card_no, "new_balance": str(card.balance)},
            message="Recharge successful.",
        )

    @action(detail=True, methods=["post"])
    def block(self, request, card_no=None):
        card = self.get_object()
        card.status = SmartCard.Status.BLOCKED
        card.save(update_fields=["status"])
        return api_response(message="Card blocked.")

    @action(detail=True, methods=["post"])
    def replace(self, request, card_no=None):
        old_card = self.get_object()
        old_card.status = SmartCard.Status.BLOCKED
        old_card.is_deleted = True
        old_card.save(update_fields=["status", "is_deleted"])
        import secrets
        new_card_no = f"KV{secrets.token_hex(4).upper()}"
        new_card = SmartCard.objects.create(
            card_no=new_card_no,
            passenger=old_card.passenger,
            balance=0,
            status=SmartCard.Status.ACTIVE,
            issued_by_tenant=old_card.issued_by_tenant,
        )
        return api_response(
            data=SmartCardSerializer(new_card).data,
            message="Card replaced. New card issued with 0 balance.",
            status_code=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"])
    def transactions(self, request, card_no=None):
        card = self.get_object()
        qs = CardTransaction.objects.filter(card=card).order_by("-timestamp")
        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = CardTransactionSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = CardTransactionSerializer(qs, many=True)
        return api_response(data=serializer.data)


class TenantFleetView(views.APIView):
    """
    GET /platform/tenants/{schema}/fleet/
    Super-admin cross-schema view: returns all vehicles for a given tenant schema,
    enriched with route_code and route_name from the shared Route table.
    """
    permission_classes = [IsSuperAdmin]

    def get(self, request, schema):
        from django_tenants.utils import schema_context
        from backend.apps.fleet.models import Vehicle

        try:
            with schema_context(schema):
                vehicles = list(
                    Vehicle.objects.filter(is_deleted=False)
                    .values(
                        "id", "registration_no", "vehicle_type",
                        "status", "assigned_route_id", "gps_device_id",
                        "make", "model", "capacity_seated",
                    )
                )
        except Exception:
            return api_response(
                success=False,
                message=f"Tenant schema '{schema}' not found or inaccessible.",
                status_code=status.HTTP_404_NOT_FOUND,
            )

        # Enrich with route info from public schema
        route_ids = [v["assigned_route_id"] for v in vehicles if v["assigned_route_id"]]
        routes = {
            str(r.id): {"code": r.route_code, "name": r.name_en}
            for r in Route.objects.filter(id__in=route_ids)
        }

        for v in vehicles:
            rid = v["assigned_route_id"]
            v["id"] = str(v["id"])
            v["assigned_route_id"] = str(rid) if rid else None
            route_info = routes.get(str(rid)) if rid else None
            v["route_code"] = route_info["code"] if route_info else None
            v["route_name"] = route_info["name"] if route_info else None

        return api_response(data=vehicles, message=f"Fleet for {schema}: {len(vehicles)} vehicles")


class PublicFareInquiryView(views.APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        from_stop = request.query_params.get("from_stop")
        to_stop = request.query_params.get("to_stop")
        if not from_stop or not to_stop:
            return api_response(
                success=False,
                message="from_stop and to_stop are required.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        fares = FareMatrix.objects.filter(
            route__route_stops__stop__stop_code=from_stop
        ).distinct()
        serializer = FareMatrixSerializer(fares, many=True)
        return api_response(data=serializer.data)
