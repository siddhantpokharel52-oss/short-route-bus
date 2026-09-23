from rest_framework import generics, status, views
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet
from django.utils import timezone
from datetime import timedelta
from .models import (
    Vehicle, VehicleDocument, VehicleInsurance, VehicleGPS,
    VehicleCategory, VehicleGroup, GroupMember, GroupCompositionRule,
    GroupDriverAssignment, GroupConductorAssignment, Owner,
)
from .serializers import (
    VehicleSerializer, VehicleDocumentSerializer,
    VehicleInsuranceSerializer, VehicleGPSSerializer, VehicleExpiryAlertSerializer,
    VehicleCategorySerializer, VehicleGroupSerializer, GroupMemberSerializer,
    GroupCompositionRuleSerializer, GroupDriverAssignmentSerializer,
    GroupConductorAssignmentSerializer, OwnerSerializer,
)
from backend.apps.users.permissions import IsFleetRole, IsOperationsRole, CanViewVehicles


def api_response(data=None, message="Success", success=True, errors=None, status_code=200):
    return Response({
        "success": success,
        "data": data,
        "message": message,
        "errors": errors,
        "meta": {"timestamp": timezone.now().isoformat()},
    }, status=status_code)


class VehicleViewSet(ModelViewSet):
    serializer_class = VehicleSerializer
    permission_classes = [IsFleetRole]
    filterset_fields = ["status", "fuel_type", "make"]
    search_fields = ["registration_no", "make", "model", "chassis_no"]
    ordering_fields = ["registration_no", "make", "created_at", "status"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [CanViewVehicles()]
        return [IsFleetRole()]

    def get_queryset(self):
        return Vehicle.objects.filter(is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(created_by_id=self.request.user.id)

    def perform_update(self, serializer):
        old_status, old_category_id = serializer.instance.status, serializer.instance.category_id
        instance = serializer.save()
        if instance.status != old_status or instance.category_id != old_category_id:
            # RG-052/053: a group's derived capability profile is stale the moment
            # a member vehicle's status or category changes underneath it -- only
            # GroupMember.save()/delete() re-derives today, never this.
            for membership in instance.group_memberships.filter(valid_to__isnull=True).select_related("group"):
                membership.group.recompute_capability()

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return api_response(data=serializer.data, message="Vehicle updated successfully.")

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        from backend.apps.roster.models import Duty, RosterPeriod

        open_memberships = list(instance.group_memberships.filter(valid_to__isnull=True).select_related("group"))
        blocking_groups = [
            m.group for m in open_memberships
            if Duty.objects.filter(
                group=m.group, roster_period__is_deleted=False,
                roster_period__status__in=[RosterPeriod.Status.PUBLISHED, RosterPeriod.Status.CLOSED],
            ).exists()
        ]
        if blocking_groups:
            codes = ", ".join(sorted({g.code for g in blocking_groups}))
            return api_response(
                success=False,
                message=(
                    f"Cannot delete '{instance.registration_no}' -- it's a member of group(s) {codes}, "
                    "which have published/closed duties. Remove it from the group first."
                ),
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        for m in open_memberships:
            m.valid_to = timezone.now().date()
            m.save(update_fields=["valid_to"])  # GroupMember.save() re-triggers recompute_capability()

        return super().destroy(request, *args, **kwargs)

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["is_deleted", "deleted_at"])

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        vehicle = self.get_object()
        docs = VehicleDocumentSerializer(vehicle.documents.filter(is_deleted=False), many=True)
        return api_response(data={"documents": docs.data})

    @action(detail=False, methods=["get"], url_path="expiry-alerts")
    def expiry_alerts(self, request):
        days = int(request.query_params.get("days", 30))
        cutoff = timezone.now().date() + timedelta(days=days)
        expiring = VehicleDocument.objects.filter(
            is_deleted=False,
            expiry_date__lte=cutoff,
            expiry_date__gte=timezone.now().date(),
        ).select_related("vehicle").order_by("expiry_date")
        serializer = VehicleExpiryAlertSerializer(expiring, many=True)
        return api_response(
            data=serializer.data,
            message=f"Documents expiring within {days} days.",
        )


class VehicleDocumentViewSet(ModelViewSet):
    serializer_class = VehicleDocumentSerializer
    permission_classes = [IsFleetRole]

    def get_queryset(self):
        return VehicleDocument.objects.filter(
            vehicle_id=self.kwargs["vehicle_pk"],
            is_deleted=False,
        )

    def perform_create(self, serializer):
        vehicle = Vehicle.objects.get(pk=self.kwargs["vehicle_pk"])
        serializer.save(vehicle=vehicle)
        # Schedule expiry alert check
        from backend.apps.notifications.tasks import check_document_expiry
        check_document_expiry.delay(str(serializer.instance.id))


class OwnerViewSet(ModelViewSet):
    """A bus owner -- Team Implementation Guide §3.7. Fleet-managed like
    VehicleCategory (this is who a vehicle is assigned to via
    VehicleViewSet's own update endpoint, not a separate assignment API)."""
    serializer_class = OwnerSerializer
    permission_classes = [IsFleetRole]
    search_fields = ["name", "phone", "email"]
    ordering_fields = ["name", "created_at"]

    def get_queryset(self):
        return Owner.objects.all()


class VehicleCategoryViewSet(ModelViewSet):
    serializer_class = VehicleCategorySerializer
    permission_classes = [IsFleetRole]
    filterset_fields = ["body_class", "air_conditioned", "is_active"]
    search_fields = ["code", "name_en", "name_ne"]
    ordering_fields = ["code", "seating_capacity", "created_at"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [CanViewVehicles()]
        return [IsFleetRole()]

    def get_queryset(self):
        return VehicleCategory.objects.filter(is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(created_by_id=self.request.user.id)

    def perform_update(self, serializer):
        instance = serializer.save()
        # RG-054: a category's own attributes (air_conditioned, seating_capacity,
        # permit_class) are read live by recompute_capability(), so every group
        # with an open member in this category is now stale until re-derived.
        affected = VehicleGroup.objects.filter(
            is_deleted=False, members__valid_to__isnull=True, members__vehicle__category_id=instance.id,
        ).distinct()
        for group in affected:
            group.recompute_capability()

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        vehicle_count = instance.vehicles.filter(is_deleted=False).count()
        if vehicle_count:
            return api_response(
                success=False,
                message=f"Cannot delete '{instance.code}' -- {vehicle_count} vehicle(s) still reference it.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["is_deleted", "deleted_at"])


class VehicleGroupViewSet(ModelViewSet):
    serializer_class = VehicleGroupSerializer
    permission_classes = [IsFleetRole]
    filterset_fields = ["kind", "composition_mode", "status"]
    search_fields = ["code"]
    ordering_fields = ["code", "created_at"]

    def get_permissions(self):
        if self.action in ("list", "retrieve", "eligibility", "balance"):
            return [CanViewVehicles()]
        return [IsFleetRole()]

    def get_queryset(self):
        return VehicleGroup.objects.filter(is_deleted=False).prefetch_related(
            "members__vehicle__category"
        )

    def perform_create(self, serializer):
        serializer.save(created_by_id=self.request.user.id)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        from backend.apps.roster.models import Duty, RosterPeriod

        published_count = Duty.objects.filter(
            group=instance, roster_period__is_deleted=False,
            roster_period__status__in=[RosterPeriod.Status.PUBLISHED, RosterPeriod.Status.CLOSED],
        ).count()
        if published_count:
            return api_response(
                success=False,
                message=(
                    f"Cannot delete '{instance.code}' -- {published_count} published/closed duty(ies) "
                    "still reference it. Reassign or wait for those periods to close first."
                ),
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        # Draft-only references are cleaned up rather than left dangling --
        # unassign, don't leave a ghost pointer (RG-074/RG-041).
        Duty.objects.filter(
            group=instance, roster_period__is_deleted=False, roster_period__status=RosterPeriod.Status.DRAFT,
        ).update(group=None, source=Duty.Source.MANUAL, locked=False)

        # Free the buses -- same close-membership pattern GroupMemberViewSet.
        # perform_destroy already uses for a single membership (RG-042).
        instance.members.filter(valid_to__isnull=True).update(valid_to=timezone.now().date())

        return super().destroy(request, *args, **kwargs)

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["is_deleted", "deleted_at"])

    @action(detail=True, methods=["get"])
    def eligibility(self, request, pk=None):
        """
        GET /fleet/groups/{id}/eligibility/
        Which routes this group currently qualifies for, and why not for the
        rest -- doc section 4.8's algorithm, run live against the group's
        stored capability profile.
        """
        group = self.get_object()
        from django_tenants.utils import schema_context
        from backend.apps.platform.models import Route, RouteAssignment
        from .services import check_group_route_eligibility

        eligible = []
        not_eligible = []
        # Route/RouteRequirement live in the shared/public schema (platform
        # is a SHARED_APP) -- explicit for the same reason the balance
        # action in platform/views.py explicitly re-asserts its own schema
        # for its cross-schema read, rather than trusting ambient state.
        # Pokhara QA report: scoped to this tenant's own RouteAssignment --
        # was previously evaluating a group's eligibility against every
        # route platform-wide, including other tenants' routes/categories.
        with schema_context("public"):
            routes = list(
                Route.objects.filter(
                    is_deleted=False, status=Route.Status.APPROVED,
                    assignments__tenant__schema_name=request.user.tenant_schema,
                    assignments__status=RouteAssignment.Status.ACTIVE,
                ).select_related("requirement").distinct()
            )

        for route in routes:
            ok, reasons = check_group_route_eligibility(group, route)
            entry = {"route_id": str(route.id), "route_code": route.route_code, "route_name": route.name_en}
            if ok:
                eligible.append(entry)
            else:
                not_eligible.append({**entry, "reasons": reasons})

        return api_response(data={"eligible": eligible, "not_eligible": not_eligible})

    @action(detail=False, methods=["get"], url_path="balance")
    def balance(self, request):
        """
        GET /fleet/groups/balance/?day_type=WEEKDAY
        Doc section 6.3/6.4 -- total slots vs. rotating groups, then the same
        comparison broken out per distinct route requirement (the check that
        catches a category shortfall a flat count would miss). Lives here
        rather than on platform.RouteViewSet even though it reads route
        demand: it needs VehicleGroup (tenant-only), and requests to
        /platform/* deliberately don't carry the frontend's X-Tenant-Slug
        header (see api.ts) since platform models are shared-schema and
        don't normally need tenant switching -- this endpoint does, so it
        has to be a /fleet/* route like eligibility() above.
        """
        from django_tenants.utils import schema_context
        from backend.apps.platform.models import RouteDemand, RouteAssignment
        from .services import check_group_route_eligibility

        day_type = request.query_params.get("day_type", "WEEKDAY")
        # Pokhara QA report: scoped to this tenant's own RouteAssignment --
        # was previously pulling demand for every route platform-wide.
        with schema_context("public"):
            demand_rows = list(
                RouteDemand.objects.filter(
                    day_type=day_type, effective_to__isnull=True,
                    route__assignments__tenant__schema_name=request.user.tenant_schema,
                    route__assignments__status=RouteAssignment.Status.ACTIVE,
                ).select_related("route", "route__requirement").distinct()
            )
        total_slots = sum(d.slot_count for d in demand_rows)
        # RG-030: an empty (0-vehicle) group can never actually run a duty --
        # excluding it here (rather than in a later filter step) keeps both
        # total_rotating_groups and group_passes' per-requirement counts from
        # being inflated by supply that doesn't really exist. capability_total_seats
        # is already kept live by recompute_capability(), so this is a free filter.
        rotating_groups = list(VehicleGroup.objects.filter(
            is_deleted=False, kind=VehicleGroup.Kind.ROTATING, capability_total_seats__gt=0,
        ))
        total_groups = len(rotating_groups)

        def group_passes(group, req):
            # Reuses the eligibility rules verbatim, keyed off a synthetic
            # route stand-in since check_group_route_eligibility() only reads
            # route.requirement -- the RESERVE-kind reason doesn't apply here
            # since rotating_groups is already filtered to ROTATING.
            if req is None:
                return True
            route_stub = type("RouteStub", (), {"requirement": req})()
            ok, _ = check_group_route_eligibility(group, route_stub)
            return ok

        # Bucket demand by requirement "signature" so routes sharing an
        # identical requirement share one row, matching the doc's example
        # table (section 6.4) rather than one row per route.
        buckets = {}
        for d in demand_rows:
            req = getattr(d.route, "requirement", None)
            if req is None:
                sig, label = "no-restriction", "No restriction"
            else:
                sig = (
                    req.mode, req.min_seats, req.require_ac, tuple(sorted(req.allowed_categories or [])),
                    req.permit_class, req.min_total_seats, req.min_ac_count,
                    tuple(sorted((req.category_bounds or {}).items())),
                )
                bits = []
                if req.require_ac:
                    bits.append("AC required")
                if req.min_seats:
                    bits.append(f"min {req.min_seats} seats")
                if req.allowed_categories:
                    bits.append("categories: " + ", ".join(req.allowed_categories))
                if req.permit_class:
                    bits.append(f"permit {req.permit_class}")
                if req.min_total_seats:
                    bits.append(f"min {req.min_total_seats} total seats")
                if req.min_ac_count:
                    bits.append(f"min {req.min_ac_count} AC")
                label = "; ".join(bits) or "No restriction"
            bucket = buckets.setdefault(sig, {"label": label, "slots": 0, "req": req})
            bucket["slots"] += d.slot_count

        per_requirement = [
            {
                "requirement": b["label"],
                "slots_needing_it": b["slots"],
                "eligible_groups": (eligible := sum(1 for g in rotating_groups if group_passes(g, b["req"]))),
                "status": "Fine" if eligible >= b["slots"] else f"Short by {b['slots'] - eligible}",
            }
            for b in buckets.values()
        ]

        if total_slots == total_groups:
            overall = "Balanced"
        elif total_groups > total_slots:
            overall = f"{total_groups - total_slots} groups idle"
        else:
            overall = f"{total_slots - total_groups} slots unfilled"

        return api_response(data={
            "day_type": day_type,
            "total_slots": total_slots,
            "total_rotating_groups": total_groups,
            "status": overall,
            "per_requirement": per_requirement,
        })


class GroupMemberViewSet(ModelViewSet):
    serializer_class = GroupMemberSerializer
    permission_classes = [IsFleetRole]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        return GroupMember.objects.filter(group_id=self.kwargs["group_pk"], valid_to__isnull=True)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["group"] = VehicleGroup.objects.get(pk=self.kwargs["group_pk"])
        return context

    def perform_create(self, serializer):
        group = VehicleGroup.objects.get(pk=self.kwargs["group_pk"])
        serializer.save(group=group)

    def perform_destroy(self, instance):
        # Closes the membership (time-ranged, doc section 13) rather than a
        # hard delete -- GroupMember.save() below re-triggers the capability
        # recompute either way.
        instance.valid_to = timezone.now().date()
        instance.save(update_fields=["valid_to"])


class GroupCompositionRuleViewSet(ModelViewSet):
    serializer_class = GroupCompositionRuleSerializer
    permission_classes = [IsFleetRole]

    def get_queryset(self):
        return GroupCompositionRule.objects.all()


class GroupDriverAssignmentViewSet(ModelViewSet):
    serializer_class = GroupDriverAssignmentSerializer
    permission_classes = [IsFleetRole]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        return GroupDriverAssignment.objects.filter(group_id=self.kwargs["group_pk"], valid_to__isnull=True)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["group"] = VehicleGroup.objects.get(pk=self.kwargs["group_pk"])
        return context

    def perform_create(self, serializer):
        group = VehicleGroup.objects.get(pk=self.kwargs["group_pk"])
        serializer.save(group=group)

    def perform_destroy(self, instance):
        instance.valid_to = timezone.now().date()
        instance.save(update_fields=["valid_to"])


class GroupConductorAssignmentViewSet(ModelViewSet):
    serializer_class = GroupConductorAssignmentSerializer
    permission_classes = [IsFleetRole]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        return GroupConductorAssignment.objects.filter(group_id=self.kwargs["group_pk"], valid_to__isnull=True)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["group"] = VehicleGroup.objects.get(pk=self.kwargs["group_pk"])
        return context

    def perform_create(self, serializer):
        group = VehicleGroup.objects.get(pk=self.kwargs["group_pk"])
        serializer.save(group=group)

    def perform_destroy(self, instance):
        instance.valid_to = timezone.now().date()
        instance.save(update_fields=["valid_to"])
