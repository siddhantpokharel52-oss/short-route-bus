import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Search, Check, Ban, ExternalLink, Copy, KeyRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge, statusVariant } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { DateDisplay } from '@components/shared/DateDisplay'
import { usePagination } from '@hooks/usePagination'
import tenantService, { Tenant, TenantCreateResult } from '@services/tenantService'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'

interface CreateTenantForm {
  name: string
  subdomain: string
  contact_phone: string
  contact_email: string
  address: string
  pan_vat_number: string
  admin_email: string
  admin_password: string
  admin_full_name: string
}

export default function TenantsPage() {
  const { t } = useTranslation(['common', 'platform'])
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [suspendTarget, setSuspendTarget] = useState<Tenant | null>(null)
  const [suspendReason, setSuspendReason] = useState('')

  const [totalCount, setTotalCount] = useState(0)
  const [newTenantCreds, setNewTenantCreds] = useState<TenantCreateResult | null>(null)
  const pagination = usePagination(totalCount)

  const { data, isLoading } = useQuery({
    queryKey: ['tenants', pagination.page, search],
    queryFn: async () => {
      const res = await tenantService.list({
        ...pagination.queryParams,
        ...(search && { search }),
      })
      setTotalCount(res.totalCount)
      return res.tenants
    },
  })

  const activateMutation = useMutation({
    mutationFn: (id: string) => tenantService.activate(id),
    onSuccess: () => {
      toast.success('Tenant activated!')
      qc.invalidateQueries({ queryKey: ['tenants'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const suspendMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      tenantService.suspend(id, reason),
    onSuccess: () => {
      toast.success('Tenant suspended')
      setSuspendTarget(null)
      setSuspendReason('')
      qc.invalidateQueries({ queryKey: ['tenants'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateTenantForm>()

  const createMutation = useMutation({
    mutationFn: (payload: CreateTenantForm) => tenantService.create(payload),
    onSuccess: (result) => {
      toast.success('Tenant created!')
      setShowCreate(false)
      reset()
      qc.invalidateQueries({ queryKey: ['tenants'] })
      // Show credentials modal if admin was created
      if (result?.admin_credentials) {
        setNewTenantCreds(result)
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const columns: Column<Tenant>[] = [
    {
      key: 'name',
      header: t('platform:tenants.name'),
      render: (row) => (
        <Link
          to={`/super-admin/tenants/${row.id}`}
          className="flex items-center gap-2 font-medium text-primary-600 hover:underline"
        >
          {row.name}
          <ExternalLink className="h-3 w-3" />
        </Link>
      ),
    },
    {
      key: 'schema_name',
      header: t('platform:tenants.subdomain'),
      render: (row) => (
        <code className="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700">
          {row.schema_name}
        </code>
      ),
    },
    {
      key: 'status',
      header: t('common:common.status'),
      render: (row) => (
        <Badge variant={statusVariant(row.status)} dot>
          {t(`platform:tenants.statuses.${row.status}`)}
        </Badge>
      ),
    },
    {
      key: 'contact_name',
      header: 'Contact Person',
      render: (row) => (
        <div>
          {row.contact_name && <p className="text-sm font-medium text-gray-800">{row.contact_name}</p>}
          {row.contact_email && <p className="text-xs text-gray-500">{row.contact_email}</p>}
          {row.contact_phone && <p className="text-xs text-gray-400">{row.contact_phone}</p>}
          {!row.contact_name && !row.contact_email && <span className="text-xs text-gray-300 italic">—</span>}
        </div>
      ),
    },
    {
      key: 'created_at',
      header: t('common:common.date'),
      render: (row) => <DateDisplay date={row.created_at} />,
    },
    {
      key: 'actions',
      header: t('common:common.actions'),
      render: (row) => (
        <div className="flex items-center gap-2">
          {row.status === 'PENDING' && (
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Check className="h-3.5 w-3.5 text-green-600" />}
              onClick={() => activateMutation.mutate(row.id)}
              loading={activateMutation.isPending}
            >
              Activate
            </Button>
          )}
          {row.status === 'ACTIVE' && (
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Ban className="h-3.5 w-3.5 text-red-600" />}
              onClick={() => setSuspendTarget(row)}
            >
              Suspend
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('platform:tenants.title')}</h1>
          <p className="page-subtitle">{t('platform:tenants.subtitle')}</p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
          {t('platform:tenants.addNew')}
        </Button>
      </div>

      {/* Search */}
      <div className="flex gap-3">
        <Input
          placeholder={`${t('common:common.search')} operators...`}
          leftAddon={<Search className="h-4 w-4" />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="card p-0">
        <Table
          columns={columns}
          data={data ?? []}
          keyExtractor={(row) => row.id}
          loading={isLoading}
        />
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalCount={totalCount}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
        />
      </div>

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t('platform:tenants.addNew')} size="md">
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4 p-6">
          <Input label="Company Name" required error={errors.name?.message}
            {...register('name', { required: 'Required' })} />
          <Input label="Subdomain" required placeholder="e.g. sajha → sajha.kvbms.com.np"
            error={errors.subdomain?.message}
            {...register('subdomain', { required: 'Required' })} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Contact Number"
              type="tel"
              placeholder="e.g. 9801234567"
              {...register('contact_phone')}
            />
            <Input
              label="Email Address"
              type="email"
              required
              placeholder="contact@company.com.np"
              error={errors.contact_email?.message}
              {...register('contact_email', { required: 'Required' })}
            />
            <div className="sm:col-span-2">
              <Input
                label="Company Address"
                placeholder="e.g. New Baneshwor, Kathmandu"
                {...register('address')}
              />
            </div>
            <Input
              label="PAN / VAT Number"
              placeholder="e.g. 123456789"
              {...register('pan_vat_number')}
            />
          </div>

          {/* Admin user section */}
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-blue-600" />
              <p className="text-sm font-semibold text-blue-800">Tenant Admin Login (optional)</p>
            </div>
            <p className="mb-3 text-xs text-blue-600">Create login credentials for the tenant company admin so they can access the Tenant Portal.</p>
            <div className="space-y-3">
              <Input label="Admin Full Name" placeholder="e.g. Ram Bahadur Shrestha" {...register('admin_full_name')} />
              <Input label="Admin Email" type="email" placeholder="admin@sajha.com.np" {...register('admin_email')} />
              <Input label="Admin Password" type="text" placeholder="Min 8 characters" {...register('admin_password')} />
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" onClick={() => setShowCreate(false)} type="button">Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>Create Tenant</Button>
          </div>
        </form>
      </Modal>

      {/* Credentials modal — shown after successful creation */}
      <Modal open={!!newTenantCreds} onClose={() => setNewTenantCreds(null)} title="Tenant Created — Save Credentials" size="sm">
        {newTenantCreds?.admin_credentials && (
          <div className="space-y-4 p-6">
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="mb-3 text-sm font-semibold text-green-800">
                ✅ {newTenantCreds.name} created successfully!
              </p>
              <p className="mb-4 text-xs text-green-600">
                Share these credentials with the company admin. They can log in at{' '}
                <strong>localhost:3001/login</strong>
              </p>
              <div className="space-y-2 rounded-lg bg-white p-3 font-mono text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Email:</span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{newTenantCreds.admin_credentials.email}</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(newTenantCreds!.admin_credentials!.email); toast.success('Copied!') }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Password:</span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{newTenantCreds.admin_credentials.password}</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(newTenantCreds!.admin_credentials!.password); toast.success('Copied!') }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Role:</span>
                  <span className="font-medium text-blue-600">COMPANY_ADMIN</span>
                </div>
              </div>
            </div>
            <Button className="w-full" onClick={() => setNewTenantCreds(null)}>Done — I've saved the credentials</Button>
          </div>
        )}
      </Modal>

      {/* Suspend modal */}
      <Modal open={!!suspendTarget} onClose={() => setSuspendTarget(null)} title="Suspend Tenant" size="sm">
        <div className="space-y-4 p-6">
          <p className="text-sm text-gray-600">
            Suspend <strong>{suspendTarget?.name}</strong>? This will halt their operations.
          </p>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('platform:tenants.suspendReason')} *
            </label>
            <textarea
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              rows={3}
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Reason for suspension..."
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setSuspendTarget(null)}>
              {t('common:common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={suspendMutation.isPending}
              onClick={() => suspendTarget && suspendMutation.mutate({ id: suspendTarget.id, reason: suspendReason })}
              disabled={!suspendReason.trim()}
            >
              Suspend
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
