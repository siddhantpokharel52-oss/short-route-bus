/**
 * VehicleCategoriesPage — CRUD for operator-defined vehicle categories
 * (Route/Group Rotation doc section 4.2). Every vehicle and group reads
 * from this list, so it's meant to be set up before fleet/groups are built
 * out (doc section 5.2).
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Layers, Pencil, Trash2, Snowflake } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Table, Column } from '@components/shared/Table'
import { Badge } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import vehicleCategoryService, { VehicleCategory, VehicleCategoryPayload } from '@services/vehicleCategoryService'
import toast from 'react-hot-toast'
import { useForm, Controller } from 'react-hook-form'

function SelectField({
  label, required, children, error, ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; required?: boolean; error?: string }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <select
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        {...props}
      >
        {children}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

interface CategoryForm {
  code: string
  name_en: string
  name_ne: string
  seating_capacity: number
  body_class: VehicleCategory['body_class']
  air_conditioned: boolean
  fuel_type: VehicleCategory['fuel_type']
  permit_class: string
}

export default function VehicleCategoriesPage() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<VehicleCategory | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<VehicleCategory | null>(null)

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['vehicle-categories'],
    queryFn: () => vehicleCategoryService.list(),
  })

  const { register, handleSubmit, reset, control, setError, formState: { errors } } = useForm<CategoryForm>({
    defaultValues: { body_class: 'STANDARD', fuel_type: 'DIESEL', air_conditioned: false },
  })

  const openCreate = () => {
    setEditTarget(null)
    reset({ code: '', name_en: '', name_ne: '', seating_capacity: undefined, body_class: 'STANDARD', fuel_type: 'DIESEL', air_conditioned: false, permit_class: '' })
    setShowForm(true)
  }

  const openEdit = (cat: VehicleCategory) => {
    setEditTarget(cat)
    reset({
      code: cat.code, name_en: cat.name_en, name_ne: cat.name_ne, seating_capacity: cat.seating_capacity,
      body_class: cat.body_class, air_conditioned: cat.air_conditioned, fuel_type: cat.fuel_type, permit_class: cat.permit_class,
    })
    setShowForm(true)
  }

  const saveMutation = useMutation({
    mutationFn: (payload: VehicleCategoryPayload) =>
      editTarget ? vehicleCategoryService.update(editTarget.id, payload) : vehicleCategoryService.create(payload),
    onSuccess: () => {
      toast.success(editTarget ? 'Category updated.' : 'Category created.')
      qc.invalidateQueries({ queryKey: ['vehicle-categories'] })
      setShowForm(false)
      reset()
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { errors?: Record<string, string[]>; message?: string } } }
      const errors = e?.response?.data?.errors
      if (errors) {
        Object.entries(errors).forEach(([field, messages]) => {
          setError(field as keyof CategoryForm, { type: 'server', message: Array.isArray(messages) ? messages[0] : String(messages) })
        })
      }
      toast.error(e?.response?.data?.message || 'Failed to save category.')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => vehicleCategoryService.delete(id),
    onSuccess: () => {
      toast.success('Category deleted.')
      qc.invalidateQueries({ queryKey: ['vehicle-categories'] })
      setDeleteTarget(null)
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to delete category.')
    },
  })

  const columns: Column<VehicleCategory>[] = [
    {
      key: 'code', header: 'Code',
      render: (c) => (
        <div>
          <span className="font-mono font-semibold text-primary-700">{c.code}</span>
          <p className="text-xs text-gray-400">{c.name_en}</p>
        </div>
      ),
    },
    { key: 'seating_capacity', header: 'Seats', render: (c) => <span>{c.seating_capacity}</span> },
    { key: 'body_class', header: 'Body Class', render: (c) => <Badge variant="neutral">{c.body_class}</Badge> },
    {
      key: 'air_conditioned', header: 'AC',
      render: (c) => c.air_conditioned
        ? <span className="flex items-center gap-1 text-xs font-medium text-blue-600"><Snowflake className="h-3.5 w-3.5" /> AC</span>
        : <span className="text-xs text-gray-400">Non-AC</span>,
    },
    { key: 'permit_class', header: 'Permit Class', render: (c) => c.permit_class || <span className="text-gray-300">—</span> },
    { key: 'vehicle_count', header: 'Vehicles', render: (c) => <Badge variant="info">{c.vehicle_count}</Badge> },
    { key: 'is_active', header: 'Status', render: (c) => <Badge variant={c.is_active ? 'success' : 'neutral'} dot>{c.is_active ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'id', header: 'Actions',
      render: (c) => (
        <div className="flex items-center gap-1">
          <button onClick={() => openEdit(c)} className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100">
            <Pencil className="h-3 w-3" /> {t('common.edit')}
          </button>
          <button onClick={() => setDeleteTarget(c)} className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100">
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
          <h1 className="page-title flex items-center gap-2"><Layers className="h-6 w-6 text-primary-600" /> Vehicle Categories</h1>
          <p className="page-subtitle">Define the classes of bus your fleet falls into -- seats, AC, permit class</p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>Add Category</Button>
      </div>

      <div className="card p-0 overflow-hidden">
        <Table
          columns={columns}
          data={categories}
          keyExtractor={(c) => c.id}
          loading={isLoading}
          emptyMessage="No categories yet -- add your first one to start categorising your fleet."
        />
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editTarget ? 'Edit Category' : 'Add Category'} size="md">
        <form onSubmit={handleSubmit((d) => saveMutation.mutate(d))} className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Code" placeholder="e.g. DLX-35" required error={errors.code?.message} {...register('code', { required: 'Required' })} />
            <Input label="Seating Capacity" type="number" required error={errors.seating_capacity?.message} {...register('seating_capacity', { required: 'Required', valueAsNumber: true, min: { value: 1, message: 'Must be at least 1' } })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name (English)" placeholder="e.g. Deluxe AC 35-seat" required error={errors.name_en?.message} {...register('name_en', { required: 'Required' })} />
            <Input label="Name (Nepali)" {...register('name_ne')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Controller
              name="body_class" control={control} rules={{ required: true }}
              render={({ field }) => (
                <SelectField label="Body Class" required {...field}>
                  <option value="MICRO">Micro</option>
                  <option value="MINI">Mini</option>
                  <option value="STANDARD">Standard</option>
                  <option value="DELUXE">Deluxe</option>
                </SelectField>
              )}
            />
            <Controller
              name="fuel_type" control={control} rules={{ required: true }}
              render={({ field }) => (
                <SelectField label="Fuel Type" required {...field}>
                  <option value="DIESEL">Diesel</option>
                  <option value="PETROL">Petrol</option>
                  <option value="CNG">CNG</option>
                  <option value="ELECTRIC">Electric</option>
                  <option value="HYBRID">Hybrid</option>
                </SelectField>
              )}
            />
          </div>
          <div className="grid grid-cols-2 gap-4 items-end">
            <Input label="Permit Class" placeholder="e.g. city-A" {...register('permit_class')} />
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5">
              <input type="checkbox" id="air_conditioned" className="h-4 w-4 rounded border-gray-300 text-primary-600" {...register('air_conditioned')} />
              <label htmlFor="air_conditioned" className="text-sm text-gray-700 cursor-pointer">Air Conditioned</label>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={saveMutation.isPending}>{editTarget ? t('common.update') : t('common.save')}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Category" size="sm">
        {deleteTarget && (
          <div className="p-5 space-y-4">
            <div className="rounded-xl border border-red-100 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-700 mb-1">This cannot be undone</p>
              <p className="text-sm text-red-600">
                Category '{deleteTarget.name_en}' ({deleteTarget.code}) will be permanently removed.
                {deleteTarget.vehicle_count > 0 && ` It's currently used by ${deleteTarget.vehicle_count} vehicle(s).`}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Keep Category</Button>
              <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate(deleteTarget.id)}>Delete Category</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
