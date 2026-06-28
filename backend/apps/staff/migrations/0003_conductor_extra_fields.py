import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("staff", "0002_add_driver_fields"),
    ]

    operations = [
        migrations.AddField(model_name="conductor", name="gender",
            field=models.CharField(blank=True, max_length=10,
                choices=[("MALE","Male"),("FEMALE","Female"),("OTHER","Other")])),
        migrations.AddField(model_name="conductor", name="dob",
            field=models.DateField(null=True, blank=True)),
        migrations.AddField(model_name="conductor", name="address",
            field=models.TextField(blank=True)),
        migrations.AddField(model_name="conductor", name="emergency_contact_name",
            field=models.CharField(blank=True, max_length=255)),
        migrations.AddField(model_name="conductor", name="emergency_contact_number",
            field=models.CharField(blank=True, max_length=20)),
        migrations.AddField(model_name="conductor", name="blood_group",
            field=models.CharField(blank=True, max_length=5)),
        migrations.AddField(model_name="conductor", name="employment_type",
            field=models.CharField(max_length=15, default="PERMANENT",
                choices=[("PERMANENT","Permanent"),("CONTRACT","Contract"),("PART_TIME","Part Time")])),
        migrations.AddField(model_name="conductor", name="date_of_joining",
            field=models.DateField(null=True, blank=True)),
        migrations.AddField(model_name="conductor", name="shift",
            field=models.CharField(blank=True, max_length=10,
                choices=[("MORNING","Morning"),("DAY","Day"),("EVENING","Evening"),("NIGHT","Night")])),
        migrations.AddField(model_name="conductor", name="assigned_vehicle_id",
            field=models.UUIDField(null=True, blank=True)),
        migrations.AddField(model_name="conductor", name="assigned_route_id",
            field=models.UUIDField(null=True, blank=True)),
    ]
