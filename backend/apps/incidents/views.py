from rest_framework.viewsets import ModelViewSet
from rest_framework.response import Response
from django.utils import timezone
from .models import Incident, InsuranceClaim
from .serializers import IncidentSerializer, InsuranceClaimSerializer
from backend.apps.users.permissions import IsOperationsRole


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success, "data": data, "message": message,
        "errors": errors, "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


class IncidentViewSet(ModelViewSet):
    serializer_class = IncidentSerializer
    permission_classes = [IsOperationsRole]
    filterset_fields = ["type", "severity", "status"]
    search_fields = ["incident_no", "location", "description"]
    ordering_fields = ["reported_at", "severity"]

    def get_queryset(self):
        return Incident.objects.filter(is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(reported_by_id=self.request.user.id)


class InsuranceClaimViewSet(ModelViewSet):
    queryset = InsuranceClaim.objects.all()
    serializer_class = InsuranceClaimSerializer
    permission_classes = [IsOperationsRole]
    filterset_fields = ["status", "incident"]
