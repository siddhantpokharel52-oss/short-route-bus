import csv
from datetime import datetime, time

from rest_framework import generics, status, views, filters
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.viewsets import ModelViewSet
from django.db import connection, transaction
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from .models import Ticket, DailyPass, MonthlyPass, StudentPass, NamastePayConfig
from .serializers import (
    TicketSerializer, TicketVerifySerializer,
    DailyPassSerializer, MonthlyPassSerializer, StudentPassSerializer,
    NamastePayConfigSerializer,
)
from backend.apps.users.permissions import IsConductor, IsOperationsRole, IsCompanyAdmin, IsFinanceRole


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success,
        "data": data,
        "message": message,
        "errors": errors,
        "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


class TicketViewSet(ModelViewSet):
    """
    Handles listing + creating tickets (POS / Mobile / Conductor).
    GET  /ticketing/tickets/          → paginated list
    POST /ticketing/tickets/          → issue new ticket
    GET  /ticketing/tickets/{id}/     → retrieve single ticket
    """
    serializer_class = TicketSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["ticket_uid", "passenger_name"]
    ordering_fields = ["issued_at", "fare_paid"]
    ordering = ["-issued_at"]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return Ticket.objects.filter(is_deleted=False)

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        # Optional source filter: ?source=POS|MOBILE|CONDUCTOR
        source = request.query_params.get("source")
        if source:
            qs = qs.filter(issued_by=source.upper())

        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            paginated = self.get_paginated_response(serializer.data)
            return api_response(
                data={
                    "results": serializer.data,
                    "count": paginated.data.get("count", 0),
                    "next": paginated.data.get("next"),
                    "previous": paginated.data.get("previous"),
                },
            )
        serializer = self.get_serializer(qs, many=True)
        return api_response(data={"results": serializer.data, "count": qs.count()})

    def create(self, request, *args, **kwargs):
        data = {
            **request.data,
            # Tag POS tickets with the issuer; mobile/conductor set their own
            "issued_by": request.data.get("issued_by", "POS"),
        }
        # If the request comes from a conductor, record conductor_id automatically
        if hasattr(request.user, "role") and request.user.role == "CONDUCTOR":
            data.setdefault("conductor_id", str(request.user.id))
            data["issued_by"] = "CONDUCTOR"

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        ticket = serializer.save()
        return api_response(
            data=TicketSerializer(ticket).data,
            message="Ticket issued successfully.",
            status_code=status.HTTP_201_CREATED,
        )


class TicketExportView(views.APIView):
    """
    GET /ticketing/tickets/export/?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD

    CSV download of every ticket issued in the given date range, including
    each ticket's payment_reference where one was recorded by the public
    consumer API (Yatroo etc.) -- the reconciliation data finance needs to
    settle operator payouts manually while no automated revenue-split
    infrastructure exists yet. See docs/YATROO_INTEGRATION_STATUS.md §7.
    """
    permission_classes = [IsFinanceRole]

    def get(self, request):
        date_from = parse_date(request.query_params.get("date_from", ""))
        date_to = parse_date(request.query_params.get("date_to", ""))
        if not date_from or not date_to:
            return api_response(
                success=False,
                message="date_from and date_to are both required (YYYY-MM-DD).",
                status_code=400,
            )
        if date_from > date_to:
            return api_response(success=False, message="date_from must not be after date_to.", status_code=400)

        tickets = list(
            Ticket.objects.filter(
                is_deleted=False,
                issued_at__gte=timezone.make_aware(datetime.combine(date_from, time.min)),
                issued_at__lte=timezone.make_aware(datetime.combine(date_to, time.max)),
            ).order_by("issued_at")
        )

        stop_ids = {t.from_stop_id for t in tickets if t.from_stop_id} | {t.to_stop_id for t in tickets if t.to_stop_id}
        stop_names = {}
        if stop_ids:
            from backend.apps.platform.models import Stop
            stop_names = {s.id: s.name_en for s in Stop.objects.filter(id__in=stop_ids)}

        # payment_reference lives in a side-store table the public consumer API
        # (backend/fastapi_services/public_api) owns and writes via raw SQL, not
        # a Django-migrated column on Ticket -- same reasoning as that service's
        # own enrich_payment_references(). It's lazily created on that service's
        # first write, so it may not exist yet in an environment that's never
        # taken a self-service purchase; a savepoint keeps that failure from
        # poisoning the tickets/stops queries already done above.
        payment_refs = {}
        uids = [t.ticket_uid for t in tickets]
        if uids:
            try:
                with transaction.atomic(), connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT ticket_uid, payment_reference FROM public.public_api_ticket_payment_ref "
                        "WHERE ticket_uid = ANY(%s)",
                        [uids],
                    )
                    payment_refs = dict(cursor.fetchall())
            except Exception:
                payment_refs = {}

        response = HttpResponse(content_type="text/csv")
        filename = f"tickets-{date_from.isoformat()}-to-{date_to.isoformat()}.csv"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        writer = csv.writer(response)
        writer.writerow([
            "ticket_uid", "issued_at", "issued_by", "payment_method", "payment_reference",
            "fare_paid", "status", "passenger_name", "from_stop", "to_stop",
        ])
        for t in tickets:
            writer.writerow([
                t.ticket_uid,
                t.issued_at.isoformat(),
                t.issued_by,
                t.payment_method,
                payment_refs.get(t.ticket_uid, ""),
                t.fare_paid,
                t.status,
                t.passenger_name,
                stop_names.get(t.from_stop_id, t.from_stop_id or ""),
                stop_names.get(t.to_stop_id, t.to_stop_id or ""),
            ])
        return response


