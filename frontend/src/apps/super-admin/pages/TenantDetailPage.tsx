import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Upload, CheckCircle, TrendingUp, Bus, Users } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Badge, statusVariant } from '@components/shared/Badge'
import { StatCard } from '@components/shared/StatCard'
import { DateDisplay } from '@components/shared/DateDisplay'
import tenantService, { TenantDocument } from '@services/tenantService'
import { formatNPR } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'
import toast from 'react-hot-toast'
import { useRef } from 'react'

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
    mutationFn: (docId: string) => tenantService.documents.verify(docId),
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

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('tenant', id!)
      fd.append('document_file', file)
      fd.append('document_name', file.name)
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
          <div>
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
                    {doc.document_name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {t('platform:tenantDetail.uploadedLabel')} <DateDisplay date={doc.uploaded_at} />
                    {doc.expiry_date && (
                      <> · {t('platform:tenantDetail.expiresLabel')} <DateDisplay date={doc.expiry_date} /></>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {doc.is_verified ? (
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
                  <a href={doc.document_url} target="_blank" rel="noopener" className="text-xs text-primary-600 underline">
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
                {tenant.schema_name}.kvbms.com.np
              </code>
            </dd>
          </div>
          <div>
            <dt className="text-gray-400">{t('platform:tenantDetail.registered')}</dt>
            <dd className="font-medium"><DateDisplay date={tenant.created_at} showToggle /></dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
