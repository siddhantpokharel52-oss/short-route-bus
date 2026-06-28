from rest_framework import generics, status, views, filters
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.viewsets import ModelViewSet
from django.utils import timezone
from .models import Ticket, DailyPass, MonthlyPass, StudentPass
from .serializers import (
    TicketSerializer, TicketVerifySerializer,
    DailyPassSerializer, MonthlyPassSerializer, StudentPassSerializer,
)
from backend.apps.users.permissions import IsConductor, IsOperationsRole


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
