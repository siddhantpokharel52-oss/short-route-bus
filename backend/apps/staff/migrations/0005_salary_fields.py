from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("staff", "0004_alter_conductor_shift"),
    ]

    operations = [
        # Driver salary fields
        migrations.AddField(
            model_name="driver",
            name="basic_salary",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name="driver",
            name="allowances",
            field=models.JSONField(blank=True, default=list),
        ),
        # Conductor salary fields
        migrations.AddField(
            model_name="conductor",
            name="basic_salary",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name="conductor",
            name="allowances",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
