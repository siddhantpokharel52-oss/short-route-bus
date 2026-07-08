from rest_framework import generics, status, views
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.tokens import RefreshToken
from django.utils import timezone
from .models import User
from .serializers import (
    CustomTokenObtainPairSerializer, UserSerializer,
    UserCreateSerializer, ChangePasswordSerializer,
)
from .permissions import IsSuperAdmin, IsPlatformRole


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer

    def post(self, request, *args, **kwargs):
        tenant_slug = request.headers.get("X-Tenant-Slug", "").strip().lower()
        email = request.data.get("email", "").lower()
        now_iso = timezone.now().isoformat()

        try:
            user = User.objects.get(email=email)

            if user.is_locked:
                return Response({
                    "success": False,
                    "data": None,
                    "message": f"Account locked until {user.locked_until.strftime('%Y-%m-%d %H:%M UTC')}.",
                    "errors": None,
                    "meta": {"timestamp": now_iso},
                }, status=status.HTTP_403_FORBIDDEN)

            # ── Portal context enforcement ──────────────────────────────────
            if tenant_slug:
                # Request arrived from a tenant subdomain.
                # Only tenant users whose tenant_schema matches the slug may log in.
                if user.is_platform_role:
                    return Response({
                        "success": False,
                        "data": None,
                        "message": "Platform administrators must log in from the main portal.",
                        "errors": {"detail": "Please use the main portal login page."},
                        "meta": {"timestamp": now_iso},
                    }, status=status.HTTP_403_FORBIDDEN)

                if (user.tenant_schema or "").lower() != tenant_slug:
                    return Response({
                        "success": False,
                        "data": None,
                        "message": "You do not belong to this company portal.",
                        "errors": {"detail": "Please log in from your own company URL."},
                        "meta": {"timestamp": now_iso},
                    }, status=status.HTTP_403_FORBIDDEN)
            else:
                # Request arrived from the main (platform) domain.
                # Tenant operational roles must use their company subdomain.
                PUBLIC_ROLES = {User.Role.PASSENGER, User.Role.STUDENT, User.Role.TOURIST}
                if not user.is_platform_role and user.role not in PUBLIC_ROLES:
                    tenant = user.tenant_schema or "your-company"
                    return Response({
                        "success": False,
                        "data": None,
                        "message": "Please log in from your company portal.",
                        "errors": {"detail": f"Use {tenant}.citybus.com.np/login to sign in."},
                        "meta": {"timestamp": now_iso},
                    }, status=status.HTTP_403_FORBIDDEN)

        except User.DoesNotExist:
            pass  # fall through to serializer which returns 401

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            try:
                user = User.objects.get(email=email)
                user.increment_failed_login()
            except User.DoesNotExist:
                pass
            return Response({
                "success": False,
                "data": None,
                "message": "Invalid credentials.",
                "errors": serializer.errors,
                "meta": {"timestamp": now_iso},
            }, status=status.HTTP_401_UNAUTHORIZED)

        return Response({
            "success": True,
            "data": serializer.validated_data,
            "message": "Login successful.",
            "errors": None,
            "meta": {"timestamp": now_iso},
        })


class LogoutView(views.APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            refresh_token = request.data["refresh"]
            token = RefreshToken(refresh_token)
            token.blacklist()
            return Response({
                "success": True,
                "data": None,
                "message": "Logged out successfully.",
                "errors": None,
                "meta": {"timestamp": timezone.now().isoformat()},
            })
        except Exception as e:
            return Response({
                "success": False,
                "data": None,
                "message": str(e),
                "errors": None,
                "meta": {"timestamp": timezone.now().isoformat()},
            }, status=status.HTTP_400_BAD_REQUEST)


class UserProfileView(generics.RetrieveUpdateAPIView):
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user

    def retrieve(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object())
        return Response({
            "success": True,
            "data": serializer.data,
            "message": "Profile retrieved.",
            "errors": None,
            "meta": {"timestamp": timezone.now().isoformat()},
        })


class UserListCreateView(generics.ListCreateAPIView):
    serializer_class = UserSerializer
    permission_classes = [IsSuperAdmin]
    queryset = User.objects.all()

    def get_serializer_class(self):
        if self.request.method == "POST":
            return UserCreateSerializer
        return UserSerializer

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(queryset, many=True)
        return Response({
            "success": True,
            "data": serializer.data,
            "message": "Users retrieved.",
            "errors": None,
            "meta": {"timestamp": timezone.now().isoformat()},
        })

    def create(self, request, *args, **kwargs):
        serializer = UserCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response({
            "success": True,
            "data": UserSerializer(user).data,
            "message": "User created successfully.",
            "errors": None,
            "meta": {"timestamp": timezone.now().isoformat()},
        }, status=status.HTTP_201_CREATED)


class ChangePasswordView(views.APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(serializer.validated_data["old_password"]):
            return Response({
                "success": False,
                "data": None,
                "message": "Old password is incorrect.",
                "errors": {"old_password": ["Incorrect password."]},
                "meta": {"timestamp": timezone.now().isoformat()},
            }, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(serializer.validated_data["new_password"])
        user.save()
        return Response({
            "success": True,
            "data": None,
            "message": "Password changed successfully.",
            "errors": None,
            "meta": {"timestamp": timezone.now().isoformat()},
        })
