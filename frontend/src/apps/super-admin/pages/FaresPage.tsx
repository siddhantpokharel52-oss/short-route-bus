import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { Plus, Upload, Trash2 } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Modal } from '@components/shared/Modal'
import { usePagination } from '@hooks/usePagination'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

interface RouteOption {
  id: string
  route_code: string
  name_en: string
}

interface TicketTypeOption {
  id: string
  code: string
  name_en: string
}

interface FareRow {
  id: string
  route: string | null
  zone_from: string
  zone_to: string
  ticket_type: string
  base_fare: string
  peak_fare: string
  student_fare: string
}

interface AddFareValues {
  route: string
  ticket_type: string
  zone_from: string
  zone_to: string
  base_fare: string
  peak_fare: string
  student_fare: string
}

interface BulkFareRowInput {
  zone_from: string
  zone_to: string
  base_fare: string
  peak_fare: string
  student_fare: string
}

interface BulkFormValues {
  route: string
  ticket_type: string
  fares: BulkFareRowInput[]
}

const emptyBulkRow: BulkFareRowInput = { zone_from: '', zone_to: '', base_fare: '', peak_fare: '', student_fare: '' }

const selectClass =
  'w-full rounded-lg border px-3 py-2 text-sm bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100 ' +
  'border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent'

