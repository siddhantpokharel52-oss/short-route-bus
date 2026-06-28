from rest_framework import serializers
from .models import NotificationTemplate, NotificationLog, NotificationSubscription


class NotificationTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationTemplate
        fields = ["id", "code", "channel", "subject_en", "subject_ne", "body_en", "body_ne", "is_active"]
        read_only_fields = ["id"]


class NotificationLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationLog
        fields = ["id", "recipient", "channel", "template", "sent_at", "status", "error_message"]
        read_only_fields = ["id", "sent_at"]


class NotificationSubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationSubscription
        fields = ["id", "user_id", "event_type", "channel", "is_active"]
        read_only_fields = ["id"]
