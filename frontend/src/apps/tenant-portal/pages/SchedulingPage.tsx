import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Play, Calendar } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Table, Column } from '@components/shared/Table'
import { Badge } from '@components/shared/Badge'
import { DateDisplay } from '@components/shared/DateDisplay'
import schedulingService, { Timetable } from '@services/schedulingService'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { NepaliDateInput } from '@components/shared/NepaliDateInput'
import { NepaliTimeInput } from '@components/shared/NepaliTimeInput'
import { useState } from 'react'

interface Route {
  id: string
  route_code: string
  name_en: string
}

export default function SchedulingPage() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()
  const [selectedRoute, setSelectedRoute] = useState('')
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split('T')[0])
  const [dispatchTime, setDispatchTime] = useState('06:00')

  const { data: timetables, isLoading } = useQuery({
    queryKey: ['timetables'],
    queryFn: schedulingService.timetables.list,
  })

  const { data: routes = [] } = useQuery<Route[]>({
    queryKey: ['routes-dropdown'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/routes/?page_size=200')
      return data.data?.results ?? data.data ?? []
    },
    staleTime: 5 * 60 * 1000,
  })

  const autoScheduleMutation = useMutation({
    mutationFn: () => schedulingService.timetables.autoSchedule(selectedRoute, scheduleDate, dispatchTime),
    onSuccess: (result) => {
      toast.success(result.message || t('scheduling.toasts.autoScheduled'))
      qc.invalidateQueries({ queryKey: ['today-trips'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || (err as Error).message || t('scheduling.toasts.autoScheduleFailed'))
    },
  })

  const columns: Column<Timetable>[] = [
    { key: 'name', header: t('scheduling.timetableName') },
    { key: 'route_id', header: t('scheduling.routeId'),
      render: (row) => <code className="text-xs">{row.route_id}</code> },
    {
      key: 'effective_from',
      header: t('scheduling.effectiveFrom'),
      render: (row) => <DateDisplay date={row.effective_from} />,
    },
    {
      key: 'effective_until',
      header: t('scheduling.effectiveUntil'),
      render: (row) => row.effective_until ? <DateDisplay date={row.effective_until} /> : <span className="text-gray-400">{t('scheduling.ongoing')}</span>,
    },
    {
      key: 'is_active',
      header: t('common:common.status'),
      render: (row) => <Badge variant={row.is_active ? 'success' : 'neutral'} dot>{row.is_active ? t('common:common.active') : t('common:common.inactive')}</Badge>,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">{t('scheduling.title')}</h1>
      </div>

      {/* Auto-schedule */}
      <div className="card">
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <Calendar className="h-5 w-5 text-primary-600" />
          {t('scheduling.autoScheduleTitle')}
        </h2>
        <p className="mb-4 text-sm text-gray-500">
          {t('scheduling.autoScheduleDesc')}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] items-end">
          {/* Route */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('scheduling.route')} <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedRoute}
              onChange={(e) => setSelectedRoute(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                         focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="">{t('scheduling.selectRoute')}</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.route_code ? `${r.route_code} — ` : ''}{r.name_en}
                </option>
              ))}
            </select>
          </div>

          {/* Date */}
          <NepaliDateInput
            label={t('common:common.date')}
            required
            value={scheduleDate}
            onChange={setScheduleDate}
          />

          {/* Dispatch Time */}
          <NepaliTimeInput
            label={t('scheduling.dispatchTime')}
            required
            value={dispatchTime}
            onChange={setDispatchTime}
          />

          {/* Button */}
          <Button
            leftIcon={<Play className="h-4 w-4" />}
            onClick={() => autoScheduleMutation.mutate()}
            loading={autoScheduleMutation.isPending}
            disabled={!selectedRoute || !dispatchTime}
          >
            {t('scheduling.autoSchedule')}
          </Button>
        </div>
      </div>

      {/* Timetables */}
      <div className="card p-0">
        <div className="p-4 border-b">
          <h2 className="font-semibold">{t('scheduling.timetable')}</h2>
        </div>
        <Table
          columns={columns}
          data={timetables ?? []}
          keyExtractor={(t) => t.id}
          loading={isLoading}
        />
      </div>
    </div>
  )
}