function flattenErrors(errors: Record<string, string[] | string>): string {
  return Object.entries(errors)
    .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`)
    .join(' | ')
}

export default function FaresPage() {
  const { t } = useTranslation('platform')
  const qc = useQueryClient()
  const [routeFilter, setRouteFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const pagination = usePagination(totalCount)

  const { data: routes } = useQuery({
    queryKey: ['routes-for-fares'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/routes/', { params: { page_size: 100 } })
      return (data.data ?? []) as RouteOption[]
    },
  })

  const { data: ticketTypes } = useQuery({
    queryKey: ['ticket-types-for-fares'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/ticket-types/', { params: { page_size: 100 } })
      return (data.data ?? []) as TicketTypeOption[]
    },
  })

  const routeById = useMemo(
    () => Object.fromEntries((routes ?? []).map((r) => [r.id, r])),
    [routes]
  )
  const ticketTypeById = useMemo(
    () => Object.fromEntries((ticketTypes ?? []).map((tt) => [tt.id, tt])),
    [ticketTypes]
  )

  const { data: fares, isLoading } = useQuery({
    queryKey: ['fare-matrix', pagination.page, routeFilter],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/fare-matrix/', {
        params: { ...pagination.queryParams, ...(routeFilter && { route: routeFilter }) },
      })
      setTotalCount(data.meta?.total_count ?? 0)
      return (data.data ?? []) as FareRow[]
    },
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['fare-matrix'] })

  // ── Add a single fare row ──────────────────────────────────────────
  const addForm = useForm<AddFareValues>()

  const createMutation = useMutation({
    mutationFn: (payload: Partial<AddFareValues>) =>
      apiClient.post('/platform/fare-matrix/', payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('Fare added.')
      setShowAdd(false)
      addForm.reset()
      invalidate()
    },
    onError: (err: any) => {
      const errors = err?.response?.data?.errors
      toast.error(errors && typeof errors === 'object' ? flattenErrors(errors) : (err?.response?.data?.message || 'Failed to add fare.'))
    },
  })

  // ── Bulk import a whole fare chart ─────────────────────────────────
  const bulkForm = useForm<BulkFormValues>({
    defaultValues: { route: '', ticket_type: '', fares: [emptyBulkRow] },
  })
  const { fields, append, remove } = useFieldArray({ control: bulkForm.control, name: 'fares' })

  const bulkMutation = useMutation({
    mutationFn: (payload: unknown) =>
      apiClient.post('/platform/fare-matrix/bulk-import/', payload).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(data.message || 'Fares imported.')
      setShowBulk(false)
      bulkForm.reset({ route: '', ticket_type: '', fares: [emptyBulkRow] })
      invalidate()
    },
    onError: (err: any) => {
      const rowErrors = err?.response?.data?.errors
      if (Array.isArray(rowErrors)) {
        rowErrors.forEach((e: { row: number; error: unknown }) => {
          const detail = typeof e.error === 'string' ? e.error : flattenErrors(e.error as Record<string, string[]>)
          toast.error(`Row ${e.row + 1}: ${detail}`)
        })
      } else {
        toast.error(err?.response?.data?.message || 'Bulk import failed.')
      }
    },
  })

  const onSubmitBulk = (values: BulkFormValues) => {
    bulkMutation.mutate({
      route: values.route,
      ticket_type: values.ticket_type,
      fares: values.fares.map((f) => ({
        zone_from: f.zone_from,
        zone_to: f.zone_to,
        base_fare: f.base_fare,
        ...(f.peak_fare ? { peak_fare: f.peak_fare } : {}),
        ...(f.student_fare ? { student_fare: f.student_fare } : {}),
      })),
    })
  }

  const columns: Column<FareRow>[] = [
    {
      key: 'route', header: 'Route',
      render: (r) => r.route ? (routeById[r.route]?.route_code ?? r.route) : <span className="text-gray-400">Flat / all routes</span>,
    },
    { key: 'zone_from', header: 'From', render: (r) => r.zone_from || <span className="text-gray-400">—</span> },
    { key: 'zone_to', header: 'To', render: (r) => r.zone_to || <span className="text-gray-400">—</span> },
    { key: 'ticket_type', header: 'Ticket Type', render: (r) => ticketTypeById[r.ticket_type]?.code ?? r.ticket_type },
    { key: 'base_fare', header: 'Base Fare', render: (r) => `Rs. ${r.base_fare}` },
    { key: 'peak_fare', header: 'Peak Fare', render: (r) => `Rs. ${r.peak_fare}` },
    { key: 'student_fare', header: 'Student Fare', render: (r) => `Rs. ${r.student_fare}` },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('routes.fareMatrix')}</h1>
          <p className="page-subtitle">The official fare rate (भाडादर) for every route and ticket type</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" leftIcon={<Upload className="h-4 w-4" />} onClick={() => setShowBulk(true)}>
            Bulk Import
          </Button>
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowAdd(true)}>
            Add Fare
          </Button>
        </div>
      </div>

      <select
        className={`${selectClass} max-w-xs`}
        value={routeFilter}
        onChange={(e) => setRouteFilter(e.target.value)}
      >
        <option value="">All routes</option>
        {(routes ?? []).map((r) => (
          <option key={r.id} value={r.id}>{r.route_code} — {r.name_en}</option>
        ))}
      </select>

      <div className="card p-0">
        <Table
          columns={columns}
          data={fares ?? []}
          keyExtractor={(r) => r.id}
          loading={isLoading}
          emptyMessage="No fares set up yet."
        />
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalCount={totalCount}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
        />
      </div>

      {/* Add single fare */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Fare" size="lg">
        <form onSubmit={addForm.handleSubmit((d) => createMutation.mutate(d))} className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Route <span className="text-red-500">*</span>
              </label>
              <select className={selectClass} {...addForm.register('route', { required: true })}>
                <option value="">Select route</option>
                {(routes ?? []).map((r) => <option key={r.id} value={r.id}>{r.route_code} — {r.name_en}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Ticket Type <span className="text-red-500">*</span>
              </label>
              <select className={selectClass} {...addForm.register('ticket_type', { required: true })}>
                <option value="">Select ticket type</option>
                {(ticketTypes ?? []).map((tt) => <option key={tt.id} value={tt.id}>{tt.code} — {tt.name_en}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Zone From (stop name)" placeholder="Leave blank for a flat fare" {...addForm.register('zone_from')} />
            <Input label="Zone To (stop name)" placeholder="Leave blank for a flat fare" {...addForm.register('zone_to')} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input label="Base Fare (NPR)" type="number" step="0.01" min="0" required {...addForm.register('base_fare', { required: true })} />
            <Input label="Peak Fare (NPR)" type="number" step="0.01" min="0" hint="Defaults to Base Fare" {...addForm.register('peak_fare')} />
            <Input label="Student Fare (NPR)" type="number" step="0.01" min="0" hint="Defaults to Base Fare" {...addForm.register('student_fare')} />
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>Add Fare</Button>
          </div>
        </form>
      </Modal>

      {/* Bulk import a whole fare chart */}
      <Modal open={showBulk} onClose={() => setShowBulk(false)} title="Bulk Import Fares" size="full">
        <form onSubmit={bulkForm.handleSubmit(onSubmitBulk)} className="space-y-4 p-6">
          <p className="text-sm text-gray-500">
            Upload a whole stage-fare chart at once — e.g. an operator's handwritten भाडादर sheet
            with one from-stop against many to-stops for a single route and ticket type.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Route <span className="text-red-500">*</span>
              </label>
              <select className={selectClass} {...bulkForm.register('route', { required: true })}>
                <option value="">Select route</option>
                {(routes ?? []).map((r) => <option key={r.id} value={r.id}>{r.route_code} — {r.name_en}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Ticket Type <span className="text-red-500">*</span>
              </label>
              <select className={selectClass} {...bulkForm.register('ticket_type', { required: true })}>
                <option value="">Select ticket type</option>
                {(ticketTypes ?? []).map((tt) => <option key={tt.id} value={tt.id}>{tt.code} — {tt.name_en}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] gap-2 px-1 text-xs font-medium text-gray-500">
            <span>From stop</span>
            <span>To stop</span>
            <span>Base fare</span>
            <span>Peak fare (optional)</span>
            <span>Student fare (optional)</span>
            <span />
          </div>
          <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            {fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] items-center gap-2">
                <Input {...bulkForm.register(`fares.${index}.zone_from` as const, { required: true })} />
                <Input {...bulkForm.register(`fares.${index}.zone_to` as const, { required: true })} />
                <Input type="number" step="0.01" min="0" {...bulkForm.register(`fares.${index}.base_fare` as const, { required: true })} />
                <Input type="number" step="0.01" min="0" {...bulkForm.register(`fares.${index}.peak_fare` as const)} />
                <Input type="number" step="0.01" min="0" {...bulkForm.register(`fares.${index}.student_fare` as const)} />
                <Button
                  variant="ghost" size="sm" type="button"
                  onClick={() => remove(index)}
                  disabled={fields.length === 1}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            ))}
          </div>

          <Button
            variant="secondary" size="sm" type="button"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => append(emptyBulkRow)}
          >
            Add Row
          </Button>

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowBulk(false)}>Cancel</Button>
            <Button type="submit" loading={bulkMutation.isPending}>
              Import {fields.length} Fare{fields.length !== 1 ? 's' : ''}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
