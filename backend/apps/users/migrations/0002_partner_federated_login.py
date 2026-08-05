from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='partner',
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name='user',
            name='external_partner_id',
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddIndex(
            model_name='user',
            index=models.Index(fields=['partner', 'external_partner_id'], name='users_user_partner_ce49a4_idx'),
        ),
        migrations.AddConstraint(
            model_name='user',
            constraint=models.UniqueConstraint(
                condition=models.Q(('partner__gt', '')),
                fields=('partner', 'external_partner_id'),
                name='unique_partner_external_id',
            ),
        ),
    ]
