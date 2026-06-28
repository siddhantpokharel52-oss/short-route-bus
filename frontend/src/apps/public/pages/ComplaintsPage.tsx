import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MessageSquare, CheckCircle, Search } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Badge } from '@components/shared/Badge'
import axios from 'axios'
import toast from 'react-hot-toast'

const complaintSchema = z.object({
  complaint_type: z.string().min(1),
  description: z.string().min(20, 'Please provide at least 20 characters'),
  vehicle_plate: z.string().optional(),
  route_number: z.string().optional(),
  incident_date: z.string().min(1, 'Incident date is required'),
  complainant_name: z.string().min(2, 'Name is required'),
  complainant_phone: z.string().min(10, 'Valid phone number required'),
})

type ComplaintForm = z.infer<typeof complaintSchema>

export default function ComplaintsPage() {
  const { t } = useTranslation('public')
  const [submitted, setSubmitted] = useState(false)
  const [complaintId, setComplaintId] = useState('')
  const [trackId, setTrackId] = useState('')
  const [trackResult, setTrackResult] = useState<{ status: string; complaint_type: string; created_at: string } | null>(null)

  const { register, handleSubmit, formState: { errors } } = useForm<ComplaintForm>({
    resolver: zodResolver(complaintSchema),
  })

  const submitMutation = useMutation({
    mutationFn: (payload: ComplaintForm) =>
      axios.post('/public-api/complaints/', payload).then((r) => r.data),
    onSuccess: (data) => {
      setComplaintId(data.complaint_id ?? data.id ?? 'N/A')
      setSubmitted(true)
    },
    onError: () => toast.error('Failed to submit complaint. Please try again.'),
  })

  const handleTrack = async () => {
    try {
      const { data } = await axios.get(`/public-api/complaints/${trackId}/`)
      setTrackResult(data)
    } catch {
      toast.error('Complaint not found')
    }
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <CheckCircle className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Complaint Submitted!</h2>
        <p className="text-gray-500 mb-6">
          {t('complaints.successMessage', { id: complaintId })}
        </p>
        <div className="rounded-xl bg-gray-50 p-4 text-left mb-6">
          <p className="text-sm text-gray-500">Your Complaint ID:</p>
          <p className="text-xl font-mono font-bold text-primary-600">{complaintId}</p>
          <p className="text-xs text-gray-400 mt-1">Save this ID to track your complaint status</p>
        </div>
        <Button onClick={() => setSubmitted(false)} variant="outline">
          File Another Complaint
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
            <MessageSquare className="h-5 w-5" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">{t('complaints.title')}</h1>
        </div>
        <p className="text-gray-500">{t('complaints.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Complaint form */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="font-semibold text-gray-900 mb-6">{t('complaints.addNew')}</h2>

            <form onSubmit={handleSubmit((d) => submitMutation.mutate(d))} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  {t('complaints.type')} *
                </label>
                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  {...register('complaint_type')}
                >
                  <option value="">Select type...</option>
                  {Object.entries({
                    DRIVER_BEHAVIOR: t('complaints.types.DRIVER_BEHAVIOR'),
                    CONDUCTOR_BEHAVIOR: t('complaints.types.CONDUCTOR_BEHAVIOR'),
                    OVERCHARGING: t('complaints.types.OVERCHARGING'),
                    VEHICLE_CONDITION: t('complaints.types.VEHICLE_CONDITION'),
                    PUNCTUALITY: t('complaints.types.PUNCTUALITY'),
                    SAFETY: t('complaints.types.SAFETY'),
                    OTHER: t('complaints.types.OTHER'),
                  }).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
                {errors.complaint_type && <p className="mt-1 text-xs text-red-500">Please select a complaint type</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Input label="Your Name" required error={errors.complainant_name?.message} {...register('complainant_name')} />
                <Input label="Phone Number" type="tel" required error={errors.complainant_phone?.message} {...register('complainant_phone')} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Input label={t('complaints.vehiclePlate')} {...register('vehicle_plate')} placeholder="BA 1 KHA 1234" />
                <Input label={t('complaints.routeNumber')} {...register('route_number')} placeholder="e.g. 22" />
              </div>

              <Input label={t('complaints.incidentDate')} type="date" required error={errors.incident_date?.message} {...register('incident_date')} />

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  {t('complaints.description')} * <span className="text-xs text-gray-400">(min 20 chars)</span>
                </label>
                <textarea
                  className={`w-full rounded-lg border px-3 py-2 text-sm ${errors.description ? 'border-red-400' : 'border-gray-300'}`}
                  rows={4}
                  placeholder="Describe what happened in detail..."
                  {...register('description')}
                />
                {errors.description && <p className="mt-1 text-xs text-red-500">{errors.description.message}</p>}
              </div>

              <Button type="submit" className="w-full" size="lg" loading={submitMutation.isPending}>
                {t('complaints.submit')}
              </Button>
            </form>
          </div>
        </div>

        {/* Track complaint */}
        <div>
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-4">{t('complaints.trackComplaint')}</h3>
            <div className="space-y-3">
              <Input
                placeholder="Your complaint ID..."
                value={trackId}
                onChange={(e) => setTrackId(e.target.value)}
                leftAddon={<Search className="h-4 w-4" />}
              />
              <Button variant="outline" className="w-full" onClick={handleTrack} disabled={!trackId}>
                Track
              </Button>
            </div>

            {trackResult && (
              <div className="mt-4 rounded-xl bg-gray-50 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Status</span>
                  <Badge variant={trackResult.status === 'RESOLVED' ? 'success' : trackResult.status === 'UNDER_REVIEW' ? 'warning' : 'neutral'}>
                    {t(`complaints.statuses.${trackResult.status}`)}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Type</span>
                  <span className="font-medium">{trackResult.complaint_type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Submitted</span>
                  <span>{new Date(trackResult.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
