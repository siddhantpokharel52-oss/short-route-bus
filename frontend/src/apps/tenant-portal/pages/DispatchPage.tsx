/**
 * Dispatcher Control Center
 * ──────────────────────────
 * Dispatcher assigns buses to routes each day, generates schedules,
 * handles breakdowns, reassigns vehicles, and monitors dispatch logs.
 *
 * Key flows:
 *  1. Generate Schedule → pick route + buses + hours → creates all daily trips
 *  2. Assign Bus        → allocate an available bus to a route
 *  3. Breakdown         → mark a bus as broken, prompts for replacement
 *  4. Reassign          → assign a replacement bus after a breakdown
 *  5. Remove            → unassign a bus from its route
 *  6. Dispatch Logs     → audit trail of all dispatcher actions
 */
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import toast from 'react-hot-toast'
import {
  Plus, Zap, RefreshCw, ArrowLeftRight, XCircle,
  Bus, Wrench, ClipboardList, Calendar, ChevronDown, ChevronUp,
  Eye, Pencil, Trash2,
} from 'lucide-react'
import dispatchService, { DailyAllocation } from '@services/dispatchService'
import fleetService, { Vehicle } from '@services/fleetService'
import apiClient, { ApiResponse } from '@services/api'
import { cn } from '@utils/cn'
import { formatDate, toNepaliDigits } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'
import { useDateFormatter } from '@hooks/useDateFormatter'
import { useTranslation } from 'react-i18next'
import { NepaliDateInput } from '@components/shared/NepaliDateInput'
import { NepaliTimeInput } from '@components/shared/NepaliTimeInput'
import { DateDisplay } from '@components/shared/DateDisplay'

// ─── Types ────────────────────────────────────────────────────────────────────
interface RouteOption { id: string; route_code: string; name_en: string }
interface DriverOption { id: string; full_name: string; employee_id: string }

// ─── Form types ───────────────────────────────────────────────────────────────
interface AssignForm {
  date: string
  route_id: string
  vehicle_id: string
  driver_id: string
  shift_start: string
  shift_end: string
}

interface GenerateForm {
  route_id: string
  date: string
  vehicle_ids: string[]
  operating_start: string
  operating_end: string
  headway_minutes: number
  trip_duration_minutes: number
  layover_minutes: number
}

// ─── Time display helper (Nepali digits when language is 'ne') ────────────────
function formatShiftTime(hhmm: string, language: string) {
  const time = hhmm.slice(0, 5)
  return language === 'ne' ? toNepaliDigits(time) : time
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function AllocationBadge({ status }: { status: string }) {
  const { t } = useTranslation('tenant')
  const cfg: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-700',
    ACTIVE: 'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-green-100 text-green-700',
    CANCELLED: 'bg-red-100 text-red-700',
  }
  return (
    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', cfg[status] ?? 'bg-gray-100 text-gray-600')}>
      {t(`dispatch.status.${status}`, { defaultValue: status })}
    </span>
  )
}

function LogActionBadge({ action }: { action: string }) {
  const { t } = useTranslation('tenant')
  const colors: Record<string, string> = {
    ASSIGN: 'bg-blue-100 text-blue-700',
    REMOVE: 'bg-orange-100 text-orange-700',
    EXTRA_TRIP: 'bg-purple-100 text-purple-700',
    BREAKDOWN: 'bg-red-100 text-red-700',
    REASSIGN: 'bg-green-100 text-green-700',
    DELAY: 'bg-yellow-100 text-yellow-700',
    GENERATE_SCHEDULE: 'bg-indigo-100 text-indigo-700',
  }
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', colors[action] ?? 'bg-gray-100 text-gray-600')}>
      {t(`dispatch.logActions.${action}`, { defaultValue: action.replace(/_/g, ' ') })}
    </span>
  )
}

