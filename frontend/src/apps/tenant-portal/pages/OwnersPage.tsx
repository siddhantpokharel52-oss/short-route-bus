/**
 * OwnersPage — CRUD for bus owners (Team Implementation Guide §3.7). A
 * tenant's fleet can include buses belonging to several different owners;
 * this is where an admin creates that owner record and (optionally) links
 * a User so the owner can log in and see their own dashboard. Vehicle-to-
 * owner assignment itself happens on the existing vehicle edit form
 * (FleetPage.tsx), not here.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Wallet2, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Table, Column } from '@components/shared/Table'
import { Badge } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import ownerService, { Owner, OwnerPayload } from '@services/ownerService'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'

interface OwnerForm {
  name: string
  phone: string
  email: string
  user_id: string
}

export default function OwnersPage() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<Owner | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Owner | null>(null)

  const { data: owners = [], isLoading } = useQuery({
    queryKey: ['owners'],
    queryFn: () => ownerService.list(),
  })

  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<OwnerForm>()

  const openCreate = () => {
    setEditTarget(null)
    reset({ name: '', phone: '', email: '', user_id: '' })
    setShowForm(true)
  }

  const openEdit = (owner: Owner) => {
    setEditTarget(owner)
    reset({ name: owner.name, phone: owner.phone, email: owner.email, user_id: owner.user_id ?? '' })
    setShowForm(true)
  }

  const saveMutation = useMutation({
    mutationFn: (payload: OwnerPayload) =>
      editTarget ? ownerService.update(editTarget.id, payload) : ownerService.create(payload),
    onSuccess: () => {
      toast.success(editTarget ? t('owners.updated', { defaultValue: 'Owner updated.' }) : t('owners.created', { defaultValue: 'Owner created.' }))
      qc.invalidateQueries({ queryKey: ['owners'] })
      setShowForm(false)
      reset()
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { errors?: Record<string, string[]>; message?: string } } }
      const errors = e?.response?.data?.errors
      if (errors) {
        Object.entries(errors).forEach(([field, messages]) => {
          setError(field as keyof OwnerForm, { type: 'server', message: Array.isArray(messages) ? messages[0] : String(messages) })
        })
      }
      toast.error(e?.response?.data?.message || 'Failed to save owner.')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => ownerService.delete(id),
    onSuccess: () => {
      toast.success(t('owners.deleted', { defaultValue: 'Owner deleted.' }))
      qc.invalidateQueries({ queryKey: ['owners'] })
      setDeleteTarget(null)
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to delete owner.')
    },
  })

  const columns: Column<Owner>[] = [
    {
      key: 'name', header: t('owners.name', { defaultValue: 'Name' }),
      render: (o) => (
        <div>
          <span className="font-semibold text-gray-900">{o.name}</span>
          {o.email && <p className="text-xs text-gray-400">{o.email}</p>}
        </div>
      ),
    },
    { key: 'phone', header: t('owners.phone', { defaultValue: 'Phone' }), render: (o) => o.phone || <span className="text-gray-300">—</span> },
    { key: 'vehicle_count', header: t('owners.buses', { defaultValue: 'Buses' }), render: (o) => <Badge variant="info">{o.vehicle_count}</Badge> },
    {
      key: 'user_id', header: t('owners.loginLinked', { defaultValue: 'Login Linked' }),
      render: (o) => o.user_id
        ? <Badge variant="success" dot>{t('owners.linked', { defaultValue: 'Linked' })}</Badge>
        : <Badge variant="neutral" dot>{t('owners.notLinked', { defaultValue: 'Not linked' })}</Badge>,
    },
    { key: 'is_active', header: t('owners.status', { defaultValue: 'Status' }), render: (o) => <Badge variant={o.is_active ? 'success' : 'neutral'} dot>{o.is_active ? t('owners.active', { defaultValue: 'Active' }) : t('owners.inactive', { defaultValue: 'Inactive' })}</Badge> },
    {
      key: 'id', header: t('common.actions', { defaultValue: 'Actions' }),
      render: (o) => (
        <div className="flex items-center gap-1">
          <button onClick={() => openEdit(o)} className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100">
            <Pencil className="h-3 w-3" /> {t('common.edit')}
          </button>
          <button onClick={() => setDeleteTarget(o)} className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100">
            <Trash2 className="h-3 w-3" /> {t('common.delete')}
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2"><Wallet2 className="h-6 w-6 text-primary-600" /> {t('owners.title', { defaultValue: 'Bus Owners' })}</h1>
          <p className="page-subtitle">{t('owners.subtitle', { defaultValue: 'Owners in your fleet -- assign a bus to one from the vehicle edit form' })}</p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>{t('owners.addOwner', { defaultValue: 'Add Owner' })}</Button>
      </div>

      <div className="card p-0 overflow-hidden">
        <Table
          columns={columns}
          data={owners}
          keyExtractor={(o) => o.id}
          loading={isLoading}
          emptyMessage={t('owners.empty', { defaultValue: 'No owners yet -- add one, then assign buses to them from the fleet page.' })}
        />
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editTarget ? t('owners.editOwner', { defaultValue: 'Edit Owner' }) : t('owners.addOwner', { defaultValue: 'Add Owner' })} size="md">
        <form onSubmit={handleSubmit((d) => saveMutation.mutate({ ...d, user_id: d.user_id || null }))} className="space-y-4 p-6">
          <Input label={t('owners.name', { defaultValue: 'Name' })} required error={errors.name?.message} {...register('name', { required: 'Required' })} />
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('owners.phone', { defaultValue: 'Phone' })} {...register('phone')} />
            <Input label={t('owners.email', { defaultValue: 'Email' })} type="email" {...register('email')} />
          </div>
          <Input
            label={t('owners.userId', { defaultValue: 'Login User ID (optional)' })}
            placeholder="UUID of the User who can log in as this owner"
            error={errors.user_id?.message}
            {...register('user_id')}
          />
          <p className="text-xs text-gray-400">
            {t('owners.userIdHint', { defaultValue: 'Leave blank until the owner has a User account with the Bus Owner role -- link it here once they do, so they can see their own earnings dashboard.' })}
          </p>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={saveMutation.isPending}>{editTarget ? t('common.update') : t('common.save')}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t('owners.deleteOwner', { defaultValue: 'Delete Owner' })} size="sm">
        {deleteTarget && (
          <div className="p-5 space-y-4">
            <div className="rounded-xl border border-red-100 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-700 mb-1">{t('owners.cannotBeUndone', { defaultValue: 'This cannot be undone' })}</p>
              <p className="text-sm text-red-600">
                {t('owners.deleteWarning', { defaultValue: '{{name}} will be permanently removed.', name: deleteTarget.name })}
                {deleteTarget.vehicle_count > 0 && ` ${t('owners.usedByVehicles', { defaultValue: 'Their {{count}} bus(es) will become unassigned.', count: deleteTarget.vehicle_count })}`}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t('owners.keepOwner', { defaultValue: 'Keep Owner' })}</Button>
              <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate(deleteTarget.id)}>{t('owners.deleteOwner', { defaultValue: 'Delete Owner' })}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
