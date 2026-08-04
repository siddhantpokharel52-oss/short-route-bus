from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("fleet", "0003_vehicle_bus_number_vehicle_current_conductor_id_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="vehicle",
            name="owner_name",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="vehicle",
            name="owner_phone",
            field=models.CharField(blank=True, max_length=20),
        ),
    ]
