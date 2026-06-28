#!/bin/bash
# Seed KVBMS with initial development data
set -e

cd "$(dirname "$0")/../backend"

echo "Seeding platform data..."
python manage.py shell -c "
from backend.apps.users.models import User
from backend.apps.tenants.models import Tenant, Domain
from backend.apps.platform.models import Stop, Route, TicketType

# Create Super Admin
if not User.objects.filter(role='SUPER_ADMIN').exists():
    User.objects.create_superuser(
        email='admin@kvbms.com.np',
        password='Admin@123456',
        full_name_en='System Administrator',
        role='SUPER_ADMIN',
    )
    print('Super Admin created: admin@kvbms.com.np / Admin@123456')

# Create test tenants
for name, schema in [('Sajha Yatayat', 'sajha_yatayat'), ('Mayur Yatayat', 'mayur_yatayat'), ('Juneli Yatayat', 'juneli_yatayat')]:
    if not Tenant.objects.filter(schema_name=schema).exists():
        t = Tenant(schema_name=schema, name=name, status='ACTIVE', plan_type='STANDARD')
        t.save()
        Domain.objects.create(tenant=t, domain=f'{schema.replace(\"_\", \"-\")}.kvbms.com.np', is_primary=True)
        print(f'Tenant created: {name}')

# Seed stops
stops_data = [
    ('KTM-001', 'Ratna Park', 'रत्नपार्क', 27.7041, 85.3145, 'CENTRAL'),
    ('KTM-002', 'New Bus Park', 'नयाँ बसपार्क', 27.7103, 85.3150, 'CENTRAL'),
    ('KTM-003', 'Kalanki', 'कलंकी', 27.6933, 85.2820, 'WEST'),
    ('KTM-004', 'Koteshwor', 'कोटेश्वर', 27.6780, 85.3564, 'EAST'),
    ('KTM-005', 'Lagankhel', 'लगनखेल', 27.6644, 85.3180, 'SOUTH'),
    ('KTM-006', 'Chabahil', 'छाबहिल', 27.7199, 85.3486, 'NORTH'),
    ('KTM-007', 'Maharajgunj', 'महाराजगञ्ज', 27.7367, 85.3264, 'NORTH'),
    ('KTM-008', 'Patan Dhoka', 'पाटन ढोका', 27.6736, 85.3198, 'SOUTH'),
]
for code, name_en, name_ne, lat, lon, zone in stops_data:
    Stop.objects.get_or_create(
        stop_code=code,
        defaults={'name_en': name_en, 'name_ne': name_ne, 'latitude': lat, 'longitude': lon, 'zone': zone}
    )
print(f'Stops seeded: {Stop.objects.count()}')

# Ticket types
ticket_types = [
    ('SINGLE', 'Single Journey', 'एकल यात्रा', 4),
    ('DAILY', 'Daily Pass', 'दैनिक पास', 24),
    ('MONTHLY', 'Monthly Pass', 'मासिक पास', 720),
    ('STUDENT', 'Student Pass', 'विद्यार्थी पास', 720),
]
for code, name_en, name_ne, validity in ticket_types:
    TicketType.objects.get_or_create(
        code=code,
        defaults={'name_en': name_en, 'name_ne': name_ne, 'validity_hours': validity}
    )
print('Ticket types seeded.')
print('Seed complete!')
"
