import { useState, useCallback } from 'react'
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
  plan_type: 'BASIC' | 'STANDARD' | 'ENTERPRISE'
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
      toast.success(t('platform:tenants.toasts.activated'))
      qc.invalidateQueries({ queryKey: ['tenants'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const suspendMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      tenantService.suspend(id, reason),
    onSuccess: () => {
      toast.success(t('platform:tenants.toasts.suspended'))
      setSuspendTarget(null)
      setSuspendReason('')
      qc.invalidateQueries({ queryKey: ['tenants'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<CreateTenantForm>({
    defaultValues: { plan_type: 'BASIC' },
  })

  const subdomainValue = watch('subdomain') ?? ''
  const baseDomain = import.meta.env.VITE_BASE_DOMAIN || 'localhost'
  const port = window.location.port ? `:${window.location.port}` : ''
  const previewLoginUrl = subdomainValue.trim()
    ? `${window.location.protocol}//${subdomainValue.trim().toLowerCase()}.${baseDomain}${port}/login`
    : null

  const sanitizeSubdomain = useCallback((value: string) =>
    value.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, ''),
  [])

  const createMutation = useMutation({
    mutationFn: (payload: CreateTenantForm) => tenantService.create(payload),
    onSuccess: (result) => {
      toast.success(t('platform:tenants.toasts.created'))
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
      header: t('platform:tenants.contactPerson'),
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
              {t('platform:tenants.activate')}
            </Button>
          )}
          {row.status === 'ACTIVE' && (
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Ban className="h-3.5 w-3.5 text-red-600" />}
              onClick={() => setSuspendTarget(row)}
            >
              {t('platform:tenants.suspend')}
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
          placeholder={t('platform:tenants.searchPlaceholder')}
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
          <Input label={t('platform:tenants.createModal.companyName')} required error={errors.name?.message}
            {...register('name', { required: t('platform:tenants.createModal.required') })} />
          <div>
            <Input
              label={t('platform:tenants.subdomain')}
              required
              placeholder="top"
              error={errors.subdomain?.message}
              {...register('subdomain', {
                required: t('platform:tenants.createModal.required'),
                pattern: {
                  value: /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/,
                  message: 'Only lowercase letters, numbers, and hyphens — no dots or ports.',
                },
                onChange: (e) => {
                  e.target.value = sanitizeSubdomain(e.target.value)
                },
              })}
            />
            {previewLoginUrl && !errors.subdomain && (
              <p className="mt-1.5 text-xs text-gray-500">
                Login URL:{' '}
                <span className="font-mono font-medium text-primary-600">{previewLoginUrl}</span>
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Plan Type</label>
            <select
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              {...register('plan_type', { required: true })}
            >
              <option value="BASIC">Basic</option>
              <option value="STANDARD">Standard</option>
              <option value="ENTERPRISE">Enterprise</option>
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t('platform:tenants.createModal.contactNumber')}
              type="tel"
              placeholder={t('platform:tenants.createModal.contactNumberHint')}
              {...register('contact_phone')}
            />
            <Input
              label={t('platform:tenants.createModal.emailAddress')}
              type="email"
              required
              placeholder={t('platform:tenants.createModal.emailHint')}
              error={errors.contact_email?.message}
              {...register('contact_email', { required: t('platform:tenants.createModal.required') })}
            />
            <div className="sm:col-span-2">
              <Input
                label={t('platform:tenants.createModal.companyAddress')}
                placeholder={t('platform:tenants.createModal.addressHint')}
                {...register('address')}
              />
            </div>
            <Input
              label={t('platform:tenants.createModal.panVat')}
              placeholder={t('platform:tenants.createModal.panVatHint')}
              {...register('pan_vat_number')}
            />
          </div>

          {/* Admin user section */}
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-blue-600" />
              <p className="text-sm font-semibold text-blue-800">{t('platform:tenants.createModal.adminSectionTitle')}</p>
            </div>
            <p className="mb-3 text-xs text-blue-600">{t('platform:tenants.createModal.adminSectionHint')}</p>
            <div className="space-y-3">
              <Input label={t('platform:tenants.createModal.adminFullName')} placeholder={t('platform:tenants.createModal.adminFullNameHint')} {...register('admin_full_name')} />
              <Input label={t('platform:tenants.createModal.adminEmail')} type="email" placeholder="admin@sajha.com.np" {...register('admin_email')} />
              <Input label={t('platform:tenants.createModal.adminPassword')} type="text" placeholder={t('platform:tenants.createModal.adminPasswordHint')} {...register('admin_password')} />
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" onClick={() => setShowCreate(false)} type="button">{t('common:common.cancel')}</Button>
            <Button type="submit" loading={createMutation.isPending}>{t('platform:tenants.addNew')}</Button>
          </div>
        </form>
      </Modal>

      {/* Credentials modal — shown after successful creation */}
      <Modal open={!!newTenantCreds} onClose={() => setNewTenantCreds(null)} title={t('platform:tenants.credentialsModal.title')} size="sm">
        {newTenantCreds?.admin_credentials && (
          <div className="space-y-4 p-6">
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="mb-3 text-sm font-semibold text-green-800">
                {t('platform:tenants.credentialsModal.createdSuccess', { name: newTenantCreds.name })}
              </p>
              {(() => {
                const domain = (newTenantCreds.domains?.find((d) => d.is_primary) ?? newTenantCreds.domains?.[0])?.domain ?? ''
                const port = window.location.port ? `:${window.location.port}` : ''
                const loginUrl = `${window.location.protocol}//${domain}${port}/login`
                return (
                  <div className="mb-4">
                    <p className="mb-1 text-xs text-green-600">{t('platform:tenants.credentialsModal.shareNote')}</p>
                    <div className="flex items-center gap-2 rounded bg-green-100 px-3 py-2">
                      <a
                        href={loginUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 break-all font-mono text-xs font-semibold text-green-800 underline"
                      >
                        {loginUrl}
                      </a>
                      <button
                        onClick={() => { navigator.clipboard.writeText(loginUrl); toast.success(t('platform:tenants.toasts.copied')) }}
                        className="shrink-0 text-green-600 hover:text-green-800"
                        title="Copy URL"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })()}
              <div className="space-y-2 rounded-lg bg-white p-3 font-mono text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">{t('platform:tenants.credentialsModal.email')}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{newTenantCreds.admin_credentials.email}</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(newTenantCreds!.admin_credentials!.email); toast.success(t('platform:tenants.toasts.copied')) }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">{t('platform:tenants.credentialsModal.password')}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{newTenantCreds.admin_credentials.password}</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(newTenantCreds!.admin_credentials!.password); toast.success(t('platform:tenants.toasts.copied')) }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">{t('platform:tenants.credentialsModal.role')}</span>
                  <span className="font-medium text-blue-600">COMPANY_ADMIN</span>
                </div>
              </div>
            </div>
            <Button className="w-full" onClick={() => setNewTenantCreds(null)}>{t('platform:tenants.credentialsModal.done')}</Button>
          </div>
        )}
      </Modal>

      {/* Suspend modal */}
      <Modal open={!!suspendTarget} onClose={() => setSuspendTarget(null)} title={t('platform:tenants.suspendModal.title')} size="sm">
        <div className="space-y-4 p-6">
          <p className="text-sm text-gray-600">
            {t('platform:tenants.suspendModal.confirm', { name: suspendTarget?.name })}
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
              placeholder={t('platform:tenants.suspendModal.reasonPlaceholder')}
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
              {t('platform:tenants.suspend')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
