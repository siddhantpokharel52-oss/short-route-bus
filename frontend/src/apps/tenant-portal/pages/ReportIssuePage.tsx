import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Send, Bug } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Badge, statusVariant } from '@components/shared/Badge'
import { DateDisplay } from '@components/shared/DateDisplay'
import apiClient from '@services/api'
import toast from 'react-hot-toast'

interface IssueReport {
  id: string
  category: string
  subject: string
  description: string
  status: string
  created_at: string
}

interface IssueReportForm {
  category: string
  subject: string
  description: string
}

const CATEGORIES = ['BUG', 'QUESTION', 'FEATURE_REQUEST', 'OTHER'] as const

/** "Report Issue" in the Profile menu -- the one item with no existing
 * page to split out of. Deliberately its own model (StaffIssueReport,
 * backend/apps/complaints/) rather than reusing the passenger-facing
 * Complaint model -- that one is about bus service quality (late bus,
 * driver behavior), this one is a staff member reporting a problem with
 * the app itself. Self-service: create your own, see your own list with
 * its current status. */
export default function ReportIssuePage() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()

  const { register, handleSubmit, reset, formState: { errors } } = useForm<IssueReportForm>({
    defaultValues: { category: 'BUG' },
  })

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['my-issue-reports'],
    queryFn: async () => {
      const { data } = await apiClient.get('/operator/complaints/my-issue-reports/')
      return (data.data?.results ?? data.data ?? []) as IssueReport[]
    },
  })

  const submitMutation = useMutation({
    mutationFn: (payload: IssueReportForm) => apiClient.post('/operator/complaints/my-issue-reports/', payload),
    onSuccess: () => {
      toast.success(t('reportIssue.toasts.submitted', { defaultValue: 'Report submitted.' }))
      reset({ category: 'BUG', subject: '', description: '' })
      qc.invalidateQueries({ queryKey: ['my-issue-reports'] })
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || t('reportIssue.toasts.submitFailed', { defaultValue: 'Failed to submit report.' }))
    },
  })

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">{t('profile.reportIssue', { defaultValue: 'Report Issue' })}</h1>
        <p className="page-subtitle">
          {t('reportIssue.subtitle', { defaultValue: "Tell us about a bug, question, or something that isn't working" })}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 font-semibold">
            <Bug className="h-5 w-5 text-primary-600" />
            {t('reportIssue.newReport', { defaultValue: 'New Report' })}
          </h2>
          <form onSubmit={handleSubmit((d) => submitMutation.mutate(d))} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t('reportIssue.category', { defaultValue: 'Category' })}
              </label>
              <select
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                {...register('category', { required: true })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`reportIssue.categories.${c}`, { defaultValue: c.replace('_', ' ') })}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t('reportIssue.subject', { defaultValue: 'Subject' })}
              </label>
              <input
                type="text"
                placeholder={t('reportIssue.subjectPlaceholder', { defaultValue: 'e.g. Save button does nothing on Edit Driver' })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                {...register('subject', { required: t('reportIssue.subjectRequired', { defaultValue: 'Subject is required' }) })}
              />
              {errors.subject && <p className="mt-1 text-xs text-red-600">{errors.subject.message}</p>}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t('reportIssue.description', { defaultValue: 'Description' })}
              </label>
              <textarea
                rows={5}
                placeholder={t('reportIssue.descriptionPlaceholder', { defaultValue: 'What happened, and what did you expect instead?' })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                {...register('description', { required: t('reportIssue.descriptionRequired', { defaultValue: 'Description is required' }) })}
              />
              {errors.description && <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>}
            </div>
            <Button type="submit" loading={submitMutation.isPending} leftIcon={<Send className="h-4 w-4" />}>
              {t('reportIssue.submit', { defaultValue: 'Submit Report' })}
            </Button>
          </form>
        </div>

        <div className="card">
          <h2 className="mb-4 font-semibold">{t('reportIssue.myReports', { defaultValue: 'Your Reports' })}</h2>
          {isLoading && <p className="text-sm text-gray-400">…</p>}
          {!isLoading && reports.length === 0 && (
            <p className="text-sm text-gray-400 italic">
              {t('reportIssue.noReports', { defaultValue: "You haven't reported anything yet." })}
            </p>
          )}
          <div className="space-y-3">
            {reports.map((r) => (
              <div key={r.id} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">{r.subject}</p>
                  <Badge variant={statusVariant(r.status)} dot>
                    {t(`reportIssue.statusOptions.${r.status}`, { defaultValue: r.status.replace('_', ' ') })}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-gray-500">{r.description}</p>
                <p className="mt-2 text-[11px] text-gray-400">
                  {t(`reportIssue.categories.${r.category}`, { defaultValue: r.category.replace('_', ' ') })}
                  {' · '}
                  <DateDisplay date={r.created_at} className="inline" />
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
