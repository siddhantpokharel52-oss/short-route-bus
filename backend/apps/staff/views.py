from rest_framework import generics, status, views
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet
from django.utils import timezone
from datetime import timedelta
from .models import (
    Driver, DriverTraining, DriverMedical, DriverAttendance,
    Conductor, ConductorAttendance, TicketCollection, BusCompany, CompanyLicense,
)
from .serializers import (
    DriverSerializer, DriverTrainingSerializer, DriverMedicalSerializer,
    DriverAttendanceSerializer, DriverPerformanceSerializer,
    ConductorSerializer, ConductorAttendanceSerializer, TicketCollectionSerializer,
    BusCompanySerializer, CompanyLicenseSerializer,
)
from backend.apps.users.permissions import IsHRRole, IsOperationsRole, IsConductor, CanViewStaff


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success,
        "data": data,
        "message": message,
        "errors": errors,
        "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


class DriverViewSet(ModelViewSet):
    serializer_class = DriverSerializer
    permission_classes = [IsHRRole]
    filterset_fields = ["status", "employment_type"]
    search_fields = ["employee_id", "full_name_en", "license_no", "phone"]
    ordering_fields = ["employee_id", "full_name_en", "created_at"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [CanViewStaff()]
        return [IsHRRole()]

    def get_queryset(self):
        return Driver.objects.filter(is_deleted=False)

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["is_deleted", "deleted_at"])

    @action(detail=True, methods=["post"], url_path="create-login")
    def create_login(self, request, pk=None):
        """
        POST /staff/drivers/{id}/create-login/
        Pokhara QA report: a Driver record created via the normal Add Driver
        form has no linked user_id, so it can never appear in a vehicle
        group's driver picker -- GroupDriverAssignment.driver_user_id is a
        required field, not optional, since that's what lets the driver's
        own future login resolve "my group" (see that model's docstring).
        Nothing in the product ever created that login until now.
        """
        driver = self.get_object()
        if driver.user_id:
            return api_response(
                success=False, message="This driver already has a login.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        email = (request.data.get("email") or "").strip().lower()
        password = request.data.get("password") or ""
        if not email or not password:
            return api_response(
                success=False, message="email and password are required.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        from backend.apps.users.models import User
        if User.objects.filter(email=email).exists():
            return api_response(
                success=False, message=f"'{email}' is already in use by another account.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        user = User(
            email=email, full_name_en=driver.full_name_en, phone=driver.phone,
            role=User.Role.DRIVER, tenant_schema=request.user.tenant_schema, is_active=True,
        )
        user.set_password(password)
        user.save()

        driver.user_id = user.id
        driver.save(update_fields=["user_id"])

        return api_response(
            data={"user_id": str(user.id), "email": user.email},
            message="Login created.", status_code=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"])
    def performance(self, request, pk=None):
        driver = self.get_object()
        records = driver.performance_records.all()
        serializer = DriverPerformanceSerializer(records, many=True)
        return api_response(data=serializer.data)

    @action(detail=True, methods=["post"])
    def training(self, request, pk=None):
        driver = self.get_object()
        serializer = DriverTrainingSerializer(data={**request.data, "driver": driver.id})
        serializer.is_valid(raise_exception=True)
        serializer.save(driver=driver)
        return api_response(
            data=serializer.data,
            message="Training record added.",
            status_code=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="attendance/check-in")
    def check_in(self, request, pk=None):
        driver = self.get_object()
        today = timezone.now().date()
        attendance, created = DriverAttendance.objects.get_or_create(
            driver=driver, date=today,
            defaults={"check_in": timezone.now(), "status": DriverAttendance.AttendanceStatus.PRESENT},
        )
        if not created and attendance.check_in:
            return api_response(
                success=False,
                message="Driver already checked in today.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        if not created:
            attendance.check_in = timezone.now()
            attendance.save(update_fields=["check_in"])
        serializer = DriverAttendanceSerializer(attendance)
        return api_response(data=serializer.data, message="Check-in recorded.")

    @action(detail=True, methods=["post"], url_path="attendance/check-out")
    def check_out(self, request, pk=None):
        driver = self.get_object()
        today = timezone.now().date()
        try:
            attendance = DriverAttendance.objects.get(driver=driver, date=today)
            attendance.check_out = timezone.now()
            attendance.save(update_fields=["check_out"])
            serializer = DriverAttendanceSerializer(attendance)
            return api_response(data=serializer.data, message="Check-out recorded.")
        except DriverAttendance.DoesNotExist:
            return api_response(
                success=False,
                message="No check-in record found for today.",
                status_code=status.HTTP_404_NOT_FOUND,
            )

    @action(detail=False, methods=["get"], url_path="license-expiry-alerts")
    def license_expiry_alerts(self, request):
        days = int(request.query_params.get("days", 30))
        cutoff = timezone.now().date() + timedelta(days=days)
        expiring = Driver.objects.filter(
            is_deleted=False,
            license_expiry__lte=cutoff,
            license_expiry__gte=timezone.now().date(),
        )
        serializer = DriverSerializer(expiring, many=True)
        return api_response(data=serializer.data, message=f"Drivers with licenses expiring in {days} days.")


class ConductorViewSet(ModelViewSet):
    serializer_class = ConductorSerializer
    permission_classes = [IsHRRole]
    search_fields = ["employee_id", "full_name_en", "phone"]

    def get_queryset(self):
        return Conductor.objects.filter(is_deleted=False)

    @action(detail=True, methods=["post"], url_path="create-login")
    def create_login(self, request, pk=None):
        """
        POST /staff/conductors/{id}/create-login/
        Pokhara QA report: same gap and same fix as DriverViewSet's
        create_login() -- a Conductor created via Add Collector has no
        linked user_id, so it can never appear in a vehicle group's
        conductor picker (GroupConductorAssignment.conductor_user_id is
        required, not optional).
        """
        conductor = self.get_object()
        if conductor.user_id:
            return api_response(
                success=False, message="This conductor already has a login.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        email = (request.data.get("email") or "").strip().lower()
        password = request.data.get("password") or ""
        if not email or not password:
            return api_response(
                success=False, message="email and password are required.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        from backend.apps.users.models import User
        if User.objects.filter(email=email).exists():
            return api_response(
                success=False, message=f"'{email}' is already in use by another account.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        user = User(
            email=email, full_name_en=conductor.full_name_en, phone=conductor.phone,
            role=User.Role.CONDUCTOR, tenant_schema=request.user.tenant_schema, is_active=True,
        )
        user.set_password(password)
        user.save()

        conductor.user_id = user.id
        conductor.save(update_fields=["user_id"])

        return api_response(
            data={"user_id": str(user.id), "email": user.email},
            message="Login created.", status_code=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="attendance/check-in")
    def check_in(self, request, pk=None):
        conductor = self.get_object()
        today = timezone.now().date()
        attendance, created = ConductorAttendance.objects.get_or_create(
            conductor=conductor, date=today,
            defaults={"check_in": timezone.now()},
        )
        if not created and attendance.check_in:
            return api_response(
                success=False,
                message="Conductor already checked in today.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        serializer = ConductorAttendanceSerializer(attendance)
        return api_response(data=serializer.data, message="Check-in recorded.")

    @action(detail=True, methods=["post"], url_path="collections/submit")
    def submit_collection(self, request, pk=None):
        conductor = self.get_object()
        serializer = TicketCollectionSerializer(data={**request.data, "conductor": conductor.id})
        serializer.is_valid(raise_exception=True)
        collection = serializer.save(conductor=conductor)
        return api_response(
            data=serializer.data,
            message="Collection submitted.",
            status_code=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"], url_path="collections/history")
    def collection_history(self, request, pk=None):
        conductor = self.get_object()
        collections = TicketCollection.objects.filter(conductor=conductor).order_by("-submitted_at")
        page = self.paginate_queryset(collections)
        if page is not None:
            serializer = TicketCollectionSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = TicketCollectionSerializer(collections, many=True)
        return api_response(data=serializer.data)


class BusCompanyView(generics.RetrieveUpdateAPIView):
    serializer_class = BusCompanySerializer
    permission_classes = [IsOperationsRole]

    def get_object(self):
        # Always return the first (and only) company record for this tenant.
        # Using first() prevents a duplicate being created if company_name was
        # changed away from the old get_or_create default.
        obj = BusCompany.objects.first()
        if not obj:
            obj = BusCompany.objects.create(
                company_name="Default Company",
                registration_no="",
                address="",
                contact_phone="",
            )
        return obj

    def retrieve(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object())
        return api_response(data=serializer.data)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return api_response(data=serializer.data, message="Company info updated.")


class CompanyLicenseViewSet(ModelViewSet):
    serializer_class = CompanyLicenseSerializer
    permission_classes = [IsOperationsRole]
    queryset = CompanyLicense.objects.all()


class OperatorSummaryView(views.APIView):
    permission_classes = [IsOperationsRole]

    def get(self, request):
        from backend.apps.fleet.models import Vehicle
        from backend.apps.scheduling.models import Trip
        data = {
            "total_vehicles": Vehicle.objects.filter(is_deleted=False).count(),
            "active_vehicles": Vehicle.objects.filter(status=Vehicle.Status.ACTIVE, is_deleted=False).count(),
            "in_maintenance": Vehicle.objects.filter(status=Vehicle.Status.IN_MAINTENANCE, is_deleted=False).count(),
            "total_drivers": Driver.objects.filter(is_deleted=False).count(),
            "active_drivers": Driver.objects.filter(status=Driver.Status.ACTIVE, is_deleted=False).count(),
            "total_conductors": Conductor.objects.filter(is_deleted=False).count(),
        }
        return api_response(data=data)
