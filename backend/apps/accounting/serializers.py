from rest_framework import serializers
from decimal import Decimal
from .models import ChartOfAccount, JournalEntry, JournalEntryLine, SalaryPayment


class ChartOfAccountSerializer(serializers.ModelSerializer):
    children_count = serializers.SerializerMethodField()
    parent_name = serializers.SerializerMethodField()

    class Meta:
        model = ChartOfAccount
        fields = [
            "id", "code", "name", "account_type", "account_nature",
            "parent", "parent_name",
            "description", "is_system", "is_active",
            "is_group", "is_posting_allowed", "level_no",
            "balance", "children_count", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "account_nature", "level_no",
            "balance", "created_at", "updated_at",
        ]

    def get_children_count(self, obj):
        return obj.children.filter(is_active=True).count()

    def get_parent_name(self, obj):
        if obj.parent_id:
            try:
                p = obj.parent
                return f"{p.code} — {p.name}"
            except Exception:
                return None
        return None

    def validate_code(self, value):
        qs = ChartOfAccount.objects.filter(code=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("An account with this code already exists.")
        return value

    def validate(self, attrs):
        # System accounts cannot be deactivated via API
        if self.instance and self.instance.is_system:
            attrs.pop("is_active", None)

        # Prevent circular parent reference
        new_parent = attrs.get("parent")
        if new_parent and self.instance:
            node = new_parent
            while node is not None:
                if node.pk == self.instance.pk:
                    raise serializers.ValidationError(
                        {"parent": "Cannot set a descendant as this account's parent (circular reference)."}
                    )
                node = node.parent if node.parent_id else None

        return attrs


class ChartOfAccountTreeSerializer(serializers.ModelSerializer):
    """Recursive nested serializer for the COA tree view (includes all fields)."""
    children = serializers.SerializerMethodField()
    children_count = serializers.SerializerMethodField()

    class Meta:
        model = ChartOfAccount
        fields = [
            "id", "code", "name", "account_type", "account_nature",
            "balance", "is_system", "is_active",
            "is_group", "is_posting_allowed", "level_no",
            "description", "children_count", "children",
        ]

    def get_children_count(self, obj):
        return obj.children.filter(is_active=True).count()

    def get_children(self, obj):
        qs = obj.children.filter(is_active=True).order_by("code")
        return ChartOfAccountTreeSerializer(qs, many=True).data


class JournalEntryLineSerializer(serializers.ModelSerializer):
    account_code = serializers.CharField(source="account.code", read_only=True)
    account_name = serializers.CharField(source="account.name", read_only=True)

    class Meta:
        model = JournalEntryLine
        fields = [
            "id", "account", "account_code", "account_name",
            "description", "debit", "credit", "vehicle_id", "route_id",
        ]

    def validate(self, attrs):
        debit = attrs.get("debit", Decimal("0"))
        credit = attrs.get("credit", Decimal("0"))
        if debit and credit:
            raise serializers.ValidationError("A line cannot have both debit and credit.")
        if not debit and not credit:
            raise serializers.ValidationError("A line must have either a debit or credit.")
        return attrs


class JournalEntrySerializer(serializers.ModelSerializer):
    lines = JournalEntryLineSerializer(many=True)
    total_debit = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    total_credit = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = JournalEntry
        fields = [
            "id", "entry_no", "date", "description", "status",
            "source_type", "source_id", "reference_no",
            "total_debit", "total_credit",
            "lines", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "entry_no", "created_at", "updated_at", "total_debit", "total_credit"]

    def validate(self, attrs):
        lines = attrs.get("lines", [])
        total_dr = sum(Decimal(str(l.get("debit", 0))) for l in lines)
        total_cr = sum(Decimal(str(l.get("credit", 0))) for l in lines)
        if lines and total_dr != total_cr:
            raise serializers.ValidationError(
                f"Journal entry does not balance: debit {total_dr} ≠ credit {total_cr}"
            )
        return attrs

    def create(self, validated_data):
        lines_data = validated_data.pop("lines", [])
        validated_data["entry_no"] = JournalEntry.generate_entry_no(validated_data["date"])
        je = JournalEntry.objects.create(**validated_data)
        for line in lines_data:
            JournalEntryLine.objects.create(journal_entry=je, **line)
        if je.status == JournalEntry.Status.POSTED:
            from backend.apps.accounting.signals import _update_balances
            _update_balances(je)
        return je

    def update(self, instance, validated_data):
        lines_data = validated_data.pop("lines", None)
        old_status = instance.status
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if lines_data is not None:
            instance.lines.all().delete()
            for line in lines_data:
                JournalEntryLine.objects.create(journal_entry=instance, **line)
        if instance.status == JournalEntry.Status.POSTED and old_status != JournalEntry.Status.POSTED:
            from backend.apps.accounting.signals import _update_balances
            _update_balances(instance)
        return instance


class SalaryPaymentSerializer(serializers.ModelSerializer):
    journal_entry_no = serializers.CharField(
        source="journal_entry.entry_no", read_only=True, default=None
    )

    class Meta:
        model = SalaryPayment
        fields = [
            "id", "employee_id", "employee_name", "employee_type",
            "period_from", "period_to", "payment_date",
            "basic_salary", "total_allowances", "deductions", "net_pay",
            "payment_method", "notes", "status",
            "journal_entry", "journal_entry_no", "created_at",
        ]
        read_only_fields = ["id", "journal_entry", "journal_entry_no", "created_at"]
