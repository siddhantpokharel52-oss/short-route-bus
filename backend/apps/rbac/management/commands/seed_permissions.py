from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from backend.apps.rbac.models import Permission

MODULES = [
    {
        'module': 'Dashboard',
        'module_key': 'dashboard',
        'actions': [
            ('view', 'View Dashboard', 'Access the main operations dashboard', 1),
        ],
    },
    {
        'module': 'Fleet Management',
        'module_key': 'fleet',
        'actions': [
            ('view',   'View Fleet',        'View vehicles and fleet data',          1),
            ('add',    'Add Vehicle',        'Register new vehicles',                 2),
            ('edit',   'Edit Vehicle',       'Update vehicle information',            3),
            ('delete', 'Delete Vehicle',     'Remove vehicles from the system',       4),
            ('export', 'Export Fleet Data',  'Export fleet reports to CSV/Excel',     5),
        ],
    },
    {
        'module': 'Drivers',
        'module_key': 'drivers',
        'actions': [
            ('view',   'View Drivers',       'View driver profiles and records',      1),
            ('add',    'Add Driver',          'Register new drivers',                  2),
            ('edit',   'Edit Driver',         'Update driver information',             3),
            ('delete', 'Delete Driver',       'Soft-delete driver records',            4),
            ('export', 'Export Driver Data',  'Export driver reports',                 5),
        ],
    },
    {
        'module': 'Conductors',
        'module_key': 'conductors',
        'actions': [
            ('view',   'View Conductors',       'View conductor profiles',             1),
            ('add',    'Add Conductor',          'Register new conductors',             2),
            ('edit',   'Edit Conductor',         'Update conductor information',        3),
            ('delete', 'Delete Conductor',       'Remove conductor records',            4),
            ('export', 'Export Conductor Data',  'Export conductor reports',            5),
        ],
    },
    {
        'module': 'Routes',
        'module_key': 'routes',
        'actions': [
            ('view',   'View Routes',  'View bus routes',          1),
            ('add',    'Add Route',    'Create new bus routes',     2),
            ('edit',   'Edit Route',   'Modify route information',  3),
            ('delete', 'Delete Route', 'Remove bus routes',         4),
        ],
    },
    {
        'module': 'Bus Stops',
        'module_key': 'stops',
        'actions': [
            ('view',   'View Stops',  'View bus stops',            1),
            ('add',    'Add Stop',    'Create new bus stops',       2),
            ('edit',   'Edit Stop',   'Modify bus stop details',    3),
            ('delete', 'Delete Stop', 'Remove bus stops',           4),
        ],
    },
    {
        'module': 'Scheduling',
        'module_key': 'scheduling',
        'actions': [
            ('view',   'View Schedule',    'View trip schedules',              1),
            ('add',    'Create Trip',       'Create new trips and schedules',   2),
            ('edit',   'Edit Schedule',     'Modify trip schedules',            3),
            ('delete', 'Delete Schedule',   'Cancel or delete scheduled trips', 4),
        ],
    },
    {
        'module': 'Live Dispatch',
        'module_key': 'dispatch',
        'actions': [
            ('view', 'View Dispatch',  'View live tracking and dispatch board', 1),
            ('add',  'Dispatch Bus',   'Dispatch and assign buses to routes',   2),
            ('edit', 'Edit Dispatch',  'Update dispatch assignments',           3),
        ],
    },
    {
        'module': 'Ticketing',
        'module_key': 'ticketing',
        'actions': [
            ('view',   'View Ticketing',    'View tickets and collections',     1),
            ('add',    'Issue Ticket',       'Issue and process tickets',        2),
            ('edit',   'Edit Ticket',        'Modify ticket information',        3),
            ('delete', 'Void Ticket',        'Cancel or void tickets',           4),
            ('export', 'Export Ticket Data', 'Export ticketing reports',         5),
        ],
    },
    {
        'module': 'Maintenance',
        'module_key': 'maintenance',
        'actions': [
            ('view',   'View Maintenance',   'View maintenance records',       1),
            ('add',    'Log Maintenance',     'Log new maintenance tasks',      2),
            ('edit',   'Edit Maintenance',    'Update maintenance records',     3),
            ('delete', 'Delete Maintenance',  'Remove maintenance records',     4),
        ],
    },
    {
        'module': 'Fuel Management',
        'module_key': 'fuel',
        'actions': [
            ('view',   'View Fuel Records',  'View fuel logs',              1),
            ('add',    'Add Fuel Record',     'Log new fuel entries',        2),
            ('edit',   'Edit Fuel Record',    'Update fuel records',         3),
            ('delete', 'Delete Fuel Record',  'Remove fuel records',         4),
            ('export', 'Export Fuel Data',    'Export fuel reports',         5),
        ],
    },
    {
        'module': 'Procurement',
        'module_key': 'procurement',
        'actions': [
            ('view',    'View Procurement',       'View purchase orders and inventory', 1),
            ('add',     'Create Purchase Order',   'Create new purchase orders',         2),
            ('edit',    'Edit Purchase Order',     'Modify purchase orders',             3),
            ('delete',  'Cancel Purchase Order',   'Cancel purchase orders',             4),
            ('approve', 'Approve Purchase Order',  'Approve purchase orders',            5),
        ],
    },
    {
        'module': 'Incidents',
        'module_key': 'incidents',
        'actions': [
            ('view',   'View Incidents',   'View incident reports',          1),
            ('add',    'Report Incident',   'File new incident reports',      2),
            ('edit',   'Edit Incident',     'Update incident information',    3),
            ('delete', 'Delete Incident',   'Remove incident records',        4),
        ],
    },
    {
        'module': 'Documents',
        'module_key': 'documents',
        'actions': [
            ('view',   'View Documents',   'View uploaded documents',       1),
            ('add',    'Upload Document',   'Upload new documents',          2),
            ('edit',   'Edit Document',     'Modify document details',       3),
            ('delete', 'Delete Document',   'Remove documents',              4),
        ],
    },
    {
        'module': 'Analytics',
        'module_key': 'analytics',
        'actions': [
            ('view',   'View Analytics', 'Access analytics and reports',   1),
            ('export', 'Export Reports',  'Export analytics data',          2),
        ],
    },
    {
        'module': 'Accounting',
        'module_key': 'accounting',
        'actions': [
            ('view',    'View Accounting',      'View financial records',          1),
            ('add',     'Add Transaction',       'Record new transactions',         2),
            ('edit',    'Edit Transaction',      'Modify financial records',        3),
            ('delete',  'Delete Transaction',    'Remove financial records',        4),
            ('export',  'Export Financial Data', 'Export financial reports',        5),
            ('approve', 'Approve Transaction',   'Approve financial transactions',  6),
        ],
    },
    {
        'module': 'Notifications',
        'module_key': 'notifications',
        'actions': [
            ('view', 'View Notifications',    'Access notification center',       1),
            ('add',  'Send Notification',      'Broadcast system notifications',   2),
            ('edit', 'Manage Notifications',   'Configure notification settings',  3),
        ],
    },
    {
        'module': 'Settings',
        'module_key': 'settings',
        'actions': [
            ('view', 'View Settings', 'View company settings',   1),
            ('edit', 'Edit Settings', 'Modify company settings', 2),
        ],
    },
    {
        'module': 'User Management',
        'module_key': 'users',
        'actions': [
            ('view',   'View Users',   'View user accounts',          1),
            ('add',    'Add User',      'Create new user accounts',    2),
            ('edit',   'Edit User',     'Modify user accounts',        3),
            ('delete', 'Delete User',   'Deactivate or remove users',  4),
        ],
    },
    {
        'module': 'Roles & Permissions',
        'module_key': 'roles',
        'actions': [
            ('view',   'View Roles',   'View role configurations',      1),
            ('add',    'Create Role',   'Create new roles',              2),
            ('edit',   'Edit Role',     'Modify roles and permissions',  3),
            ('delete', 'Delete Role',   'Remove roles from the system',  4),
        ],
    },
]


