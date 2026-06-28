from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("ticketing", "0001_initial"),
    ]

    operations = [
        # Make trip/conductor/ticket_type nullable for POS-issued tickets
        migrations.AlterField(
            model_name="ticket",
            name="ticket_type_id",
            field=models.UUIDField(null=True, blank=True),
        ),
        migrations.AlterField(
            model_name="ticket",
            name="trip_id",
            field=models.UUIDField(null=True, blank=True),
        ),
        migrations.AlterField(
            model_name="ticket",
            name="conductor_id",
            field=models.UUIDField(null=True, blank=True),
        ),
        # Add payment_method default + more choices
        migrations.AlterField(
            model_name="ticket",
            name="payment_method",
            field=models.CharField(
                max_length=15,
                default="CASH",
                choices=[
                    ("CASH", "Cash"),
                    ("SMART_CARD", "Smart Card"),
                    ("ESEWA", "eSewa"),
                    ("KHALTI", "Khalti"),
                    ("FONEPAY", "Fonepay"),
                    ("CONNECTIPS", "ConnectIPS"),
                ],
            ),
        ),
        # New fields
        migrations.AddField(
            model_name="ticket",
            name="passenger_name",
            field=models.CharField(max_length=255, blank=True),
        ),
        migrations.AddField(
            model_name="ticket",
            name="issued_by",
            field=models.CharField(
                max_length=10,
                default="POS",
                choices=[
                    ("POS", "POS Machine"),
                    ("MOBILE", "Mobile App"),
                    ("CONDUCTOR", "Conductor"),
                ],
            ),
        ),
    ]
