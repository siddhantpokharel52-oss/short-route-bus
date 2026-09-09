"""
Data migration: backfill the new service_center_name/location/contact/cost
fields (0002) from the old free-text `notes` block for existing records --
the Schedule Service form used to write these into notes as
"Service Center: X\nLocation: Y\nContact: Z\nTotal Cost: NPR N\n<free notes>"
(also handling the legacy "Estimated Cost: NPR" line) instead of real
columns. Leaves `notes` holding only the actual free-text remainder,
mirroring the parsing the frontend already did at display time.
"""
from django.db import migrations
from decimal import Decimal, InvalidOperation


def parse_notes(raw):
    lines = (raw or "").split("\n")
    service_center_name = service_center_location = service_center_contact = ""
    cost = None
    free_lines = []
    for line in lines:
        if line.startswith("Service Center: "):
            service_center_name = line[len("Service Center: "):]
        elif line.startswith("Location: "):
            service_center_location = line[len("Location: "):]
        elif line.startswith("Contact: "):
            service_center_contact = line[len("Contact: "):]
        elif line.startswith("Total Cost: NPR "):
            cost = line[len("Total Cost: NPR "):]
        elif line.startswith("Estimated Cost: NPR "):
            cost = line[len("Estimated Cost: NPR "):]
        else:
            free_lines.append(line)
    cost_value = None
    if cost:
        try:
            cost_value = Decimal(cost.strip())
        except InvalidOperation:
            cost_value = None
    return service_center_name, service_center_location, service_center_contact, cost_value, "\n".join(free_lines).strip()


def backfill(apps, schema_editor):
    MaintenanceSchedule = apps.get_model("maintenance", "MaintenanceSchedule")
    for record in MaintenanceSchedule.objects.exclude(notes=""):
        name, location, contact, cost, free_notes = parse_notes(record.notes)
        if not (name or location or contact or cost is not None):
            continue
        record.service_center_name = name
        record.service_center_location = location
        record.service_center_contact = contact
        record.cost = cost
        record.notes = free_notes
        record.save(update_fields=[
            "service_center_name", "service_center_location",
            "service_center_contact", "cost", "notes",
        ])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("maintenance", "0002_maintenanceschedule_cost_and_more"),
    ]

    operations = [
        migrations.RunPython(backfill, noop_reverse),
    ]
