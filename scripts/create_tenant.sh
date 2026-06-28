#!/bin/bash
# Usage: ./create_tenant.sh <name> <subdomain> <plan>
# Example: ./create_tenant.sh "Sajha Yatayat" sajha-yatayat STANDARD
set -e

NAME="${1:?Usage: create_tenant.sh <name> <subdomain> <plan>}"
SUBDOMAIN="${2:?Provide subdomain}"
PLAN="${3:-BASIC}"

cd "$(dirname "$0")/../backend"

python manage.py shell -c "
from backend.apps.tenants.models import Tenant, Domain
schema = '${SUBDOMAIN}'.replace('-', '_').lower()
if Tenant.objects.filter(schema_name=schema).exists():
    print(f'Tenant with schema {schema} already exists.')
else:
    t = Tenant(schema_name=schema, name='${NAME}', plan_type='${PLAN}', status='PENDING')
    t.save()
    Domain.objects.create(tenant=t, domain='${SUBDOMAIN}.kvbms.com.np', is_primary=True)
    print(f'Tenant created: ${NAME} ({schema})')
    print(f'Domain: ${SUBDOMAIN}.kvbms.com.np')
    print('Status: PENDING — upload documents and activate via admin.')
"
