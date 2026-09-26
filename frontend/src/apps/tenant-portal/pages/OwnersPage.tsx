/**
 * OwnersPage — CRUD for bus owners (Team Implementation Guide §3.7). A
 * tenant's fleet can include buses belonging to several different owners;
 * this is where an admin creates that owner record and (optionally) links
 * a User so the owner can log in and see their own dashboard. Vehicle-to-
 * owner assignment itself happens on the existing vehicle edit form
 * (FleetPage.tsx), not here.
 */
import { useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Wallet2, Pencil, Trash2, KeyRound, Eye, EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Table, Column } from '@components/shared/Table'
import { Badge } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import ownerService, { Owner, OwnerPayload } from '@services/ownerService'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import { sanitizePhoneDigits, isValidPhone, PHONE_VALIDATION_MESSAGE } from '@utils/phone'
import { isValidEmail, EMAIL_VALIDATION_MESSAGE } from '@utils/email'
import { isValidPassword, PASSWORD_VALIDATION_MESSAGE } from '@utils/password'

interface OwnerForm {
  name: string
  phone: string
  email: string
  bank_account_no: string
}

/**
 * Shows the login status for one owner row. While Owner.temp_password is
 * still set (the owner hasn't signed in and replaced it yet), the tenant
 * admin can view it via the eye toggle -- once the owner sets their own
 * password, the backend clears temp_password and this collapses to a plain
 * "Password set" badge with no value to show, ever.
 */
function LoginStatusCell({ owner }: { owner: Owner }) {
  const [revealed, setRevealed] = useState(false)

  if (!owner.user_id) {
    return <Badge variant="neutral" dot>Not linked</Badge>
  }
  if (owner.temp_password) {
    return (
      <div className="flex items-center gap-1.5">
        <Badge variant="warning" dot>Temporary</Badge>
        <span className="font-mono text-xs text-gray-600">
          {revealed ? owner.temp_password : '••••••••'}
        </span>
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          className="text-gray-400 hover:text-gray-600"
          aria-label={revealed ? 'Hide temporary password' : 'Show temporary password'}
        >
          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
    )
  }
  return <Badge variant="success" dot>New password has been set by the owner</Badge>
}

function DetailRow({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</span>
      <span className="text-sm text-gray-900">{value ?? '—'}</span>
    </div>
  )
}

/** Same three states as LoginStatusCell, laid out for the View modal's detail grid. */
function LoginDetailValue({ owner }: { owner: Owner }) {
  const [revealed, setRevealed] = useState(false)

  if (!owner.user_id) {
    return <Badge variant="neutral" dot>Not linked</Badge>
  }
  if (owner.temp_password) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="warning" dot>Temporary password</Badge>
        <span className="font-mono text-sm text-gray-900">
          {revealed ? owner.temp_password : '••••••••'}
        </span>
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          className="text-gray-400 hover:text-gray-600"
          aria-label={revealed ? 'Hide temporary password' : 'Show temporary password'}
        >
          {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    )
  }
  return <Badge variant="success" dot>New password has been set by the owner</Badge>
}

