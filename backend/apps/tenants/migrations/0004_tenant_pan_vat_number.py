from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tenants", "0003_tenant_contact_name"),
    ]

    operations = [
        migrations.AddField(
            model_name="tenant",
            name="pan_vat_number",
            field=models.CharField(blank=True, max_length=50),
        ),
    ]
