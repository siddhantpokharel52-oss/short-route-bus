from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_nested.routers import NestedDefaultRouter
from . import views

router = DefaultRouter()
router.register("vehicles", views.VehicleViewSet, basename="vehicle")
router.register("owners", views.OwnerViewSet, basename="owner")
router.register("categories", views.VehicleCategoryViewSet, basename="vehicle-category")
router.register("groups", views.VehicleGroupViewSet, basename="vehicle-group")
router.register("composition-rules", views.GroupCompositionRuleViewSet, basename="group-composition-rule")

vehicles_router = NestedDefaultRouter(router, "vehicles", lookup="vehicle")
vehicles_router.register("documents", views.VehicleDocumentViewSet, basename="vehicle-document")

groups_router = NestedDefaultRouter(router, "groups", lookup="group")
groups_router.register("members", views.GroupMemberViewSet, basename="group-member")
groups_router.register("drivers", views.GroupDriverAssignmentViewSet, basename="group-driver")
groups_router.register("conductors", views.GroupConductorAssignmentViewSet, basename="group-conductor")

urlpatterns = [
    path("", include(router.urls)),
    path("", include(vehicles_router.urls)),
    path("", include(groups_router.urls)),
]
