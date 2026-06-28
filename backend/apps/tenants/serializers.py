from rest_framework import serializers
from django.utils import timezone
from django.contrib.auth.password_validation import validate_password
from .models import Tenant, Domain, TenantSubscription, TenantDocument


class DomainSerializer(serializers.ModelSerializer):
    class Meta:
        model = Domain
        fields = ["id", "domain", "is_primary"]


class TenantSerializer(serializers.ModelSerializer):
    domains = DomainSerializer(many=True, read_only=True)
    subdomain = serializers.CharField(write_only=True)
    # Admin user creation fields (write-only, optional)
    admin_email = serializers.EmailField(write_only=True, required=False, allow_blank=True)
    admin_password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    admin_full_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    class Meta:
        model = Tenant
        fields = [
            "id", "name", "schema_name", "status", "plan_type",
            "logo", "branding_config",
            "contact_name", "contact_email", "contact_phone", "address", "pan_vat_number",
            "created_at", "updated_at", "domains", "subdomain",
            "admin_email", "admin_password", "admin_full_name",
        ]
        read_only_fields = ["id", "schema_name", "status", "created_at", "updated_at"]

    def validate(self, data):
        admin_email = data.get("admin_email", "").strip()
        admin_password = data.get("admin_password", "").strip()
        if admin_email and not admin_password:
            raise serializers.ValidationError({"admin_password": "Password is required when admin email is provided."})
        if admin_password and len(admin_password) < 8:
            raise serializers.ValidationError({"admin_password": "Password must be at least 8 characters."})
        return data

    def create(self, validated_data):
        from backend.apps.users.models import User

        subdomain = validated_data.pop("subdomain")
        admin_email = validated_data.pop("admin_email", "").strip()
        admin_password = validated_data.pop("admin_password", "").strip()
        admin_full_name = validated_data.pop("admin_full_name", "").strip()

        schema_name = subdomain.lower().replace("-", "_").replace(" ", "_")
        tenant = Tenant(schema_name=schema_name, **validated_data)
        tenant.save()  # creates the PostgreSQL schema via auto_create_schema = True
        Domain.objects.create(
            tenant=tenant,
            domain=f"{subdomain}.kvbms.com.np",
            is_primary=True,
        )

        # Create a COMPANY_ADMIN user in the public schema for this tenant
        if admin_email:
            user = User(
                email=admin_email,
                full_name_en=admin_full_name or f"{tenant.name} Admin",
                role=User.Role.COMPANY_ADMIN,
                tenant_schema=schema_name,
                is_active=True,
            )
            user.set_password(admin_password)
            user.save()
            tenant._created_admin = {"email": admin_email, "password": admin_password}
        else:
            tenant._created_admin = None

        return tenant


class TenantDetailSerializer(TenantSerializer):
    class Meta(TenantSerializer.Meta):
        fields = TenantSerializer.Meta.fields + []


class TenantSubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = TenantSubscription
        fields = [
            "id", "tenant", "plan", "start_date", "end_date",
            "price", "status", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class TenantDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = TenantDocument
        fields = [
            "id", "tenant", "doc_type", "file", "verified",
            "verified_by", "verified_at", "uploaded_at", "remarks",
        ]
        read_only_fields = ["id", "verified", "verified_by", "verified_at", "uploaded_at"]


class TenantAnalyticsSerializer(serializers.Serializer):
    tenant_id = serializers.UUIDField()
    tenant_name = serializers.CharField()
    status = serializers.CharField()
    plan = serializers.CharField()
    total_vehicles = serializers.IntegerField(default=0)
    active_routes = serializers.IntegerField(default=0)
    total_drivers = serializers.IntegerField(default=0)
    monthly_revenue = serializers.DecimalField(max_digits=14, decimal_places=2, default=0)
