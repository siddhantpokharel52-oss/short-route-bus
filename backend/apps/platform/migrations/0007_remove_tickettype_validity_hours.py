from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('platform', '0006_route_endpoints_locked_and_senior_citizen_fare'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='tickettype',
            name='validity_hours',
        ),
    ]
