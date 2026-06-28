from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('scheduling', '0002_trip_scheduled_arrival_time_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='trip',
            name='delay_reason',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='trip',
            name='delay_minutes',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
    ]
