/**
 * Today's Operations Dashboard
 * ─────────────────────────────
 * Shows real-time stats for today's fleet operations:
 * total buses, routes, active/completed/delayed trips, and a live trip table.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Bus, CheckCircle2, Clock, Play,
  AlertTriangle, RefreshCw, BarChart3, Activity, Navigation, Timer,
} from 'lucide-react'
import dispatchService, { TodayTrip } from '@services/dispatchService'
import { cn } from '@utils/cn'
import { useDateFormatter } from '@hooks/useDateFormatter'
import { useTranslation } from 'react-i18next'

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({
  icon: Icon,
  label,
  value,
  color,
  sub,
}: {
  icon: React.ElementType
  label: string
  value: number | string
  color: string
  sub?: string
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
          <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
        </div>
        <div className={cn('rounded-xl p-2.5', color)}>
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>
    </div>
  )
}

// ─── Trip status badge ────────────────────────────────────────────────────────
function TripStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { color: string; label: string; icon: string }> = {
    SCHEDULED: { color: 'bg-gray-100 text-gray-600', label: 'Scheduled', icon: '🕐' },
    IN_PROGRESS: { color: 'bg-blue-100 text-blue-700', label: 'Running', icon: '▶️' },
    COMPLETED: { color: 'bg-green-100 text-green-700', label: 'Completed', icon: '✅' },
    CANCELLED: { color: 'bg-red-100 text-red-700', label: 'Cancelled', icon: '❌' },
    DELAYED: { color: 'bg-yellow-100 text-yellow-700', label: 'Delayed', icon: '⚠️' },
  }
  const c = cfg[status] ?? cfg.SCHEDULED
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', c.color)}>
      {c.icon} {c.label}
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function OperationsDashboardPage() {
  const { t } = useTranslation('tenant')
  const fmtDate = useDateFormatter()
  const qc = useQueryClient()
  const [cancelTarget, setCancelTarget] = useState<TodayTrip | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [delayTarget, setDelayTarget] = useState<TodayTrip | null>(null)
  const [delayReason, setDelayReason] = useState('')
  const [delayMinutes, setDelayMinutes] = useState<string>('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')

  // ── Fetch today's dashboard ──────────────────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['today-dashboard'],
    queryFn: dispatchService.getTodayDashboard,
    refetchInterval: 15000,  // refresh every 15 s
  })

  // ── Trip actions ─────────────────────────────────────────────────────────
  const startMutation = useMutation({
    mutationFn: (tripId: string) => dispatchService.startTrip(tripId),
    onSuccess: () => {
      toast.success('Trip started!')
      qc.invalidateQueries({ queryKey: ['today-dashboard'] })
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to start trip'),
  })

  const completeMutation = useMutation({
    mutationFn: (tripId: string) => dispatchService.completeTrip(tripId),
    onSuccess: () => {
      toast.success('Trip completed!')
      qc.invalidateQueries({ queryKey: ['today-dashboard'] })
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to complete trip'),
  })

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      dispatchService.cancelTrip(id, reason),
    onSuccess: () => {
      toast.success('Trip cancelled.')
      setCancelTarget(null)
      setCancelReason('')
      qc.invalidateQueries({ queryKey: ['today-dashboard'] })
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to cancel trip'),
  })

  const delayMutation = useMutation({
    mutationFn: ({ id, reason, minutes }: { id: string; reason: string; minutes?: number }) =>
      dispatchService.delayTrip(id, reason, minutes),
    onSuccess: () => {
      toast.success('Trip marked as delayed.')
      setDelayTarget(null)
      setDelayReason('')
      setDelayMinutes('')
      qc.invalidateQueries({ queryKey: ['today-dashboard'] })
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to mark trip as delayed'),
  })

  const stats = data?.stats
  const trips: TodayTrip[] = data?.trips ?? []
  const alerts = data?.alerts ?? []

  // Filter trips
  const filteredTrips = trips.filter((t) => {
    const matchStatus = statusFilter === 'ALL' || t.status === statusFilter
    const matchSearch =
      !search ||
      t.trip_code.toLowerCase().includes(search.toLowerCase()) ||
      (t.vehicle_registration ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (t.route_name ?? '').toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary-600" />
            {t('operations.title')}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {stats?.date ? fmtDate(new Date(stats.date + 'T00:00:00')) : '—'}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
        >
          <RefreshCw className="h-4 w-4" /> {t('operations.refresh')}
        </button>
      </div>

      {/* Alerts banner */}
      {alerts.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-900/20">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <span className="text-sm font-semibold text-red-700 dark:text-red-400">
              {alerts.length} Active Alert{alerts.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-1">
            {(alerts as Array<{ type?: string; speed?: number; vehicle_id?: string }>).slice(0, 3).map((alert, i) => (
              <p key={i} className="text-xs text-red-600">
                ⚠️ {alert.type}: Vehicle {(alert.vehicle_id ?? '').slice(0, 8)} — {alert.speed ? `${alert.speed.toFixed(0)} km/h` : ''}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={Bus} label={t('operations.stats.activeVehicles')} value={isLoading ? '—' : stats?.active_vehicles ?? 0} color="bg-primary-500" />
        <StatCard icon={Navigation} label={t('operations.stats.activeRoutes')} value={isLoading ? '—' : stats?.active_routes ?? 0} color="bg-indigo-500" />
        <StatCard icon={Clock} label={t('operations.stats.scheduled')} value={isLoading ? '—' : stats?.scheduled ?? 0} color="bg-gray-400" />
        <StatCard icon={Play} label={t('operations.stats.running')} value={isLoading ? '—' : stats?.in_progress ?? 0} color="bg-blue-500" />
        <StatCard icon={CheckCircle2} label={t('operations.stats.completed')} value={isLoading ? '—' : stats?.completed ?? 0} color="bg-green-500" />
        <StatCard icon={AlertTriangle} label={t('operations.stats.delayedCancelled')} value={isLoading ? '—' : (stats?.delayed ?? 0) + (stats?.cancelled ?? 0)} color="bg-red-500" />
      </div>

      {/* Progress bar */}
      {stats && stats.total_trips > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-700 dark:text-white">
              {t('operations.progress')}
            </span>
            <span className="text-sm text-gray-500">
              {stats.completed + stats.in_progress} / {stats.total_trips} trips
            </span>
          </div>
          <div className="h-3 rounded-full bg-gray-100 overflow-hidden flex">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${(stats.completed / stats.total_trips) * 100}%` }}
            />
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${(stats.in_progress / stats.total_trips) * 100}%` }}
            />
            <div
              className="h-full bg-yellow-400 transition-all"
              style={{ width: `${(stats.delayed / stats.total_trips) * 100}%` }}
            />
            <div
              className="h-full bg-red-400 transition-all"
              style={{ width: `${(stats.cancelled / stats.total_trips) * 100}%` }}
            />
          </div>
          <div className="flex gap-4 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />{t('operations.tripStatus.COMPLETED')}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />{t('operations.tripStatus.IN_PROGRESS')}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" />{t('operations.tripStatus.DELAYED')}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" />{t('operations.tripStatus.CANCELLED')}</span>
          </div>
        </div>
      )}

      {/* Trip table */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        {/* Table header / filters */}
        <div className="flex items-center justify-between gap-4 p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('operations.todaysTrips')} ({filteredTrips.length})
          </h2>
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search trips, bus, route…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white w-48"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              <option value="ALL">{t('operations.filters.all')}</option>
              <option value="SCHEDULED">{t('operations.filters.scheduled')}</option>
              <option value="IN_PROGRESS">{t('operations.filters.running')}</option>
              <option value="COMPLETED">{t('operations.filters.completed')}</option>
              <option value="DELAYED">{t('operations.filters.delayed')}</option>
              <option value="CANCELLED">{t('operations.filters.cancelled')}</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading today's trips…</div>
        ) : filteredTrips.length === 0 ? (
          <div className="py-16 text-center">
            <BarChart3 className="mx-auto h-10 w-10 text-gray-300 mb-2" />
            <p className="text-sm text-gray-500">No trips match your filters.</p>
            <p className="text-xs text-gray-400 mt-1">Use the Dispatch page to generate today's schedule.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-750">
                <tr>
                  {[t('operations.columns.tripCode'), t('operations.columns.bus'), t('operations.columns.route'), t('operations.columns.departure'), t('operations.columns.arrival'), t('operations.columns.status'), t('operations.columns.actions')].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider dark:text-gray-400"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredTrips.map((trip) => (
                  <tr key={trip.id} className="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                        {trip.trip_code}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">🚌</span>
                        <div>
                          <p className="text-xs font-medium text-gray-900 dark:text-white">
                            {trip.vehicle_bus_number || trip.vehicle_registration || '—'}
                          </p>
                          {trip.vehicle_registration && trip.vehicle_bus_number && (
                            <p className="text-[10px] text-gray-400">{trip.vehicle_registration}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 max-w-[180px] truncate">
                      {trip.route_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300 font-mono">
                      {trip.scheduled_departure || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300 font-mono">
                      {trip.scheduled_arrival || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <TripStatusBadge status={trip.status} />
                        {trip.status === 'DELAYED' && trip.delay_reason && (
                          <p className="mt-1 text-[10px] text-yellow-600 max-w-[160px] truncate" title={trip.delay_reason}>
                            ⚠ {trip.delay_minutes ? `+${trip.delay_minutes} min — ` : ''}{trip.delay_reason}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {/* SCHEDULED → Start or Delay */}
                        {trip.status === 'SCHEDULED' && (
                          <>
                            <button
                              onClick={() => startMutation.mutate(trip.id)}
                              disabled={startMutation.isPending}
                              className="rounded-lg bg-blue-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              ▶ Start
                            </button>
                            <button
                              onClick={() => { setDelayTarget(trip); setDelayReason(''); setDelayMinutes('') }}
                              className="rounded-lg bg-yellow-100 px-2 py-1 text-[10px] font-semibold text-yellow-700 hover:bg-yellow-200"
                            >
                              ⚠ Delay
                            </button>
                          </>
                        )}
                        {/* IN_PROGRESS → Complete or Delay */}
                        {trip.status === 'IN_PROGRESS' && (
                          <>
                            <button
                              onClick={() => completeMutation.mutate(trip.id)}
                              disabled={completeMutation.isPending}
                              className="rounded-lg bg-green-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                            >
                              ✓ Complete
                            </button>
                            <button
                              onClick={() => { setDelayTarget(trip); setDelayReason(''); setDelayMinutes('') }}
                              className="rounded-lg bg-yellow-100 px-2 py-1 text-[10px] font-semibold text-yellow-700 hover:bg-yellow-200"
                            >
                              ⚠ Delay
                            </button>
                          </>
                        )}
                        {/* DELAYED → Start (dispatch) */}
                        {trip.status === 'DELAYED' && (
                          <button
                            onClick={() => startMutation.mutate(trip.id)}
                            disabled={startMutation.isPending}
                            className="rounded-lg bg-blue-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            ▶ Dispatch
                          </button>
                        )}
                        {/* Cancel available for SCHEDULED, IN_PROGRESS, DELAYED */}
                        {['SCHEDULED', 'IN_PROGRESS', 'DELAYED'].includes(trip.status) && (
                          <button
                            onClick={() => { setCancelTarget(trip); setCancelReason('') }}
                            className="rounded-lg bg-red-100 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-200"
                          >
                            ✕ Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cancel trip modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-96 rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800">
            <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">Cancel Trip</h3>
            <p className="text-sm text-gray-500 mb-4">
              Cancel <span className="font-mono font-semibold">{cancelTarget.trip_code}</span>?
            </p>
            <textarea
              placeholder="Reason for cancellation (required)…"
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setCancelTarget(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Keep Trip
              </button>
              <button
                onClick={() => cancelReason.trim() && cancelMutation.mutate({ id: cancelTarget.id, reason: cancelReason.trim() })}
                disabled={!cancelReason.trim() || cancelMutation.isPending}
                className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cancelMutation.isPending ? 'Cancelling…' : 'Cancel Trip'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delay trip modal */}
      {delayTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[440px] rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="rounded-xl bg-yellow-100 p-2">
                <Timer className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Mark Trip as Delayed</h3>
                <p className="text-xs text-gray-500 font-mono">{delayTarget.trip_code}</p>
              </div>
            </div>

            {/* Trip info */}
            <div className="mb-4 rounded-xl bg-gray-50 dark:bg-gray-700 px-4 py-3 grid grid-cols-3 gap-3 text-xs">
              <div>
                <p className="text-gray-400">Bus</p>
                <p className="font-semibold text-gray-800 dark:text-white">
                  {delayTarget.vehicle_bus_number || delayTarget.vehicle_registration || '—'}
                </p>
              </div>
              <div>
                <p className="text-gray-400">Route</p>
                <p className="font-semibold text-gray-800 dark:text-white truncate">{delayTarget.route_name || '—'}</p>
              </div>
              <div>
                <p className="text-gray-400">
                  {delayTarget.status === 'SCHEDULED' ? 'Sched. Departure' : 'Sched. Arrival'}
                </p>
                <p className="font-semibold text-gray-800 dark:text-white">
                  {delayTarget.status === 'SCHEDULED'
                    ? (delayTarget.scheduled_departure || '—')
                    : (delayTarget.scheduled_arrival || '—')}
                </p>
              </div>
            </div>

            {/* Context banner — what the delay affects */}
            <div className={`mb-3 rounded-lg px-3 py-2 text-xs flex items-start gap-2 ${
              delayTarget.status === 'SCHEDULED'
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                : 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
            }`}>
              <span className="mt-0.5 shrink-0">{delayTarget.status === 'SCHEDULED' ? '🕐' : '▶️'}</span>
              <span>
                {delayTarget.status === 'SCHEDULED'
                  ? 'Bus has not departed — delay will push the departure time forward. All subsequent trips of this bus today will also be rescheduled.'
                  : 'Bus is already running — delay will update the estimated arrival time. All subsequent trips of this bus today will also be rescheduled.'}
              </span>
            </div>

            {/* Estimated delay */}
            <div className="mb-3">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Estimated Delay <span className="font-normal text-gray-400">(minutes, optional)</span>
              </label>
              <input
                type="number"
                min={1}
                max={300}
                placeholder="e.g. 15"
                value={delayMinutes}
                onChange={(e) => setDelayMinutes(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
              {delayMinutes && (() => {
                const isScheduled = delayTarget.status === 'SCHEDULED'
                const baseTime = isScheduled
                  ? delayTarget.scheduled_departure
                  : delayTarget.scheduled_arrival
                if (!baseTime) return null
                const [h, m] = baseTime.split(':').map(Number)
                const total = h * 60 + m + Number(delayMinutes)
                const newTime = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
                return (
                  <p className="mt-1 text-xs text-yellow-600 dark:text-yellow-400">
                    {isScheduled ? 'New estimated departure' : 'New estimated arrival'}:{' '}
                    <span className="font-semibold">{newTime}</span>
                  </p>
                )
              })()}
            </div>

            {/* Reason */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                placeholder="e.g. Heavy traffic at Ratnapark junction, vehicle breakdown, road blockage…"
                rows={3}
                value={delayReason}
                onChange={(e) => setDelayReason(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 dark:border-gray-600 dark:bg-gray-700 dark:text-white resize-none"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setDelayTarget(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300"
              >
                Back
              </button>
              <button
                onClick={() => {
                  if (!delayReason.trim()) return
                  delayMutation.mutate({
                    id: delayTarget.id,
                    reason: delayReason.trim(),
                    minutes: delayMinutes ? Number(delayMinutes) : undefined,
                  })
                }}
                disabled={!delayReason.trim() || delayMutation.isPending}
                className="flex-1 rounded-xl bg-yellow-500 py-2 text-sm font-semibold text-white hover:bg-yellow-600 disabled:opacity-50"
              >
                {delayMutation.isPending ? 'Saving…' : '⚠ Mark as Delayed'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
