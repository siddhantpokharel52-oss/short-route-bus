import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Upload, CheckCircle, TrendingUp, Bus, Users, KeyRound } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Modal } from '@components/shared/Modal'
import { Badge, statusVariant } from '@components/shared/Badge'
import { StatCard } from '@components/shared/StatCard'
import { DateDisplay } from '@components/shared/DateDisplay'
import tenantService, { TenantDocument, TenantDocType } from '@services/tenantService'
import { getMediaPath } from '@utils/media'
import { formatNPR } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'
import toast from 'react-hot-toast'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'

export default function TenantDetailPage() {
  const { t } = useTranslation(['common', 'platform'])
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { language } = useUiStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: tenant, isLoading } = useQuery({
    queryKey: ['tenant', id],
    queryFn: () => tenantService.get(id!),
    enabled: !!id,
  })

  const { data: analytics } = useQuery({
    queryKey: ['tenant-analytics', id],
    queryFn: () => tenantService.analytics(id!),
    enabled: !!id,
  })

  const { data: documents } = useQuery({
    queryKey: ['tenant-documents', id],
    queryFn: () => tenantService.documents.list(id!),
    enabled: !!id,
  })

  const verifyMutation = useMutation({
    mutationFn: (docId: string) => tenantService.documents.verify(id!, docId),
    onSuccess: () => {
      toast.success(t('platform:tenantDetail.toasts.documentVerified'))
      qc.invalidateQueries({ queryKey: ['tenant-documents'] })
    },
  })

  const activateMutation = useMutation({
    mutationFn: () => tenantService.activate(id!),
    onSuccess: () => {
      toast.success(t('platform:tenantDetail.toasts.activated'))
      qc.invalidateQueries({ queryKey: ['tenant', id] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const [uploadDocType, setUploadDocType] = useState<TenantDocType>('OTHER')
  const [showCreateAdmin, setShowCreateAdmin] = useState(false)
  const [newCredentials, setNewCredentials] = useState<{ email: string; password: string } | null>(null)
  const adminForm = useForm<{ admin_email: string; admin_password: string; admin_full_name: string }>()

  const createAdminMutation = useMutation({
    mutationFn: (payload: { admin_email: string; admin_password: string; admin_full_name: string }) =>
      tenantService.createAdmin(id!, payload),
    onSuccess: (credentials) => {
      setShowCreateAdmin(false)
      adminForm.reset()
      setNewCredentials(credentials)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('doc_type', uploadDocType)
      fd.append('file', file)
      return tenantService.documents.upload(id!, fd)
    },
    onSuccess: () => {
      toast.success(t('platform:tenantDetail.toasts.documentUploaded'))
      qc.invalidateQueries({ queryKey: ['tenant-documents'] })
    },
  })

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
      </div>
    )
  }

  if (!tenant) return <div>{t('platform:tenantDetail.notFound')}</div>

  const stats = analytics?.data as Record<string, number> | undefined

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link to="/super-admin/tenants" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" />
        {t('platform:tenantDetail.backToOperators')}
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">{tenant.name}</h1>
          <div className="mt-2 flex items-center gap-3">
            <Badge variant={statusVariant(tenant.status)} dot>
              {t(`platform:tenants.statuses.${tenant.status}`)}
            </Badge>
            <Badge variant="neutral">{tenant.plan_type} {t('platform:tenantDetail.planSuffix')}</Badge>
            <span className="text-sm text-gray-500">{tenant.commission_rate}% {t('platform:tenantDetail.commissionSuffix')}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            leftIcon={<KeyRound className="h-4 w-4" />}
            onClick={() => setShowCreateAdmin(true)}
          >
            Generate Credentials
          </Button>
          {tenant.status === 'PENDING' && (
            <Button
              leftIcon={<CheckCircle className="h-4 w-4" />}
              onClick={() => activateMutation.mutate()}
              loading={activateMutation.isPending}
            >
              {t('platform:tenantDetail.activateOperator')}
            </Button>
          )}
        </div>
      </div>

      {/* Analytics */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            title={t('platform:tenantDetail.totalRevenue')}
            value={formatNPR(stats.total_revenue ?? 0, language as 'en' | 'ne')}
            icon={<TrendingUp className="h-6 w-6" />}
            colorClass="text-green-600"
          />
          <StatCard
            title={t('platform:tenantDetail.platformCommission')}
            value={formatNPR(stats.platform_commission ?? 0, language as 'en' | 'ne')}
            icon={<TrendingUp className="h-6 w-6" />}
          />
          <StatCard
            title={t('platform:tenantDetail.activeVehicles')}
            value={stats.active_vehicles ?? 0}
            icon={<Bus className="h-6 w-6" />}
          />
          <StatCard
            title={t('platform:tenantDetail.totalTrips')}
            value={(stats.total_trips ?? 0).toLocaleString()}
            icon={<Users className="h-6 w-6" />}
          />
        </div>
      )}

      {/* Documents */}
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 dark:text-white">{t('platform:tenantDetail.documentsTitle')}</h2>
          <div className="flex items-center gap-2">
            <select
              value={uploadDocType}
              onChange={(e) => setUploadDocType(e.target.value as TenantDocType)}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="REGISTRATION">Company Registration</option>
              <option value="PAN">PAN Certificate</option>
              <option value="ROUTE_LICENSE">Route License</option>
              <option value="TAX_CLEARANCE">Tax Clearance</option>
              <option value="OTHER">Other</option>
            </select>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) uploadMutation.mutate(file)
              }}
            />
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Upload className="h-4 w-4" />}
              onClick={() => fileInputRef.current?.click()}
              loading={uploadMutation.isPending}
            >
              {t('platform:tenantDetail.uploadDocument')}
            </Button>
          </div>
        </div>

        {!documents?.length ? (
          <p className="text-sm text-gray-400">{t('platform:tenantDetail.noDocuments')}</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {documents.map((doc: TenantDocument) => (
              <div key={doc.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {doc.doc_type.replace('_', ' ')}
                  </p>
                  <p className="text-xs text-gray-400">
                    {t('platform:tenantDetail.uploadedLabel')} <DateDisplay date={doc.uploaded_at} />
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {doc.verified ? (
                    <Badge variant="success">
                      <CheckCircle className="mr-1 h-3 w-3" />
                      {t('platform:tenantDetail.verified')}
                    </Badge>
                  ) : (
                    <>
                      <Badge variant="warning">{t('platform:tenantDetail.pending')}</Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => verifyMutation.mutate(doc.id)}
                        loading={verifyMutation.isPending}
                      >
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        {t('platform:tenantDetail.verify')}
                      </Button>
                    </>
                  )}
                  <a href={getMediaPath(doc.file) ?? '#'} target="_blank" rel="noopener" className="text-xs text-primary-600 underline">
                    {t('platform:tenantDetail.view')}
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Contact info */}
      <div className="card">
        <h2 className="mb-4 font-semibold text-gray-900 dark:text-white">{t('platform:tenantDetail.contactInfo')}</h2>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-gray-400">{t('platform:tenantDetail.email')}</dt>
            <dd className="font-medium text-gray-900 dark:text-white">{tenant.contact_email}</dd>
          </div>
          <div>
            <dt className="text-gray-400">{t('platform:tenantDetail.phone')}</dt>
            <dd className="font-medium text-gray-900 dark:text-white">{tenant.contact_phone || '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-400">{t('platform:tenantDetail.subdomain')}</dt>
            <dd>
              <code className="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700">
                {/* The tenant's actual registered domain — never hardcode the base
                    domain here, it differs per environment (localhost in dev,
                    citybus.com.np in production) and this is the one place that
                    already carries the real value from the backend. */}
                {tenant.domains?.find((d) => d.is_primary)?.domain ?? tenant.domains?.[0]?.domain ?? tenant.schema_name}
              </code>
            </dd>
          </div>
          <div>
            <dt className="text-gray-400">{t('platform:tenantDetail.registered')}</dt>
            <dd className="font-medium"><DateDisplay date={tenant.created_at} showToggle /></dd>
          </div>
        </dl>
      </div>

      {/* Generate Credentials modal */}
      <Modal open={showCreateAdmin} onClose={() => setShowCreateAdmin(false)} title="Generate Admin Credentials" size="sm">
        <form
          onSubmit={adminForm.handleSubmit((d) => createAdminMutation.mutate(d))}
          className="space-y-4 p-6"
        >
          <p className="text-xs text-gray-500">
            Creates a Company Admin login for this tenant. Only works if this tenant doesn't already have one.
          </p>
          <Input
            label="Admin Full Name"
            placeholder={`e.g. ${tenant.name} Admin`}
            {...adminForm.register('admin_full_name')}
          />
          <Input
            label="Admin Email"
            type="email"
            required
            placeholder="admin@example.com"
            error={adminForm.formState.errors.admin_email?.message}
            {...adminForm.register('admin_email', { required: 'Admin email is required.' })}
          />
          <Input
            label="Admin Password"
            type="text"
            required
            placeholder="At least 8 characters"
            error={adminForm.formState.errors.admin_password?.message}
            {...adminForm.register('admin_password', {
              required: 'Password is required.',
              minLength: { value: 8, message: 'Password must be at least 8 characters.' },
            })}
          />
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowCreateAdmin(false)}>
              {t('common:common.cancel')}
            </Button>
            <Button type="submit" loading={createAdminMutation.isPending}>
              Generate
            </Button>
          </div>
        </form>
      </Modal>

      {/* Credentials result modal */}
      <Modal open={!!newCredentials} onClose={() => setNewCredentials(null)} title="Admin Credentials Created" size="sm">
        {newCredentials && (
          <div className="space-y-4 p-6">
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="mb-3 text-sm font-semibold text-green-800">
                Share these credentials with the operator — they won't be shown again.
              </p>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-green-600">Email</dt>
                  <dd className="font-mono font-medium text-green-900">{newCredentials.email}</dd>
                </div>
                <div>
                  <dt className="text-xs text-green-600">Password</dt>
                  <dd className="font-mono font-medium text-green-900">{newCredentials.password}</dd>
                </div>
              </dl>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setNewCredentials(null)}>{t('common:common.close')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