class Command(BaseCommand):
    help = 'Seed the permissions table with all ERP module permissions'

    def add_arguments(self, parser):
        parser.add_argument(
            '--schema', dest='schema', default=None,
            help='Tenant schema name to seed (e.g. metro). Defaults to all tenants.',
        )
        parser.add_argument(
            '--all-tenants', action='store_true',
            help='Run against all tenant schemas.',
        )

    def _seed(self):
        created = updated = 0
        for mod in MODULES:
            for action, name, description, sort_order in mod['actions']:
                codename = f"{mod['module_key']}.{action}"
                obj, was_created = Permission.objects.get_or_create(
                    codename=codename,
                    defaults={
                        'name': name,
                        'module': mod['module'],
                        'module_key': mod['module_key'],
                        'action': action,
                        'description': description,
                        'sort_order': sort_order,
                    },
                )
                if was_created:
                    created += 1
                    self.stdout.write(f"  + {codename}")
                else:
                    changed = False
                    for field, val in [('name', name), ('module', mod['module']),
                                       ('description', description), ('sort_order', sort_order)]:
                        if getattr(obj, field) != val:
                            setattr(obj, field, val)
                            changed = True
                    if changed:
                        obj.save()
                        updated += 1
        return created, updated

    def handle(self, *args, **options):
        schema = options.get('schema')
        all_tenants = options.get('all_tenants')

        if schema:
            schemas = [schema]
        elif all_tenants:
            from backend.apps.tenants.models import Tenant
            # Use public schema to query tenant list
            with connection.cursor() as cursor:
                cursor.execute("SET search_path TO public")
            schemas = list(Tenant.objects.exclude(schema_name='public').values_list('schema_name', flat=True))
        else:
            # Default: use current schema (set by TenantSchemaMiddleware or -schema flag)
            schemas = None

        if schemas:
            for s in schemas:
                self.stdout.write(f"\n--- Schema: {s} ---")
                connection.set_schema(s)
                created, updated = self._seed()
                self.stdout.write(self.style.SUCCESS(f"  Created {created}, updated {updated}"))
            connection.set_schema_to_public()
        else:
            # No schema flag — just run against whatever schema is active
            created, updated = self._seed()
            self.stdout.write(self.style.SUCCESS(
                f"\nDone. Created {created} permissions, updated {updated}."
            ))