export default function OwnersPage() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [viewTarget, setViewTarget] = useState<Owner | null>(null)
  const [editTarget, setEditTarget] = useState<Owner | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Owner | null>(null)
  const [loginTarget, setLoginTarget] = useState<Owner | null>(null)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  const { data: owners = [], isLoading } = useQuery({
    queryKey: ['owners'],
    queryFn: () => ownerService.list(),
  })

  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<OwnerForm>()

  const openCreate = () => {
    setEditTarget(null)
    reset({ name: '', phone: '', email: '', bank_account_no: '' })
    setShowForm(true)
  }

  const openEdit = (owner: Owner) => {
    setEditTarget(owner)
    reset({ name: owner.name, phone: owner.phone, email: owner.email, bank_account_no: owner.bank_account_no ?? '' })
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

  const createLoginMutation = useMutation({
    mutationFn: ({ id, email, password }: { id: string; email: string; password: string }) =>
      apiClient.post(`/fleet/owners/${id}/create-login/`, { email, password }),
    onSuccess: () => {
      toast.success(t('owners.loginCreated', { defaultValue: 'Login created.' }))
      setLoginTarget(null)
      setLoginEmail('')
      setLoginPassword('')
      qc.invalidateQueries({ queryKey: ['owners'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to create login.')
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
      key: 'user_id', header: t('owners.loginLinked', { defaultValue: 'Login' }),
      render: (o) => <LoginStatusCell owner={o} />,
    },
    { key: 'is_active', header: t('owners.status', { defaultValue: 'Status' }), render: (o) => <Badge variant={o.is_active ? 'success' : 'neutral'} dot>{o.is_active ? t('owners.active', { defaultValue: 'Active' }) : t('owners.inactive', { defaultValue: 'Inactive' })}</Badge> },
    {
      key: 'id', header: t('common.actions', { defaultValue: 'Actions' }),
      render: (o) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewTarget(o)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
            title={t('common.view', { defaultValue: 'View' })}
          >
            <Eye className="h-4 w-4" />
          </button>
          <button onClick={() => openEdit(o)} className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100">
            <Pencil className="h-3 w-3" /> {t('common.edit')}
          </button>
          {!o.user_id && (
            <button
              onClick={() => { setLoginTarget(o); setLoginEmail(o.email || '') }}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              <KeyRound className="h-3 w-3" /> {t('owners.createLogin', { defaultValue: 'Create Login' })}
            </button>
          )}
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

      <Modal
        open={!!viewTarget}
        onClose={() => setViewTarget(null)}
        title={t('owners.viewOwner', { defaultValue: 'Owner — {{name}}', name: viewTarget?.name ?? '' })}
        size="md"
      >
        {viewTarget && (
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <DetailRow label={t('owners.name', { defaultValue: 'Name' })} value={viewTarget.name} />
              <DetailRow label={t('owners.status', { defaultValue: 'Status' })} value={
                <Badge variant={viewTarget.is_active ? 'success' : 'neutral'} dot>
                  {viewTarget.is_active ? t('owners.active', { defaultValue: 'Active' }) : t('owners.inactive', { defaultValue: 'Inactive' })}
                </Badge>
              } />
              <DetailRow label={t('owners.phone', { defaultValue: 'Phone' })} value={viewTarget.phone} />
              <DetailRow label={t('owners.email', { defaultValue: 'Email' })} value={viewTarget.email} />
              <DetailRow label={t('owners.bankAccountNo', { defaultValue: 'Bank Account No.' })} value={viewTarget.bank_account_no} />
              <DetailRow label={t('owners.buses', { defaultValue: 'Buses' })} value={<Badge variant="info">{viewTarget.vehicle_count}</Badge>} />
            </div>
            <div className="border-t pt-4">
              <DetailRow label={t('owners.loginLinked', { defaultValue: 'Login' })} value={<LoginDetailValue owner={viewTarget} />} />
            </div>
            <div className="flex justify-end border-t pt-4">
              <Button variant="secondary" onClick={() => setViewTarget(null)}>{t('common.close', { defaultValue: 'Close' })}</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editTarget ? t('owners.editOwner', { defaultValue: 'Edit Owner' }) : t('owners.addOwner', { defaultValue: 'Add Owner' })} size="md">
        <form onSubmit={handleSubmit((d) => saveMutation.mutate(d))} className="space-y-4 p-6">
          <Input label={t('owners.name', { defaultValue: 'Name' })} required error={errors.name?.message} {...register('name', { required: 'Required' })} />
          <Input
            label={t('owners.phone', { defaultValue: 'Phone' })}
            required
            maxLength={10}
            inputMode="numeric"
            error={errors.phone?.message}
            {...register('phone', {
              required: 'Required',
              validate: (v) => isValidPhone(v) || PHONE_VALIDATION_MESSAGE,
              onChange: (e) => { e.target.value = sanitizePhoneDigits(e.target.value) },
            })}
          />
          <Input
            label={t('owners.email', { defaultValue: 'Email' })}
            type="email"
            required
            error={errors.email?.message}
            {...register('email', {
              required: 'Required',
              validate: (v) => isValidEmail(v) || EMAIL_VALIDATION_MESSAGE,
            })}
          />
          <Input
            label={t('owners.bankAccountNo', { defaultValue: 'Bank Account No.' })}
            placeholder="e.g. 0123456789012"
            {...register('bank_account_no')}
          />
          {editTarget && (
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              {!editTarget.user_id
                ? t('owners.loginStatusUnlinked', { defaultValue: 'Login: not set up yet -- use "Create Login" from the table after closing this form.' })
                : editTarget.temp_password
                  ? t('owners.loginStatusTemp', { defaultValue: 'Login: using a temporary password -- view it from the table until the owner signs in and sets their own.' })
                  : t('owners.loginStatusLinked', { defaultValue: 'Login: linked -- this owner has set their own password and can see their own dashboard.' })}
            </div>
          )}
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

      <Modal
        open={!!loginTarget}
        onClose={() => { setLoginTarget(null); setLoginEmail(''); setLoginPassword('') }}
        title={t('owners.createLoginFor', { defaultValue: 'Create Login — {{name}}', name: loginTarget?.name ?? '' })}
        size="sm"
      >
        {loginTarget && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-600">
              {t('owners.createLoginHint', { defaultValue: 'Lets {{name}} sign in and see their own earnings dashboard.', name: loginTarget.name })}
            </p>
            <Input
              label={t('owners.email', { defaultValue: 'Email' })} type="email" required
              placeholder="e.g. owner@example.com"
              value={loginEmail}
              error={loginEmail && !isValidEmail(loginEmail) ? EMAIL_VALIDATION_MESSAGE : undefined}
              onChange={(e) => setLoginEmail(e.target.value)}
            />
            <Input
              label={t('owners.password', { defaultValue: 'Password' })} type="password" required
              placeholder={t('owners.tempPassword', { defaultValue: 'Temporary password' })}
              value={loginPassword}
              error={loginPassword && !isValidPassword(loginPassword) ? PASSWORD_VALIDATION_MESSAGE : undefined}
              onChange={(e) => setLoginPassword(e.target.value)}
            />
            <div className="flex justify-end gap-3 border-t pt-4">
              <Button variant="secondary" onClick={() => { setLoginTarget(null); setLoginEmail(''); setLoginPassword('') }}>
                {t('common.cancel')}
              </Button>
              <Button
                loading={createLoginMutation.isPending}
                disabled={!isValidEmail(loginEmail) || !isValidPassword(loginPassword)}
                leftIcon={<KeyRound className="h-4 w-4" />}
                onClick={() => createLoginMutation.mutate({ id: loginTarget.id, email: loginEmail, password: loginPassword })}
              >
                {t('owners.createLogin', { defaultValue: 'Create Login' })}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
