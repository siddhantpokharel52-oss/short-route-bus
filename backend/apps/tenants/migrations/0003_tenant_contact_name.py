from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tenants", "0002_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="tenant",
            name="contact_name",
            field=models.CharField(blank=True, max_length=255),
        ),
    ]
