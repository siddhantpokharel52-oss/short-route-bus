from rest_framework.viewsets import ModelViewSet
from rest_framework.response import Response
from django.utils import timezone
from .models import Document, DocumentAlert
from .serializers import DocumentSerializer, DocumentAlertSerializer
from backend.apps.users.permissions import IsOperationsRole


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success, "data": data, "message": message,
        "errors": errors, "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


class DocumentViewSet(ModelViewSet):
    serializer_class = DocumentSerializer
    permission_classes = [IsOperationsRole]
    filterset_fields = ["entity_type", "entity_id", "doc_category", "verified"]
    ordering_fields = ["uploaded_at", "expiry_date"]

    def get_queryset(self):
        return Document.objects.filter(is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(
            uploaded_by_id=self.request.user.id,
            file_size=self.request.FILES.get("file_path", {}).size if hasattr(self.request.FILES.get("file_path"), "size") else 0,
        )
