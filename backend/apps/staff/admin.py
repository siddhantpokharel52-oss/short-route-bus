from django.contrib import admin
from .models import Driver, Conductor, BusCompany, CompanyLicense


@admin.register(Driver)
class DriverAdmin(admin.ModelAdmin):
    list_display = ["employee_id", "full_name_en", "license_no", "license_expiry", "status"]
    list_filter = ["status", "employment_type"]
    search_fields = ["employee_id", "full_name_en", "license_no"]


@admin.register(Conductor)
class ConductorAdmin(admin.ModelAdmin):
    list_display = ["employee_id", "full_name_en", "phone", "status"]
    list_filter = ["status"]


@admin.register(BusCompany)
class BusCompanyAdmin(admin.ModelAdmin):
    list_display = ["company_name", "registration_no", "contact_phone"]


@admin.register(CompanyLicense)
class CompanyLicenseAdmin(admin.ModelAdmin):
    list_display = ["company", "license_type", "license_no", "expiry_date"]
