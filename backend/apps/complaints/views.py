from rest_framework.viewsets import ModelViewSet
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from django.utils import timezone
from .models import Complaint, ComplaintAssignment, ComplaintResolution
from .serializers import ComplaintSerializer, ComplaintAssignmentSerializer, ComplaintResolutionSerializer
from backend.apps.users.permissions import IsOperationsRole, IsPlatformRole


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success, "data": data, "message": message,
        "errors": errors, "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


class ComplaintViewSet(ModelViewSet):
    serializer_class = ComplaintSerializer
    filterset_fields = ["status", "complaint_type", "tenant_id"]
    search_fields = ["complaint_no", "vehicle_no", "passenger_name"]
    ordering_fields = ["submitted_at", "status"]

    def get_queryset(self):
        return Complaint.objects.filter(is_deleted=False)

    def get_permissions(self):
        if self.action == "create":
            return [AllowAny()]
        if self.action in ["assign"]:
            return [IsPlatformRole()]
        return [IsOperationsRole()]

    @action(detail=True, methods=["patch"])
    def assign(self, request, pk=None):
        complaint = self.get_object()
        serializer = ComplaintAssignmentSerializer(data={**request.data, "complaint": complaint.id})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        complaint.status = Complaint.Status.ASSIGNED
        complaint.save(update_fields=["status"])
        return api_response(data=serializer.data, message="Complaint assigned.")

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        complaint = self.get_object()
        serializer = ComplaintResolutionSerializer(data={
            **request.data,
            "complaint": complaint.id,
            "resolved_by_id": str(request.user.id),
        })
        serializer.is_valid(raise_exception=True)
        serializer.save()
        complaint.status = Complaint.Status.RESOLVED
        complaint.save(update_fields=["status"])
        return api_response(data=serializer.data, message="Complaint resolved.")
