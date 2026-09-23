import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, CheckSquare, XCircle, Plus, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@components/shared/Button'
import { Table, Column } from '@components/shared/Table'
import { Modal } from '@components/shared/Modal'
import { Input } from '@components/shared/Input'
import { TripStatusBadge } from '@components/domain/TripStatusBadge'
import schedulingService, { Trip, CreateTripPayload } from '@services/schedulingService'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import apiClient from '@services/api'

interface ConductorOption {
  id: string
  full_name_en: string
  user_id: string | null
}

interface CreateTripForm {
  route_id: string
  vehicle_id: string
  driver_id: string
  conductor_id?: string
  // datetime-local values (e.g. "2026-09-24T14:30") -- split into
  // date/scheduled_departure_time/scheduled_arrival_time on submit to match
  // what TripSerializer actually accepts.
  scheduled_departure: string
  scheduled_arrival: string
}

export default function TripsPage() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<Trip | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [completeTarget, setCompleteTarget] = useState<Trip | null>(null)
  const [passengerCount, setPassengerCount] = useState('')

  const { data: todayTrips, isLoading, refetch } = useQuery({
    queryKey: ['today-trips-page'],
    queryFn: schedulingService.trips.today,
    refetchInterval: 30 * 1000,
  })

  const startMutation = useMutation({
    mutationFn: (id: string) => schedulingService.trips.start(id),
    onSuccess: () => { toast.success('Trip started!'); qc.invalidateQueries({ queryKey: ['today-trips-page'] }) },
    onError: (err: Error) => toast.error(err.message),
  })

  const completeMutation = useMutation({
    mutationFn: ({ id, count }: { id: string; count: number }) =>
      schedulingService.trips.complete(id, count),
    onSuccess: () => {
      toast.success('Trip completed!')
      setCompleteTarget(null)
      qc.invalidateQueries({ queryKey: ['today-trips-page'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      schedulingService.trips.cancel(id, reason),
    onSuccess: () => {
      toast.success('Trip cancelled')
      setCancelTarget(null)
      qc.invalidateQueries({ queryKey: ['today-trips-page'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const { register, handleSubmit, reset } = useForm<CreateTripForm>()

  // Only conductors with a real login (user_id) can ever be matched by
  // GET /public-api/v1/trips/{id}/qr/ -- that endpoint's own
  // tenant_db.fetch_trip_for_conductor() filters strictly on
  // conductor_id == the caller's own user_id from their JWT, and
  // TripViewSet.mine() (the conductor's own trip lookup) uses the exact
  // same filter. A conductor picked here who has no login yet could never
  // pull their own trip or QR, so they're excluded from this list rather
  // than silently accepted and quietly broken later.
  const { data: conductorOptions = [] } = useQuery<ConductorOption[]>({
    queryKey: ['conductors-with-login-dropdown'],
    queryFn: async () => {
      const { data } = await apiClient.get('/operator/conductors/', { params: { page_size: 200 } })
      const list: ConductorOption[] = data.data?.results ?? data.data ?? []
      return list.filter((c) => !!c.user_id)
    },
    staleTime: 60 * 1000,
  })

  const createMutation = useMutation({
    mutationFn: (payload: CreateTripPayload) => schedulingService.trips.create(payload),
    onSuccess: () => {
      toast.success('Trip created!')
      setShowCreate(false)
      reset()
      qc.invalidateQueries({ queryKey: ['today-trips-page'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const onCreateSubmit = (d: CreateTripForm) => {
    const [date, departureTime] = d.scheduled_departure.split('T')
    const arrivalTime = d.scheduled_arrival.split('T')[1]
    createMutation.mutate({
      route_id: d.route_id,
      vehicle_id: d.vehicle_id,
      driver_id: d.driver_id,
      conductor_id: d.conductor_id || undefined,
      date,
      scheduled_departure_time: departureTime,
      scheduled_arrival_time: arrivalTime,
    })
  }

  const columns: Column<Trip>[] = [
    {
      key: 'route_name',
      header: 'Route',
      render: (trip) => <span className="font-mono font-bold text-primary-600">{trip.route_name}</span>,
    },
    {
      key: 'vehicle_registration',
      header: 'Vehicle',
      render: (trip) => trip.vehicle_registration ?? trip.vehicle_bus_number ?? '—',
    },
    {
      // TripSerializer.get_scheduled_departure() already returns an "HH:MM"
      // string, not an ISO datetime -- new Date("HH:MM") is an Invalid Date.
      key: 'scheduled_departure',
      header: 'Departure',
      render: (trip) => trip.scheduled_departure || '—',
    },
    {
      key: 'actual_departure',
      header: 'Actual Depart.',
      render: (trip) => trip.actual_departure
        ? new Date(trip.actual_departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '—',
    },
    {
      key: 'status',
      header: 'Status',
      render: (trip) => <TripStatusBadge status={trip.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (trip) => (
        <div className="flex items-center gap-1">
          {trip.status === 'SCHEDULED' && (
            <Button size="sm" variant="ghost" onClick={() => startMutation.mutate(trip.id)} loading={startMutation.isPending}>
              <Play className="h-3.5 w-3.5 text-green-600" />
            </Button>
          )}
          {trip.status === 'IN_PROGRESS' && (
            <Button size="sm" variant="ghost" onClick={() => setCompleteTarget(trip)}>
              <CheckSquare className="h-3.5 w-3.5 text-blue-600" />
            </Button>
          )}
          {['SCHEDULED', 'IN_PROGRESS'].includes(trip.status) && (
            <Button size="sm" variant="ghost" onClick={() => setCancelTarget(trip)}>
              <XCircle className="h-3.5 w-3.5 text-red-600" />
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
          <h1 className="page-title">{t('scheduling.today')}</h1>
          <p className="page-subtitle">Manage live trips for today</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>
            Refresh
          </Button>
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
            {t('scheduling.createTrip')}
          </Button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-3">
        {(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const).map((status) => {
          const count = todayTrips?.filter((t: Trip) => t.status === status).length ?? 0
          return (
            <div key={status} className="flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5">
              <TripStatusBadge status={status} />
              <span className="text-sm font-semibold">{count}</span>
            </div>
          )
        })}
      </div>

      <div className="card p-0">
        <Table columns={columns} data={todayTrips ?? []} keyExtractor={(t) => t.id} loading={isLoading} />
      </div>

      {/* Create trip modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Trip" size="lg">
        <form onSubmit={handleSubmit(onCreateSubmit)} className="space-y-4 p-6">
          <p className="text-sm text-gray-500">
            ⚠️ Max 8 hours/day per driver (Nepal Labour Act 2074)
          </p>
          <Input label="Route ID" required {...register('route_id', { required: true })} />
          <Input label="Vehicle ID" required {...register('vehicle_id', { required: true })} />
          <Input label="Driver ID" required {...register('driver_id', { required: true })} />
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Conductor (optional)</label>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              defaultValue=""
              {...register('conductor_id')}
            >
              <option value="">No conductor assigned</option>
              {conductorOptions.map((c) => (
                <option key={c.id} value={c.user_id!}>{c.full_name_en}</option>
              ))}
            </select>
            {conductorOptions.length === 0 && (
              <p className="mt-1 text-xs text-gray-400">
                No conductor has a login yet — create one from the Conductors page first.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Scheduled Departure" type="datetime-local" required {...register('scheduled_departure', { required: true })} />
            <Input label="Scheduled Arrival" type="datetime-local" required {...register('scheduled_arrival', { required: true })} />
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>Create Trip</Button>
          </div>
        </form>
      </Modal>

      {/* Complete trip modal */}
      <Modal open={!!completeTarget} onClose={() => setCompleteTarget(null)} title="Complete Trip" size="sm">
        <div className="space-y-4 p-6">
          <p className="text-sm text-gray-600">
            Complete trip on route <strong>{completeTarget?.route_name}</strong>?
          </p>
          <Input
            label="Passenger Count"
            type="number"
            min="0"
            value={passengerCount}
            onChange={(e) => setPassengerCount(e.target.value)}
            placeholder="How many passengers?"
          />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setCompleteTarget(null)}>Cancel</Button>
            <Button
              loading={completeMutation.isPending}
              onClick={() => completeTarget && completeMutation.mutate({
                id: completeTarget.id,
                count: Number(passengerCount) || 0,
              })}
            >
              Complete Trip
            </Button>
          </div>
        </div>
      </Modal>

      {/* Cancel trip modal */}
      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title="Cancel Trip" size="sm">
        <div className="space-y-4 p-6">
          <p className="text-sm text-gray-600">
            Cancel trip on route <strong>{cancelTarget?.route_name}</strong>?
          </p>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('scheduling.cancellationReason')} *
            </label>
            <textarea
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason for cancellation..."
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setCancelTarget(null)}>Back</Button>
            <Button
              variant="danger"
              loading={cancelMutation.isPending}
              disabled={!cancelReason.trim()}
              onClick={() => cancelTarget && cancelMutation.mutate({ id: cancelTarget.id, reason: cancelReason })}
            >
              Cancel Trip
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