// ─── Section card ─────────────────────────────────────────────────────────────
function SectionCard({
  title, icon: Icon, children, defaultOpen = true,
}: {
  title: string
  icon: React.ElementType
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary-50 p-1.5 dark:bg-primary-900/30">
            <Icon className="h-4 w-4 text-primary-600" />
          </div>
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{title}</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>
      {open && <div className="border-t border-gray-100 p-4 dark:border-gray-700">{children}</div>}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function DispatchPage() {
  const qc = useQueryClient()
  const { t } = useTranslation('tenant')
  const fmtDate = useDateFormatter()
  const { calendarType, language } = useUiStore()
  const todayDate = new Date()
  const today = todayDate.toISOString().slice(0, 10)
  const todayDisplay = formatDate(todayDate, calendarType, language as 'en' | 'ne')

  const [activeTab, setActiveTab] = useState<'allocations' | 'generate' | 'assign' | 'logs'>('allocations')
  const [breakdownTarget, setBreakdownTarget] = useState<DailyAllocation | null>(null)
  const [breakdownReason, setBreakdownReason] = useState('')
  const [reassignTarget, setReassignTarget] = useState<DailyAllocation | null>(null)
  const [replacementVehicleId, setReplacementVehicleId] = useState('')
  const [removeTarget, setRemoveTarget] = useState<DailyAllocation | null>(null)
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([])

  // ── View / Edit / Delete state ──────────────────────────────────────────────
  const [viewTarget, setViewTarget] = useState<DailyAllocation | null>(null)
  const [editTarget, setEditTarget] = useState<DailyAllocation | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DailyAllocation | null>(null)
  // Edit form fields (synced from editTarget via useEffect)
  const [editRouteId, setEditRouteId] = useState('')
  const [editVehicleId, setEditVehicleId] = useState('')
  const [editDriverId, setEditDriverId] = useState('')
  const [editShiftStart, setEditShiftStart] = useState('05:00')
  const [editShiftEnd, setEditShiftEnd] = useState('21:00')
  const [editNotes, setEditNotes] = useState('')
  const [editStatus, setEditStatus] = useState<DailyAllocation['status']>('PENDING')

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: allocations = [], refetch: refetchAllocations, isLoading: allocLoading } = useQuery({
    queryKey: ['today-allocations'],
    queryFn: dispatchService.getTodayAllocations,
    refetchInterval: 30000,
  })

  const { data: logs = [], refetch: refetchLogs, isLoading: logsLoading } = useQuery({
    queryKey: ['dispatch-logs'],
    queryFn: () => dispatchService.getLogs(today),
    enabled: activeTab === 'logs',
  })

  const { data: vehiclesRaw } = useQuery({
    queryKey: ['fleet-vehicles-dispatch'],
    queryFn: () => fleetService.vehicles.list({ status: 'ACTIVE' }),
  })
  const vehicles: Vehicle[] = vehiclesRaw?.data
    ? (Array.isArray(vehiclesRaw.data) ? vehiclesRaw.data : (vehiclesRaw.data as { results?: Vehicle[] }).results ?? [])
    : []

  const { data: routes = [] } = useQuery<RouteOption[]>({
    queryKey: ['routes-dispatch'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<{ results?: RouteOption[] } | RouteOption[]>>('/platform/routes/')
      if (Array.isArray(data.data)) return data.data
      return (data.data as { results?: RouteOption[] }).results ?? []
    },
  })

  const { data: driversRaw } = useQuery({
    queryKey: ['drivers-dispatch'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<{ results?: DriverOption[] } | DriverOption[]>>('/operator/drivers/')
      if (Array.isArray(data.data)) return data.data
      return (data.data as { results?: DriverOption[] }).results ?? []
    },
  })
  const drivers: DriverOption[] = (driversRaw ?? []) as DriverOption[]

  // ── Assign form ────────────────────────────────────────────────────────────
  const assignForm = useForm<AssignForm>({
    defaultValues: {
      date: today,
      route_id: '',
      vehicle_id: '',
      driver_id: '',
      shift_start: '05:00',
      shift_end: '21:00',
    },
  })

  const assignMutation = useMutation({
    mutationFn: (d: AssignForm) => dispatchService.createAllocation({
      date: d.date,
      route_id: d.route_id,
      vehicle_id: d.vehicle_id,
      driver_id: d.driver_id || null,
      shift_start: d.shift_start,
      shift_end: d.shift_end,
    }),
    onSuccess: () => {
      toast.success('Bus assigned to route!')
      assignForm.reset({ date: today, route_id: '', vehicle_id: '', driver_id: '', shift_start: '05:00', shift_end: '21:00' })
      qc.invalidateQueries({ queryKey: ['today-allocations'] })
      setActiveTab('allocations')
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to assign bus'),
  })

  // ── Generate schedule form ─────────────────────────────────────────────────
  const generateForm = useForm<GenerateForm>({
    defaultValues: {
      route_id: '',
      date: today,
      vehicle_ids: [],
      operating_start: '05:00',
      operating_end: '21:00',
      headway_minutes: 15,
      trip_duration_minutes: 45,
      layover_minutes: 10,
    },
  })

  const generateMutation = useMutation({
    mutationFn: (d: GenerateForm) => dispatchService.generateSchedule({
      ...d,
      vehicle_ids: selectedVehicles,
    }),
    onSuccess: (result) => {
      toast.success(`✅ Schedule generated: ${result.trips_created} trips created!`)
      generateForm.reset()
      setSelectedVehicles([])
      qc.invalidateQueries({ queryKey: ['today-allocations'] })
      qc.invalidateQueries({ queryKey: ['today-dashboard'] })
      setActiveTab('allocations')
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to generate schedule'),
  })

  // ── Dispatcher actions ─────────────────────────────────────────────────────
  const breakdownMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      dispatchService.breakdown(id, reason),
    onSuccess: () => {
      toast.success('Bus marked as breakdown. Assign a replacement.')
      setBreakdownTarget(null)
      setBreakdownReason('')
      qc.invalidateQueries({ queryKey: ['today-allocations'] })
    },
    onError: (e: Error) => toast.error(e.message || 'Failed'),
  })

  const reassignMutation = useMutation({
    mutationFn: ({ id, vehicleId }: { id: string; vehicleId: string }) =>
      dispatchService.reassign(id, vehicleId),
    onSuccess: () => {
      toast.success('Replacement bus assigned!')
      setReassignTarget(null)
      setReplacementVehicleId('')
      qc.invalidateQueries({ queryKey: ['today-allocations'] })
    },
    onError: (e: Error) => toast.error(e.message || 'Failed'),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => dispatchService.remove(id, 'Removed by dispatcher'),
    onSuccess: () => {
      toast.success('Bus removed from route.')
      setRemoveTarget(null)
      qc.invalidateQueries({ queryKey: ['today-allocations'] })
    },
    onError: (e: Error) => toast.error(e.message || 'Failed'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: {
      id: string
      data: Parameters<typeof dispatchService.updateAllocation>[1]
    }) => dispatchService.updateAllocation(id, data),
    onSuccess: () => {
      toast.success('Allocation updated.')
      setEditTarget(null)
      qc.invalidateQueries({ queryKey: ['today-allocations'] })
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to update allocation'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => dispatchService.deleteAllocation(id),
    onSuccess: () => {
      toast.success('Allocation deleted.')
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['today-allocations'] })
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to delete allocation'),
  })

  // Sync editTarget → edit form fields
  useEffect(() => {
    if (!editTarget) return
    setEditRouteId(editTarget.route_id)
    setEditVehicleId(editTarget.vehicle_id)
    setEditDriverId(editTarget.driver_id ?? '')
    setEditShiftStart(editTarget.shift_start.slice(0, 5))
    setEditShiftEnd(editTarget.shift_end.slice(0, 5))
    setEditNotes(editTarget.notes ?? '')
    setEditStatus(editTarget.status)
  }, [editTarget])

  // ── Vehicle multi-select for generate form ─────────────────────────────────
  const toggleVehicle = (id: string) =>
    setSelectedVehicles((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    )

  // Available vehicles (not already allocated today)
  const allocatedVehicleIds = new Set(
    allocations
      .filter((a) => a.status !== 'CANCELLED')
      .map((a) => a.vehicle_id)
  )
  const availableVehicles = vehicles.filter(
    (v) => !allocatedVehicleIds.has(v.id)
  )

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary-600" />
            {t('dispatch.title')}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {todayDisplay} · {allocations.filter((a) => a.status === 'ACTIVE').length} {t('dispatch.subtitle')}
          </p>
        </div>
        <button
          onClick={() => { refetchAllocations(); refetchLogs() }}
          className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
        >
          <RefreshCw className="h-4 w-4" /> {t('dispatch.buttons.refresh')}
        </button>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-3">
        {[
          { label: t('dispatch.chips.allocated'), count: allocations.filter((a) => a.status !== 'CANCELLED').length, color: 'bg-blue-50 text-blue-700' },
          { label: t('dispatch.chips.active'), count: allocations.filter((a) => a.status === 'ACTIVE').length, color: 'bg-green-50 text-green-700' },
          { label: t('dispatch.chips.available'), count: availableVehicles.length, color: 'bg-purple-50 text-purple-700' },
          { label: t('dispatch.chips.cancelled'), count: allocations.filter((a) => a.status === 'CANCELLED').length, color: 'bg-red-50 text-red-700' },
        ].map(({ label, count, color }) => (
          <div key={label} className={cn('flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold', color)}>
            <span>{count}</span>
            <span className="font-normal opacity-80">{label}</span>
          </div>
        ))}
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800 w-fit">
        {([
          { key: 'allocations', label: t('dispatch.tabs.allocations'), icon: ClipboardList },
          { key: 'generate', label: t('dispatch.tabs.generate'), icon: Zap },
          { key: 'assign', label: t('dispatch.tabs.assign'), icon: Plus },
          { key: 'logs', label: t('dispatch.tabs.logs'), icon: Calendar },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
              activeTab === key
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── TODAY'S ALLOCATIONS ───────────────────────────────────────────── */}
      {activeTab === 'allocations' && (
        <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          {allocLoading ? (
            <div className="py-16 text-center text-sm text-gray-400">{t('dispatch.loading.allocations')}</div>
          ) : allocations.length === 0 ? (
            <div className="py-16 text-center">
              <Bus className="mx-auto h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm text-gray-500">{t('dispatch.noBuses')}</p>
              <p className="text-xs text-gray-400 mt-1">{t('dispatch.getStarted')}</p>
              <div className="flex justify-center gap-3 mt-4">
                <button
                  onClick={() => setActiveTab('generate')}
                  className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
                >
                  {t('dispatch.tabs.generate')}
                </button>
                <button
                  onClick={() => setActiveTab('assign')}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  {t('dispatch.buttons.assignBus')}
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-750">
                  <tr>
                    {[t('dispatch.columns.bus'), t('dispatch.columns.route'), t('dispatch.columns.driver'), t('dispatch.columns.shift'), t('dispatch.columns.status'), t('dispatch.columns.actions')].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {allocations.map((alloc) => (
                    <tr key={alloc.id} className="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">🚌</span>
                          <div>
                            <p className="text-xs font-semibold text-gray-900 dark:text-white">
                              {alloc.vehicle_registration}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300 max-w-[200px] truncate">
                        {alloc.route_name}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                        {alloc.driver_name || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-600 dark:text-gray-400">
                        {formatShiftTime(alloc.shift_start, language)} – {formatShiftTime(alloc.shift_end, language)}
                      </td>
                      <td className="px-4 py-3">
                        <AllocationBadge status={alloc.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1.5">
                          {/* CRUD row */}
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setViewTarget(alloc)}
                              className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-200"
                            >
                              <Eye className="h-3 w-3" /> {t('common.view')}
                            </button>
                            <button
                              onClick={() => setEditTarget(alloc)}
                              className="flex items-center gap-1 rounded-lg bg-blue-100 px-2 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-200"
                            >
                              <Pencil className="h-3 w-3" /> {t('common.edit')}
                            </button>
                            <button
                              onClick={() => setDeleteTarget(alloc)}
                              className="flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-600 hover:bg-red-100"
                            >
                              <Trash2 className="h-3 w-3" /> {t('common.delete')}
                            </button>
                          </div>
                          {/* Operational row */}
                          {alloc.status !== 'CANCELLED' && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => { setBreakdownTarget(alloc); setBreakdownReason('') }}
                                className="flex items-center gap-1 rounded-lg bg-red-100 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-200"
                              >
                                <Wrench className="h-3 w-3" /> {t('dispatch.buttons.breakdown')}
                              </button>
                              <button
                                onClick={() => { setReassignTarget(alloc); setReplacementVehicleId('') }}
                                className="flex items-center gap-1 rounded-lg bg-green-100 px-2 py-1 text-[10px] font-semibold text-green-700 hover:bg-green-200"
                              >
                                <ArrowLeftRight className="h-3 w-3" /> {t('dispatch.buttons.reassign')}
                              </button>
                              <button
                                onClick={() => setRemoveTarget(alloc)}
                                className="flex items-center gap-1 rounded-lg bg-orange-100 px-2 py-1 text-[10px] font-semibold text-orange-700 hover:bg-orange-200"
                              >
                                <XCircle className="h-3 w-3" /> {t('dispatch.buttons.remove')}
                              </button>
                            </div>
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
      )}

      {/* ── GENERATE SCHEDULE ─────────────────────────────────────────────── */}
      {activeTab === 'generate' && (
        <SectionCard title={t('dispatch.buttons.generateSchedule')} icon={Zap} defaultOpen>
          <form
            onSubmit={generateForm.handleSubmit((d) => {
              if (selectedVehicles.length === 0) {
                toast.error('Select at least one bus to assign.')
                return
              }
              generateMutation.mutate(d)
            })}
            className="space-y-5"
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('dispatch.form.route')} <span className="text-red-500">*</span>
                </label>
                <select
                  {...generateForm.register('route_id', { required: 'Route is required' })}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">{t('dispatch.form.selectRoute')}</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>{r.route_code}: {r.name_en}</option>
                  ))}
                </select>
                {generateForm.formState.errors.route_id && (
                  <p className="mt-1 text-xs text-red-500">{generateForm.formState.errors.route_id.message}</p>
                )}
              </div>

              <div>
                <Controller
                  name="date"
                  control={generateForm.control}
                  render={({ field }) => (
                    <NepaliDateInput
                      label={t('dispatch.form.date')}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>

              <div>
                <Controller
                  name="operating_start"
                  control={generateForm.control}
                  render={({ field }) => (
                    <NepaliTimeInput
                      label={t('dispatch.form.startTime')}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>

              <div>
                <Controller
                  name="operating_end"
                  control={generateForm.control}
                  render={({ field }) => (
                    <NepaliTimeInput
                      label={t('dispatch.form.endTime')}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('dispatch.form.headway')}
                </label>
                <input
                  type="number"
                  min={5}
                  max={60}
                  {...generateForm.register('headway_minutes', { valueAsNumber: true })}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('dispatch.form.tripDuration')}
                </label>
                <input
                  type="number"
                  min={10}
                  max={180}
                  {...generateForm.register('trip_duration_minutes', { valueAsNumber: true })}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('dispatch.form.layover')}
                </label>
                <input
                  type="number"
                  min={0}
                  max={30}
                  {...generateForm.register('layover_minutes', { valueAsNumber: true })}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>

            {/* Bus selector */}
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('dispatch.form.selectedCount', { count: selectedVehicles.length })}
              </label>
              {availableVehicles.length === 0 ? (
                <p className="text-xs text-gray-400 rounded-xl border border-dashed border-gray-200 p-4 text-center">
                  {t('dispatch.noAvailableBuses')}
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-48 overflow-y-auto p-1">
                  {availableVehicles.map((v) => {
                    const selected = selectedVehicles.includes(v.id)
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => toggleVehicle(v.id)}
                        className={cn(
                          'flex flex-col items-start rounded-xl border p-2.5 text-left text-xs transition-all',
                          selected
                            ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-900/20'
                            : 'border-gray-200 hover:border-gray-300',
                        )}
                      >
                        <span className="text-base mb-0.5">🚌</span>
                        <p className="font-semibold text-gray-800 dark:text-white">
                          {v.bus_number || v.registration_no}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          {t('dispatch.form.capacity')}: {v.capacity_seated} · {t(`dispatch.status.${v.status}`, { defaultValue: v.status })}
                        </p>
                        {selected && (
                          <span className="mt-1 text-[10px] font-semibold text-primary-600">{t('dispatch.form.selected')}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Preview */}
            {selectedVehicles.length > 0 && generateForm.watch('operating_start') && (
              <div className="rounded-xl bg-blue-50 p-3 dark:bg-blue-900/20 text-xs">
                <p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">
                  {t('dispatch.preview.title')}
                </p>
                <p className="text-blue-600">
                  {t('dispatch.form.route')}: {generateForm.watch('operating_start')} → {generateForm.watch('operating_end')}
                </p>
                {selectedVehicles.slice(0, 4).map((vid, i) => {
                  const v = vehicles.find((x) => x.id === vid)
                  const startH = parseInt(generateForm.watch('operating_start')?.split(':')[0] ?? '5')
                  const startM = parseInt(generateForm.watch('operating_start')?.split(':')[1] ?? '0')
                  const hw = generateForm.watch('headway_minutes') ?? 15
                  const dep = startH * 60 + startM + i * hw
                  const arr = dep + (generateForm.watch('trip_duration_minutes') ?? 45)
                  return (
                    <p key={vid} className="text-blue-600">
                      {v?.bus_number || v?.registration_no || vid.slice(0, 8)} →
                      {t('dispatch.preview.departs')} {String(Math.floor(dep / 60)).padStart(2, '0')}:{String(dep % 60).padStart(2, '0')},
                      {t('dispatch.preview.arrives')} {String(Math.floor(arr / 60) % 24).padStart(2, '0')}:{String(arr % 60).padStart(2, '0')}
                    </p>
                  )
                })}
                {selectedVehicles.length > 4 && (
                  <p className="text-blue-400">{t('dispatch.preview.moreBuses', { count: selectedVehicles.length - 4 })}</p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={generateMutation.isPending || selectedVehicles.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50 transition-all"
            >
              {generateMutation.isPending ? (
                <>{t('dispatch.generating')}</>
              ) : (
                <><Zap className="h-4 w-4" /> {t('dispatch.buttons.generateSchedule')}</>
              )}
            </button>
          </form>
        </SectionCard>
      )}

      {/* ── ASSIGN SINGLE BUS ─────────────────────────────────────────────── */}
      {activeTab === 'assign' && (
        <SectionCard title={t('dispatch.assignBusToRoute')} icon={Plus} defaultOpen>
          <form onSubmit={assignForm.handleSubmit((d) => assignMutation.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Controller
                  name="date"
                  control={assignForm.control}
                  render={({ field }) => (
                    <NepaliDateInput
                      label={t('dispatch.form.date')}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('dispatch.form.route')} <span className="text-red-500">*</span>
                </label>
                <select
                  {...assignForm.register('route_id', { required: 'Route is required' })}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">{t('dispatch.form.selectRoute')}</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>{r.route_code}: {r.name_en}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('dispatch.form.bus')} <span className="text-red-500">*</span>
                </label>
                <select
                  {...assignForm.register('vehicle_id', { required: 'Bus is required' })}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">{t('dispatch.form.selectBus')}</option>
                  {availableVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.bus_number ? `${v.bus_number} (${v.registration_no})` : v.registration_no}
                      {' '} · {t('dispatch.form.capacity')} {v.capacity_seated}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('dispatch.form.driver')}
                </label>
                <select
                  {...assignForm.register('driver_id')}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">{t('dispatch.form.selectDriver')}</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.full_name} ({d.employee_id})</option>
                  ))}
                </select>
              </div>
              <div>
                <Controller
                  name="shift_start"
                  control={assignForm.control}
                  render={({ field }) => (
                    <NepaliTimeInput
                      label={t('dispatch.form.shiftStart')}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>
              <div>
                <Controller
                  name="shift_end"
                  control={assignForm.control}
                  render={({ field }) => (
                    <NepaliTimeInput
                      label={t('dispatch.form.shiftEnd')}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={assignMutation.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {assignMutation.isPending ? t('dispatch.assigning') : <><Plus className="h-4 w-4" /> {t('dispatch.buttons.assignBus')}</>}
            </button>
          </form>
        </SectionCard>
      )}

      {/* ── DISPATCH LOGS ─────────────────────────────────────────────────── */}
      {activeTab === 'logs' && (
        <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {t('dispatch.modals.logsTitle')} · {todayDisplay}
            </span>
            <button
              onClick={() => refetchLogs()}
              className="text-xs text-primary-600 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="h-3 w-3" /> {t('dispatch.buttons.refresh')}
            </button>
          </div>
          {logsLoading ? (
            <div className="py-10 text-center text-sm text-gray-400">{t('dispatch.loading.logs')}</div>
          ) : logs.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">{t('dispatch.noLogActions')}</div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {logs.map((log) => (
                <div key={log.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="mt-0.5">
                    <LogActionBadge action={log.action_type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 dark:text-gray-300">{log.notes || '—'}</p>
                    {log.vehicle_id && (
                      <p className="text-[10px] text-gray-400 mt-0.5">Bus: {log.vehicle_id.slice(0, 12)}</p>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">
                    {fmtDate(log.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── BREAKDOWN MODAL ───────────────────────────────────────────────── */}
      {breakdownTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-96 rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800">
            <div className="flex items-center gap-3 mb-4">
              <div className="rounded-xl bg-red-100 p-2"><Wrench className="h-5 w-5 text-red-600" /></div>
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">{t('dispatch.modals.breakdownTitle')}</h3>
                <p className="text-xs text-gray-500">{breakdownTarget.vehicle_registration}</p>
              </div>
            </div>
            <textarea
              placeholder={t('dispatch.form.breakdownReason')}
              rows={3}
              value={breakdownReason}
              onChange={(e) => setBreakdownReason(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setBreakdownTarget(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2 text-sm text-gray-600"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  if (!breakdownReason.trim()) { toast.error('Enter a reason'); return }
                  breakdownMutation.mutate({ id: breakdownTarget.id, reason: breakdownReason })
                }}
                disabled={breakdownMutation.isPending}
                className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {breakdownMutation.isPending ? t('dispatch.marking') : t('dispatch.buttons.markBreakdown')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REASSIGN MODAL ────────────────────────────────────────────────── */}
      {reassignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-96 rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800">
            <div className="flex items-center gap-3 mb-4">
              <div className="rounded-xl bg-green-100 p-2"><ArrowLeftRight className="h-5 w-5 text-green-600" /></div>
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">{t('dispatch.modals.replacementTitle')}</h3>
                <p className="text-xs text-gray-500">{t('dispatch.form.route')}: {reassignTarget.route_name}</p>
              </div>
            </div>
            <select
              value={replacementVehicleId}
              onChange={(e) => setReplacementVehicleId(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              <option value="">{t('dispatch.form.selectReplacement')}</option>
              {availableVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.bus_number ? `${v.bus_number} (${v.registration_no})` : v.registration_no}
                  {' '}· {t('dispatch.form.capacity')} {v.capacity_seated}
                </option>
              ))}
            </select>
            <div className="flex gap-3">
              <button
                onClick={() => setReassignTarget(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2 text-sm text-gray-600"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  if (!replacementVehicleId) { toast.error('Select a replacement bus'); return }
                  reassignMutation.mutate({ id: reassignTarget.id, vehicleId: replacementVehicleId })
                }}
                disabled={reassignMutation.isPending || !replacementVehicleId}
                className="flex-1 rounded-xl bg-green-600 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {reassignMutation.isPending ? t('dispatch.assigning') : t('dispatch.buttons.assignReplacement')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REMOVE MODAL ──────────────────────────────────────────────────── */}
      {removeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-96 rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-2">{t('dispatch.modals.removeTitle')}</h3>
            <p className="text-sm text-gray-500 mb-4">
              {t('dispatch.removeDesc', { bus: removeTarget.vehicle_registration, route: removeTarget.route_name })}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setRemoveTarget(null)} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm text-gray-600">
                {t('dispatch.actions.keepAssigned')}
              </button>
              <button
                onClick={() => removeMutation.mutate(removeTarget.id)}
                disabled={removeMutation.isPending}
                className="flex-1 rounded-xl bg-orange-600 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {removeMutation.isPending ? t('dispatch.removing') : t('dispatch.buttons.removeFromRoute')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW MODAL ────────────────────────────────────────────────────── */}
      {viewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[480px] rounded-2xl bg-white shadow-2xl dark:bg-gray-800 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-gray-100 p-2 dark:bg-gray-700">
                  <Eye className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">{t('dispatch.modals.viewTitle')}</h3>
                  <p className="text-[10px] font-mono text-gray-400">{viewTarget.id.slice(0, 18)}…</p>
                </div>
              </div>
              <AllocationBadge status={viewTarget.status} />
            </div>
            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: t('dispatch.form.date'), value: <DateDisplay date={viewTarget.date} /> },
                  { label: t('dispatch.form.status'), value: t(`dispatch.status.${viewTarget.status}`, { defaultValue: viewTarget.status }) },
                  { label: t('dispatch.columns.bus'), value: viewTarget.vehicle_registration || '—' },
                  { label: t('dispatch.columns.route'), value: viewTarget.route_name || '—' },
                  { label: t('dispatch.columns.driver'), value: viewTarget.driver_name || '—' },
                  { label: t('dispatch.columns.shift'), value: `${formatShiftTime(viewTarget.shift_start, language)} – ${formatShiftTime(viewTarget.shift_end, language)}` },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl bg-gray-50 dark:bg-gray-700 px-4 py-3">
                    <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
                    <p className="text-xs font-semibold text-gray-800 dark:text-white">{value}</p>
                  </div>
                ))}
              </div>
              {viewTarget.notes && (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
                  <p className="text-[10px] font-medium text-amber-600 uppercase tracking-wide mb-1">{t('dispatch.form.notes')}</p>
                  <p className="text-xs text-gray-700 dark:text-gray-300">{viewTarget.notes}</p>
                </div>
              )}
              <p className="text-[10px] text-gray-400 text-right">
                {fmtDate(viewTarget.created_at)}
              </p>
            </div>
            <div className="px-6 pb-5">
              <button
                onClick={() => { setViewTarget(null); setEditTarget(viewTarget) }}
                className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 mb-2"
              >
                <Pencil className="h-3.5 w-3.5 inline mr-1.5" /> {t('dispatch.actions.editAllocation')}
              </button>
              <button
                onClick={() => setViewTarget(null)}
                className="w-full rounded-xl border border-gray-200 py-2.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT MODAL ────────────────────────────────────────────────────── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[500px] rounded-2xl bg-white shadow-2xl dark:bg-gray-800 overflow-hidden max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="rounded-xl bg-blue-100 p-2 dark:bg-blue-900/30">
                <Pencil className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">{t('dispatch.modals.editTitle')}</h3>
                <p className="text-xs text-gray-500">{editTarget.vehicle_registration} · {editTarget.route_name}</p>
              </div>
            </div>
            {/* Form */}
            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('dispatch.form.route')}</label>
                  <select
                    value={editRouteId}
                    onChange={(e) => setEditRouteId(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">{t('dispatch.form.selectRoute')}</option>
                    {routes.map((r) => (
                      <option key={r.id} value={r.id}>{r.route_code}: {r.name_en}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('dispatch.form.bus')}</label>
                  <select
                    value={editVehicleId}
                    onChange={(e) => setEditVehicleId(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  >
                    {vehicles.find((v) => v.id === editVehicleId) && (
                      <option value={editVehicleId}>
                        {(() => {
                          const v = vehicles.find((v) => v.id === editVehicleId)!
                          return v.bus_number ? `${v.bus_number} (${v.registration_no})` : v.registration_no
                        })()} {t('dispatch.form.currentBus')}
                      </option>
                    )}
                    {availableVehicles
                      .filter((v) => v.id !== editVehicleId)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.bus_number ? `${v.bus_number} (${v.registration_no})` : v.registration_no}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('dispatch.form.driver')}</label>
                  <select
                    value={editDriverId}
                    onChange={(e) => setEditDriverId(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">{t('dispatch.form.noDriver')}</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>{d.full_name} ({d.employee_id})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('dispatch.form.status')}</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as DailyAllocation['status'])}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="PENDING">{t('dispatch.status.PENDING')}</option>
                    <option value="ACTIVE">{t('dispatch.status.ACTIVE')}</option>
                    <option value="COMPLETED">{t('dispatch.status.COMPLETED')}</option>
                    <option value="CANCELLED">{t('dispatch.status.CANCELLED')}</option>
                  </select>
                </div>
                <div>
                  <NepaliTimeInput
                    label={t('dispatch.form.shiftStart')}
                    value={editShiftStart}
                    onChange={setEditShiftStart}
                  />
                </div>
                <div>
                  <NepaliTimeInput
                    label={t('dispatch.form.shiftEnd')}
                    value={editShiftEnd}
                    onChange={setEditShiftEnd}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('dispatch.form.notes')}</label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder={t('dispatch.form.optionalNotes')}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white resize-none"
                />
              </div>
            </div>
            {/* Footer */}
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={() => setEditTarget(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  if (!editRouteId || !editVehicleId) {
                    toast.error('Route and bus are required')
                    return
                  }
                  updateMutation.mutate({
                    id: editTarget.id,
                    data: {
                      route_id: editRouteId,
                      vehicle_id: editVehicleId,
                      driver_id: editDriverId || null,
                      shift_start: editShiftStart,
                      shift_end: editShiftEnd,
                      notes: editNotes,
                      status: editStatus,
                    },
                  })
                }}
                disabled={updateMutation.isPending}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {updateMutation.isPending ? t('dispatch.saving') : t('dispatch.buttons.saveChanges')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE MODAL ──────────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-96 rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800">
            <div className="flex items-center gap-3 mb-4">
              <div className="rounded-xl bg-red-100 p-2">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">{t('dispatch.modals.deleteTitle')}</h3>
                <p className="text-xs text-gray-500">{t('dispatch.cannotUndo')}</p>
              </div>
            </div>
            <div className="rounded-xl bg-red-50 dark:bg-red-900/20 px-4 py-3 mb-4">
              <p className="text-xs text-red-700 dark:text-red-300">
                {t('dispatch.deleteDesc', { bus: deleteTarget.vehicle_registration, route: deleteTarget.route_name })}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300"
              >
                {t('dispatch.actions.keepAllocation')}
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? t('dispatch.deleting') : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
