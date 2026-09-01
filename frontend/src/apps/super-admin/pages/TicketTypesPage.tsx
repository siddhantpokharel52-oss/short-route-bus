/**
 * TicketTypesPage — manage the passenger/ticket categories (Adult, Student,
 * Senior, ...) that FareMatrix prices against. Platform-wide reference data,
 * not tenant-specific -- there's no tenant-portal counterpart, same as
 * Routes/Stops.
 *
 * Note: the backend's list/retrieve queryset only ever returns
 * is_active=True ticket types (TicketTypeViewSet.queryset filters on it) --
 * so a deactivated type disappears from this page entirely with no way to
 * reactivate it through this UI or the API (it 404s on retrieve too, since
 * the same filtered queryset backs that action). To keep this page from
 * being a one-way trap, it intentionally does not expose an "is_active"
 * toggle -- only Django admin can currently undo a deactivation.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { NepaliInput } from '@components/shared/NepaliInput'
import { Table, Column } from '@components/shared/Table'
import { Badge } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'

interface TicketType {
  id: string
  code: string
  name_en: string
  name_ne: string
  description: string
  validity_hours: number
  is_transferable: boolean
}

interface TicketTypeFormValues {
  code: string
  name_en: string
  name_ne: string
  description: string
  validity_hours: number
  is_transferable: boolean
}

function flattenErrors(errors: Record<string, string[] | string>): string {
  return Object.entries(errors)
    .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`)
    .join(' | ')
}

export default function TicketTypesPage() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<TicketType | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['ticket-types'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/ticket-types/', { params: { page_size: 100 } })
      return (data.data ?? []) as TicketType[]
    },
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['ticket-types'] })

  const addForm = useForm<TicketTypeFormValues>({
    defaultValues: { validity_hours: 4, is_transferable: false },
  })

  const createMutation = useMutation({
    mutationFn: (payload: TicketTypeFormValues) =>
      apiClient.post('/platform/ticket-types/', payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('Ticket type created.')
      setShowAdd(false)
      addForm.reset({ validity_hours: 4, is_transferable: false })
      invalidate()
    },
    onError: (err: any) => {
      const errors = err?.response?.data?.errors
      toast.error(errors && typeof errors === 'object' ? flattenErrors(errors) : (err?.response?.data?.message || 'Failed to create ticket type.'))
    },
  })

  const editForm = useForm<TicketTypeFormValues>()

  const updateMutation = useMutation({
    mutationFn: (payload: TicketTypeFormValues) =>
      apiClient.patch(`/platform/ticket-types/${editing?.id}/`, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('Ticket type updated.')
      setEditing(null)
      invalidate()
    },
    onError: (err: any) => {
      const errors = err?.response?.data?.errors
      toast.error(errors && typeof errors === 'object' ? flattenErrors(errors) : (err?.response?.data?.message || 'Failed to update ticket type.'))
    },
  })

  const openEdit = (tt: TicketType) => {
    setEditing(tt)
    editForm.reset({
      code: tt.code, name_en: tt.name_en, name_ne: tt.name_ne,
      description: tt.description, validity_hours: tt.validity_hours,
      is_transferable: tt.is_transferable,
    })
  }

  const columns: Column<TicketType>[] = [
    { key: 'code', header: 'Code', render: (r) => <span className="font-mono font-bold text-primary-600">{r.code}</span> },
    {
      key: 'name_en', header: 'Name',
      render: (r) => (
        <div>
          <p className="font-medium">{r.name_en}</p>
          <p className="text-xs text-gray-400">{r.name_ne}</p>
        </div>
      ),
    },
    { key: 'validity_hours', header: 'Validity', render: (r) => `${r.validity_hours} hr` },
    {
      key: 'is_transferable', header: 'Transferable',
      render: (r) => <Badge variant={r.is_transferable ? 'success' : 'neutral'} dot>{r.is_transferable ? 'Yes' : 'No'}</Badge>,
    },
    {
      key: 'id', header: '',
      render: (r) => <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>Edit</Button>,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ticket Types</h1>
          <p className="page-subtitle">Passenger categories (Adult, Student, ...) that fares are priced against</p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowAdd(true)}>
          Add Ticket Type
        </Button>
      </div>

      <div className="card p-0">
        <Table
          columns={columns}
          data={data ?? []}
          keyExtractor={(r) => r.id}
          loading={isLoading}
          emptyMessage="No ticket types yet."
        />
      </div>

      {/* Add */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Ticket Type" size="lg">
        <form onSubmit={addForm.handleSubmit((d) => createMutation.mutate(d))} className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Code" placeholder="e.g. STUDENT" required
              {...addForm.register('code', { required: true })}
            />
            <Input
              label="Validity (hours)" type="number" min="1" required
              {...addForm.register('validity_hours', { required: true, valueAsNumber: true })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name (English)" required {...addForm.register('name_en', { required: true })} />
            <NepaliInput label="Name (Nepali)" {...addForm.register('name_ne')} />
          </div>
          <Input label="Description" {...addForm.register('description')} />
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" {...addForm.register('is_transferable')} />
            Transferable (can be handed to another passenger)
          </label>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>Create</Button>
          </div>
        </form>
      </Modal>

      {/* Edit */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit ${editing?.code ?? ''}`} size="lg">
        <form onSubmit={editForm.handleSubmit((d) => updateMutation.mutate(d))} className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Code" required {...editForm.register('code', { required: true })} />
            <Input
              label="Validity (hours)" type="number" min="1" required
              {...editForm.register('validity_hours', { required: true, valueAsNumber: true })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name (English)" required {...editForm.register('name_en', { required: true })} />
            <NepaliInput label="Name (Nepali)" {...editForm.register('name_ne')} />
          </div>
          <Input label="Description" {...editForm.register('description')} />
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" {...editForm.register('is_transferable')} />
            Transferable (can be handed to another passenger)
          </label>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" type="button" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" loading={updateMutation.isPending}>Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
