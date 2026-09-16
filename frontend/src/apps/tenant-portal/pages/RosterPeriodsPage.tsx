/**
 * RosterPeriodsPage -- doc section 5.7 stage 1: pick a date range, generate
 * the duty skeleton from Slice 1's route demand, then open the grid to
 * assign groups by hand (P0 has no auto-rotation engine -- see the Slice 2
 * plan's explicit phase scoping).
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, CalendarRange, Send } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Badge } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { Table, Column } from '@components/shared/Table'
import rosterService, { RosterPeriod } from '@services/rosterService'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'

const statusVariant: Record<RosterPeriod['status'], 'info' | 'success' | 'neutral'> = {
  DRAFT: 'info', PUBLISHED: 'success', CLOSED: 'neutral',
}

interface CreateForm {
  start_date: string
  end_date: string
}

export default function RosterPeriodsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)

  const { data: periods = [], isLoading } = useQuery({
    queryKey: ['roster-periods'],
    queryFn: () => rosterService.listPeriods(),
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateForm>()

  const createMutation = useMutation({
    mutationFn: (payload: CreateForm) => rosterService.createPeriod(payload),
    onSuccess: (period) => {
      toast.success('Roster period created.')
      qc.invalidateQueries({ queryKey: ['roster-periods'] })
      setShowCreate(false)
      reset()
      navigate(`/tenant/roster/${period.id}/grid`)
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to create roster period.')
    },
  })

  const publishMutation = useMutation({
    mutationFn: (id: string) => rosterService.publishPeriod(id),
    onSuccess: () => {
      toast.success('Roster period published.')
      qc.invalidateQueries({ queryKey: ['roster-periods'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string; data?: { conflicts?: { message: string }[] } } } }
      const conflicts = e?.response?.data?.data?.conflicts
      toast.error(
        conflicts?.length
          ? `${e.response!.data!.message} First: ${conflicts[0].message}`
          : e?.response?.data?.message || 'Failed to publish.'
      )
    },
  })

  const columns: Column<RosterPeriod>[] = [
    { key: 'start_date', header: 'Start', render: (p) => new Date(p.start_date).toLocaleDateString() },
    { key: 'end_date', header: 'End', render: (p) => new Date(p.end_date).toLocaleDateString() },
    { key: 'status', header: 'Status', render: (p) => <Badge variant={statusVariant[p.status]}>{p.status}</Badge> },
    { key: 'version', header: 'Version' },
    {
      key: 'actions', header: '', render: (p) => (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate(`/tenant/roster/${p.id}/grid`)}>Open Grid</Button>
          {p.status !== 'CLOSED' && (
            <Button
              size="sm" leftIcon={<Send className="h-3.5 w-3.5" />}
              loading={publishMutation.isPending} onClick={() => publishMutation.mutate(p.id)}
            >
              {p.status === 'PUBLISHED' ? 'Republish' : 'Publish'}
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
          <h1 className="page-title flex items-center gap-2"><CalendarRange className="h-6 w-6 text-primary-600" /> Roster Periods</h1>
          <p className="page-subtitle">Generate a dated chart of duties, assign groups, and publish it to crew</p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>New Period</Button>
      </div>

      <Table
        columns={columns}
        data={periods}
        keyExtractor={(p) => p.id}
        loading={isLoading}
        emptyMessage="No roster periods yet -- create one to generate this week's duty chart."
      />

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Roster Period" size="sm">
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4 p-6">
          <Input
            type="date" label="Start Date" required error={errors.start_date?.message}
            {...register('start_date', { required: 'Required' })}
          />
          <Input
            type="date" label="End Date" required error={errors.end_date?.message}
            {...register('end_date', { required: 'Required' })}
          />
          <p className="text-xs text-gray-400">
            One unassigned duty per route/slot will be generated for each day in this range, based on the demand
            configured on each route.
          </p>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>Generate</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
