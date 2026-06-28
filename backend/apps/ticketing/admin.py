from django.contrib import admin
from .models import Ticket, DailyPass, MonthlyPass, StudentPass


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ["ticket_uid", "status", "fare_paid", "payment_method", "issued_at"]
    list_filter = ["status", "payment_method"]
    search_fields = ["ticket_uid"]
