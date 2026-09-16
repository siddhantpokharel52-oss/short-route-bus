from rest_framework import generics, status, views
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet
from django.utils import timezone
from datetime import timedelta
from .models import (
    Vehicle, VehicleDocument, VehicleInsurance, VehicleGPS,
    VehicleCategory, VehicleGroup, GroupMember, GroupCompositionRule,
)
from .serializers import (
    VehicleSerializer, VehicleDocumentSerializer,
    VehicleInsuranceSerializer, VehicleGPSSerializer, VehicleExpiryAlertSerializer,
    VehicleCategorySerializer, VehicleGroupSerializer, GroupMemberSerializer,
    GroupCompositionRuleSerializer,
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

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return api_response(data=serializer.data, message="Vehicle updated successfully.")

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
        from backend.apps.platform.models import Route, RouteRequirement

        eligible = []
        not_eligible = []
        # Route/RouteRequirement live in the shared/public schema (platform
        # is a SHARED_APP) -- explicit for the same reason the balance
        # action in platform/views.py explicitly re-asserts its own schema
        # for its cross-schema read, rather than trusting ambient state.
        with schema_context("public"):
            routes = list(
                Route.objects.filter(is_deleted=False, status=Route.Status.APPROVED).select_related("requirement")
            )

        for route in routes:
            reasons = []
            req = getattr(route, "requirement", None)

            if group.kind == VehicleGroup.Kind.RESERVE:
                reasons.append("Reserve groups only appear on surge slots, not the regular rotation.")

            if req is not None:
                # Permit class is checked regardless of mode -- doc section
                # 4.9-4.11's worked examples test it in both per-vehicle and
                # group-level routes, unlike min_seats/require_ac/
                # allowed_categories vs. min_total_seats/min_ac_count/
                # category_bounds, which really are mode-specific.
                if req.permit_class and group.capability_permit_classes != [req.permit_class]:
                    reasons.append(f"Route requires permit class {req.permit_class} on every bus.")

                if req.mode == RouteRequirement.Mode.PER_VEHICLE:
                    if req.min_seats and group.capability_min_seats < req.min_seats:
                        reasons.append(
                            f"Route requires at least {req.min_seats} seats on every bus; "
                            f"this group's smallest member has {group.capability_min_seats}."
                        )
                    if req.require_ac and not group.capability_all_ac:
                        reasons.append("Route requires every bus to be air conditioned.")
                    if req.allowed_categories:
                        offending = sorted(set(group.capability_categories) - set(req.allowed_categories))
                        if offending:
                            reasons.append(
                                f"Route only allows categories {', '.join(req.allowed_categories)}; "
                                f"this group includes {', '.join(offending)}."
                            )
                else:  # GROUP_LEVEL
                    if req.min_total_seats and group.capability_total_seats < req.min_total_seats:
                        reasons.append(
                            f"Route requires at least {req.min_total_seats} total seats; "
                            f"this group offers {group.capability_total_seats}."
                        )
                    if req.min_ac_count and group.capability_ac_count < req.min_ac_count:
                        reasons.append(
                            f"Route requires at least {req.min_ac_count} AC buses; "
                            f"this group has {group.capability_ac_count}."
                        )
                    for code, bounds in (req.category_bounds or {}).items():
                        count = group.capability_categories.get(code, 0)
                        if bounds.get("max") is not None and count > bounds["max"]:
                            reasons.append(f"Route allows at most {bounds['max']} of {code}; this group has {count}.")
                        if bounds.get("min") is not None and count < bounds["min"]:
                            reasons.append(f"Route requires at least {bounds['min']} of {code}; this group has {count}.")

            entry = {"route_id": str(route.id), "route_code": route.route_code, "route_name": route.name_en}
            if reasons:
                not_eligible.append({**entry, "reasons": reasons})
            else:
                eligible.append(entry)

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
        from backend.apps.platform.models import RouteRequirement, RouteDemand

        day_type = request.query_params.get("day_type", "WEEKDAY")
        with schema_context("public"):
            demand_rows = list(
                RouteDemand.objects.filter(day_type=day_type, effective_to__isnull=True)
                .select_related("route", "route__requirement")
            )
        total_slots = sum(d.slot_count for d in demand_rows)
        rotating_groups = list(VehicleGroup.objects.filter(is_deleted=False, kind=VehicleGroup.Kind.ROTATING))
        total_groups = len(rotating_groups)

        def group_passes(group, req):
            if req is None:
                return True
            if req.permit_class and group.capability_permit_classes != [req.permit_class]:
                return False
            if req.mode == RouteRequirement.Mode.PER_VEHICLE:
                if req.min_seats and group.capability_min_seats < req.min_seats:
                    return False
                if req.require_ac and not group.capability_all_ac:
                    return False
                if req.allowed_categories and set(group.capability_categories) - set(req.allowed_categories):
                    return False
            else:
                if req.min_total_seats and group.capability_total_seats < req.min_total_seats:
                    return False
                if req.min_ac_count and group.capability_ac_count < req.min_ac_count:
                    return False
                for code, bounds in (req.category_bounds or {}).items():
                    count = group.capability_categories.get(code, 0)
                    if bounds.get("max") is not None and count > bounds["max"]:
                        return False
                    if bounds.get("min") is not None and count < bounds["min"]:
                        return False
            return True

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
