import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, CheckSquare, XCircle, Plus, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@components/shared/Button'
import { Table, Column } from '@components/shared/Table'
import { Modal } from '@components/shared/Modal'
import { Input } from '@components/shared/Input'
import { TripStatusBadge } from '@components/domain/TripStatusBadge'
import { DateDisplay } from '@components/shared/DateDisplay'
import schedulingService, { Trip } from '@services/schedulingService'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'

interface CreateTripForm {
  route_id: string
  vehicle_id: string
  driver_id: string
  conductor_id?: string
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

  const createMutation = useMutation({
    mutationFn: (payload: CreateTripForm) => schedulingService.trips.create(payload),
    onSuccess: () => {
      toast.success('Trip created!')
      setShowCreate(false)
      reset()
      qc.invalidateQueries({ queryKey: ['today-trips-page'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const columns: Column<Trip>[] = [
    {
      key: 'route_number',
      header: 'Route',
      render: (trip) => <span className="font-mono font-bold text-primary-600">{trip.route_number}</span>,
    },
    { key: 'vehicle_plate', header: 'Vehicle' },
    { key: 'driver_name', header: 'Driver' },
    {
      key: 'scheduled_departure',
      header: 'Departure',
      render: (trip) => new Date(trip.scheduled_departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4 p-6">
          <p className="text-sm text-gray-500">
            ⚠️ Max 8 hours/day per driver (Nepal Labour Act 2074)
          </p>
          <Input label="Route ID" required {...register('route_id', { required: true })} />
          <Input label="Vehicle ID" required {...register('vehicle_id', { required: true })} />
          <Input label="Driver ID" required {...register('driver_id', { required: true })} />
          <Input label="Collector ID (optional)" {...register('conductor_id')} />
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
            Complete trip on route <strong>{completeTarget?.route_number}</strong>?
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
            Cancel trip on route <strong>{cancelTarget?.route_number}</strong>?
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
