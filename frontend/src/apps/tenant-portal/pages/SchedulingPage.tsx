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
import { Input } from '@components/shared/Input'
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
      toast.success(result.message || 'Auto-scheduling triggered successfully!')
      qc.invalidateQueries({ queryKey: ['today-trips'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || (err as Error).message || 'Auto-schedule failed')
    },
  })

  const columns: Column<Timetable>[] = [
    { key: 'name', header: 'Timetable Name' },
    { key: 'route_id', header: 'Route ID',
      render: (t) => <code className="text-xs">{t.route_id}</code> },
    {
      key: 'effective_from',
      header: 'Effective From',
      render: (t) => <DateDisplay date={t.effective_from} />,
    },
    {
      key: 'effective_until',
      header: 'Effective Until',
      render: (t) => t.effective_until ? <DateDisplay date={t.effective_until} /> : <span className="text-gray-400">Ongoing</span>,
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (t) => <Badge variant={t.is_active ? 'success' : 'neutral'} dot>{t.is_active ? 'Active' : 'Inactive'}</Badge>,
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
          Auto Schedule Trips
        </h2>
        <p className="mb-4 text-sm text-gray-500">
          Automatically generate trips from timetable slots.
          Max 8 hours/day per driver enforced (Nepal Labour Act 2074).
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] items-end">
          {/* Route */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Route <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedRoute}
              onChange={(e) => setSelectedRoute(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                         focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="">— Select a route —</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.route_code ? `${r.route_code} — ` : ''}{r.name_en}
                </option>
              ))}
            </select>
          </div>

          {/* Date */}
          <Input
            label="Date"
            type="date"
            required
            value={scheduleDate}
            onChange={(e) => setScheduleDate(e.target.value)}
          />

          {/* Dispatch Time */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Dispatch Time <span className="text-red-500">*</span>
            </label>
            <input
              type="time"
              required
              value={dispatchTime}
              onChange={(e) => setDispatchTime(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                         focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          {/* Button */}
          <Button
            leftIcon={<Play className="h-4 w-4" />}
            onClick={() => autoScheduleMutation.mutate()}
            loading={autoScheduleMutation.isPending}
            disabled={!selectedRoute || !dispatchTime}
          >
            Auto Schedule
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