class VerifyTicketView(views.APIView):
    permission_classes = [AllowAny]

    def get(self, request, uid):
        try:
            ticket = Ticket.objects.get(ticket_uid=uid, is_deleted=False)
        except Ticket.DoesNotExist:
            return api_response(
                success=False,
                message="Ticket not found.",
                status_code=status.HTTP_404_NOT_FOUND,
            )
        if ticket.status == Ticket.Status.USED:
            return api_response(success=False, message="Ticket already used.", status_code=400)
        if ticket.valid_until < timezone.now():
            ticket.status = Ticket.Status.EXPIRED
            ticket.save(update_fields=["status"])
            return api_response(success=False, message="Ticket expired.", status_code=400)

        ticket.status = Ticket.Status.USED
        ticket.save(update_fields=["status"])
        return api_response(data=TicketSerializer(ticket).data, message="Ticket valid and marked as used.")


class CancelTicketView(views.APIView):
    """Voids a ticket. Called two ways: directly by tenant-portal staff (Ticketing ->
    void a wrongly-issued ticket), and by the public API proxy after Yatroo (or any
    integrator) processes a refund on its own side and reports it back (brief §8: "the
    corresponding void/cancel is posted to your platform"). IsAuthenticated is enough on
    its own here -- django-tenants' schema-per-tenant isolation already confines a direct
    staff call to that tenant's own tickets, and the proxy path always forwards a real
    bearer token (the staff member's own, or a minted self-service token for a passenger),
    so this never needs to trust an unauthenticated caller."""
    permission_classes = [IsAuthenticated]

    def post(self, request, uid):
        try:
            ticket = Ticket.objects.get(ticket_uid=uid, is_deleted=False)
        except Ticket.DoesNotExist:
            return api_response(
                success=False,
                message="Ticket not found.",
                status_code=status.HTTP_404_NOT_FOUND,
            )
        if ticket.status == Ticket.Status.CANCELLED:
            # Idempotent — a retried cancel/void report shouldn't error, same
            # philosophy as store_payment_reference's upsert elsewhere in this stack.
            return api_response(data=TicketSerializer(ticket).data, message="Ticket already cancelled.")
        if ticket.status == Ticket.Status.USED:
            return api_response(success=False, message="Cannot cancel a ticket that has already been used.", status_code=400)
        if ticket.status == Ticket.Status.EXPIRED:
            return api_response(success=False, message="Cannot cancel an expired ticket.", status_code=400)

        ticket.status = Ticket.Status.CANCELLED
        ticket.save(update_fields=["status"])
        return api_response(data=TicketSerializer(ticket).data, message="Ticket cancelled.")


class NamastePayConfigView(generics.RetrieveUpdateAPIView):
    """
    GET/PUT/PATCH /ticketing/payment-gateway/
    The tenant's own NamastePay credentials -- singleton-per-tenant, same
    fetch-or-create-on-first-call shape as staff.BusCompanyView. Gated
    IsCompanyAdmin rather than IsOperationsRole (what BusCompanyView uses)
    since payment credentials are more sensitive than general company info.
    """
    serializer_class = NamastePayConfigSerializer
    permission_classes = [IsCompanyAdmin]

    def get_object(self):
        obj = NamastePayConfig.objects.first()
        if not obj:
            obj = NamastePayConfig.objects.create()
        return obj

    def retrieve(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object())
        return api_response(data=serializer.data)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return api_response(data=serializer.data, message="Payment gateway settings saved.")


class NamastePayTestConnectionView(views.APIView):
    """
    POST /ticketing/payment-gateway/test/
    Proves the saved credentials actually work by attempting a real (tiny,
    throwaway) checkout initiation -- there's no separate "verify
    credentials" endpoint in NamastePay's API, so a successful initiate
    call is the honest way to confirm they're valid before any real
    purchase flow exists to exercise them.
    """
    permission_classes = [IsCompanyAdmin]

    def post(self, request):
        config = NamastePayConfig.objects.first()
        if not config or not config.client_id or not config.client_secret:
            return api_response(success=False, message="Save a client ID and client secret first.", status_code=400)

        from . import namastepay
        import uuid as uuid_lib

        try:
            result = namastepay.initiate_checkout(
                config,
                amount=1.00,
                order_id=f"TEST-{uuid_lib.uuid4().hex[:10].upper()}",
                return_url="https://example.com/namastepay-test-callback",
                description="Connection test -- not a real charge",
            )
        except namastepay.NamastePayError as e:
            return api_response(
                success=False,
                message=f"NamastePay rejected the request ({e.status_code}). Check the client ID/secret.",
                errors={"detail": [str(e.body)[:500]]},
                status_code=400,
            )
        except Exception as e:
            return api_response(success=False, message=f"Could not reach NamastePay: {e}", status_code=502)

        return api_response(data=result, message="NamastePay accepted the credentials.")


class IssueDailyPassView(generics.CreateAPIView):
    serializer_class = DailyPassSerializer
    permission_classes = [IsConductor | IsOperationsRole]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return api_response(data=serializer.data, message="Daily pass issued.", status_code=status.HTTP_201_CREATED)


class IssueMonthlyPassView(generics.CreateAPIView):
    serializer_class = MonthlyPassSerializer
    permission_classes = [IsOperationsRole]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return api_response(data=serializer.data, message="Monthly pass issued.", status_code=status.HTTP_201_CREATED)


class IssueStudentPassView(generics.CreateAPIView):
    serializer_class = StudentPassSerializer
    permission_classes = [IsOperationsRole]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return api_response(data=serializer.data, message="Student pass issued.", status_code=status.HTTP_201_CREATED)
