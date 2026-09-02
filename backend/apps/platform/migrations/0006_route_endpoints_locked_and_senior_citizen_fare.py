import django.core.validators
from decimal import Decimal
from django.db import migrations, models


def backfill_senior_citizen_fare(apps, schema_editor):
    """New rows always send an explicit value; existing rows had none, so
    default them to base_fare -- same "defaults to base fare" semantics the
    fare-entry UI already applies to student_fare."""
    FareMatrix = apps.get_model("platform", "FareMatrix")
    FareMatrix.objects.update(senior_citizen_fare=models.F("base_fare"))


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('platform', '0005_alter_farematrix_base_fare_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='route',
            name='endpoints_locked',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='farematrix',
            name='senior_citizen_fare',
            field=models.DecimalField(decimal_places=2, max_digits=8, default=Decimal('0'), validators=[django.core.validators.MinValueValidator(0)]),
            preserve_default=False,
        ),
        migrations.RunPython(backfill_senior_citizen_fare, noop_reverse),
    ]
