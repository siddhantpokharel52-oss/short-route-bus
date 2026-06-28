from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.contrib.auth.password_validation import validate_password
from django.utils import timezone
from .models import User


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["tenant_schema"] = user.tenant_schema
        token["full_name"] = user.full_name_en
        token["language"] = user.language_preference
        return token

    def validate(self, attrs):
        email = attrs.get("email", "").lower()
        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            raise serializers.ValidationError({"detail": "Invalid credentials."})

        if user.is_locked:
            raise serializers.ValidationError({
                "detail": f"Account locked until {user.locked_until.strftime('%Y-%m-%d %H:%M UTC')}."
            })

        data = super().validate(attrs)
        user.reset_failed_login()

        # Include user profile fields in the response body (not just JWT payload)
        data["role"] = user.role
        data["tenant_schema"] = user.tenant_schema or ""
        data["full_name"] = user.full_name_en or ""
        data["language"] = user.language_preference or "en"
        data["user_id"] = str(user.id)
        data["requires_2fa"] = getattr(user, "is_2fa_enabled", False)
        return data


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id", "email", "full_name_en", "full_name_ne", "phone",
            "role", "language_preference", "is_active", "is_2fa_enabled",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])
    password_confirm = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = [
            "email", "full_name_en", "full_name_ne", "phone",
            "role", "language_preference", "password", "password_confirm",
        ]

    def validate(self, data):
        if data["password"] != data.pop("password_confirm"):
            raise serializers.ValidationError({"password_confirm": "Passwords do not match."})
        return data

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, validators=[validate_password])
    new_password_confirm = serializers.CharField(write_only=True)

    def validate(self, data):
        if data["new_password"] != data["new_password_confirm"]:
            raise serializers.ValidationError({"new_password_confirm": "Passwords do not match."})
        return data
