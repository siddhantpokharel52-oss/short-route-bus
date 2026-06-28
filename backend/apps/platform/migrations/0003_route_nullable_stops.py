from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("platform", "0002_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="route",
            name="start_stop",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="routes_as_start",
                to="platform.stop",
            ),
        ),
        migrations.AlterField(
            model_name="route",
            name="end_stop",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="routes_as_end",
                to="platform.stop",
            ),
        ),
        migrations.AlterField(
            model_name="route",
            name="distance_km",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=8),
        ),
    ]
