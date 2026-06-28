import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, User, Briefcase, Bus, Heart, Wallet, Trash2, Eye, Pencil, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { NepaliInput } from '@components/shared/NepaliInput'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge, statusVariant } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { usePagination } from '@hooks/usePagination'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { useForm, Controller } from 'react-hook-form'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Collector {
  id: string
  employee_id: string
  full_name_en: string
  full_name_ne: string
  gender: string
  dob: string
  phone: string
  address: string
  citizenship_no: string
  emergency_contact_name: string
  emergency_contact_number: string
  shift: string
  blood_group: string
  employment_type: string
  date_of_joining: string
  assigned_vehicle_id: string | null
  assigned_route_id: string | null
  basic_salary: string
  status: string
}

interface CollectorForm {
  full_name_en: string
  full_name_ne: string
  gender: string
  dob: string
  citizenship_no: string
  phone: string
  address: string
  emergency_contact_name: string
  emergency_contact_number: string
  blood_group: string
  employment_type: string
  date_of_joining: string
  shift: string
  assigned_vehicle_id: string
  assigned_route_id: string
  basic_salary: string
}

// ─── Shared helpers ───────────────────────────────────────────────────────────
function Section({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-gray-200 pb-2 pt-2">
      <Icon className="h-4 w-4 text-primary-600" />
      <h3 className="text-sm font-semibold uppercase tracking-wide text-primary-700">{title}</h3>
    </div>
  )
}

function SelectField({
  label, required, children, error, ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; required?: boolean; error?: string }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <select
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                   focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        {...props}
      >
        {children}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</span>
      <span className="text-sm text-gray-900">{value ?? '—'}</span>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ConductorsPage() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [allowances, setAllowances] = useState<{ title: string; amount: string }[]>([])
  const pagination = usePagination(totalCount)

  // ── CRUD targets ─────────────────────────────────────────────────────────────
  const [viewTarget, setViewTarget] = useState<Collector | null>(null)
  const [editTarget, setEditTarget] = useState<Collector | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Collector | null>(null)

  // ── Edit form state ───────────────────────────────────────────────────────────
  const [editStatus, setEditStatus] = useState('')
  const [editShift, setEditShift] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editBloodGroup, setEditBloodGroup] = useState('')
  const [editEmploymentType, setEditEmploymentType] = useState('')
  const [editVehicleId, setEditVehicleId] = useState('')
  const [editRouteId, setEditRouteId] = useState('')

  useEffect(() => {
    if (!editTarget) return
    setEditStatus(editTarget.status ?? '')
    setEditShift(editTarget.shift ?? '')
    setEditPhone(editTarget.phone ?? '')
    setEditBloodGroup(editTarget.blood_group ?? '')
    setEditEmploymentType(editTarget.employment_type ?? '')
    setEditVehicleId(editTarget.assigned_vehicle_id ?? '')
    setEditRouteId(editTarget.assigned_route_id ?? '')
  }, [editTarget])

  // ── Queries ───────────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['conductors', pagination.page, search],
    queryFn: async () => {
      const { data } = await apiClient.get('/operator/conductors/', {
        params: { ...pagination.queryParams, ...(search && { search }) },
      })
      setTotalCount(data.meta?.total_count ?? data.data?.count ?? 0)
      return data.data?.results ?? data.data ?? []
    },
  })

  const { data: routes = [] } = useQuery({
    queryKey: ['routes-dropdown'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/routes/?page_size=200')
      return data.data?.results ?? data.data ?? []
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles-dropdown'],
    queryFn: async () => {
      const { data } = await apiClient.get('/fleet/vehicles/?page_size=200')
      return data.data?.results ?? data.data ?? []
    },
    staleTime: 5 * 60 * 1000,
  })

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<CollectorForm>({
    defaultValues: { gender: 'MALE', employment_type: 'PERMANENT', shift: '', assigned_route_id: '', assigned_vehicle_id: '' },
  })

  // ── Create ────────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (payload: CollectorForm) =>
      apiClient.post('/operator/conductors/', {
        ...payload,
        assigned_vehicle_id: payload.assigned_vehicle_id || null,
        assigned_route_id: payload.assigned_route_id || null,
        basic_salary: payload.basic_salary || null,
        allowances: allowances
          .filter((a) => a.title.trim())
          .map((a) => ({ title: a.title.trim(), amount: parseFloat(a.amount) || 0 })),
      }),
    onSuccess: () => {
      toast.success('Collector added successfully!')
      setShowCreate(false)
      reset()
      setAllowances([])
      qc.invalidateQueries({ queryKey: ['conductors'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { message?: string; errors?: Record<string, unknown> } } }
      if (e?.response?.status === 403) return
      const res = e?.response?.data
      if (res?.errors && typeof res.errors === 'object' && Object.keys(res.errors).length > 0) {
        const firstKey = Object.keys(res.errors)[0]
        const val = res.errors[firstKey]
        toast.error(`${firstKey}: ${Array.isArray(val) ? String(val[0]) : String(val)}`)
      } else {
        toast.error(res?.message || (err as Error).message || 'Failed to add collector')
      }
    },
  })

  // ── Update ────────────────────────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: (payload: Partial<Collector>) =>
      apiClient.patch(`/operator/conductors/${editTarget!.id}/`, payload),
    onSuccess: () => {
      toast.success('Collector updated successfully!')
      setEditTarget(null)
      qc.invalidateQueries({ queryKey: ['conductors'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to update collector')
    },
  })

  // ── Delete ────────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/operator/conductors/${id}/`),
    onSuccess: () => {
      toast.success('Collector removed successfully.')
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['conductors'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to delete collector')
    },
  })

  const handleUpdate = () => {
    updateMutation.mutate({
      status: editStatus,
      shift: editShift || undefined,
      phone: editPhone,
      blood_group: editBloodGroup || undefined,
      employment_type: editEmploymentType,
      assigned_vehicle_id: editVehicleId || null,
      assigned_route_id: editRouteId || null,
    })
  }

  const vehicleMap = new Map(
    (vehicles as { id: string; registration_no: string }[]).map((v) => [v.id, v.registration_no])
  )

  const routeMap = new Map(
    (routes as { id: string; route_code?: string; name_en?: string }[]).map((r) => [
      r.id,
      r.route_code ? `${r.route_code} — ${r.name_en ?? ''}` : (r.name_en ?? r.id),
    ])
  )

  // ── Table columns ─────────────────────────────────────────────────────────────
  const columns: Column<Collector>[] = [
    {
      key: 'employee_id',
      header: t('staff.conductors.employeeId'),
      render: (c) => (
        <code className="rounded bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
          {c.employee_id}
        </code>
      ),
    },
    {
      key: 'full_name_en',
      header: t('staff.conductors.title'),
      render: (c) => (
        <div>
          <p className="font-medium text-gray-900">{c.full_name_en}</p>
          <p className="text-xs text-gray-400">{c.phone}</p>
        </div>
      ),
    },
    { key: 'gender', header: t('staff.conductors.gender'), render: (c) => c.gender || '—' },
    {
      key: 'shift',
      header: t('staff.conductors.shift'),
      render: (c) => c.shift
        ? <Badge variant="info">{c.shift}</Badge>
        : <span className="text-gray-400 text-sm">—</span>,
    },
    {
      key: 'assigned_vehicle_id',
      header: t('staff.conductors.assignedBus'),
      render: (c) => c.assigned_vehicle_id
        ? (
          <div className="flex items-center gap-1.5">
            <Bus className="h-3.5 w-3.5 text-primary-500" />
            <code className="text-xs font-medium text-primary-700">
              {vehicleMap.get(c.assigned_vehicle_id) ?? c.assigned_vehicle_id.slice(0, 8)}
            </code>
          </div>
        )
        : <span className="text-xs text-gray-400 italic">Not assigned</span>,
    },
    {
      key: 'employment_type',
      header: t('staff.conductors.employmentType'),
      render: (c) => c.employment_type?.replace('_', ' ') || '—',
    },
    { key: 'blood_group', header: t('staff.conductors.bloodGroup'), render: (c) => c.blood_group || '—' },
    {
      key: 'status',
      header: t('common.status'),
      render: (c) => <Badge variant={statusVariant(c.status)} dot>{c.status}</Badge>,
    },
    {
      key: 'id',
      header: t('common.actions'),
      render: (c) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewTarget(c)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
            title="View"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={() => setEditTarget(c)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDeleteTarget(c)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('staff.conductors.title')}</h1>
          <p className="page-subtitle">{t('staff.conductors.subtitle')}</p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
          {t('staff.conductors.addConductor')}
        </Button>
      </div>

      <Input
        placeholder={t('staff.conductors.employeeId') + ', ' + t('staff.conductors.title') + '…'}
        leftAddon={<Search className="h-4 w-4" />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="card p-0">
        <Table columns={columns} data={data ?? []} keyExtractor={(c) => c.id} loading={isLoading} />
        <Pagination
          page={pagination.page} totalPages={pagination.totalPages}
          totalCount={totalCount} pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
        />
      </div>

      {/* ── View Collector Modal ──────────────────────────────────────────── */}
      <Modal
        open={!!viewTarget}
        onClose={() => setViewTarget(null)}
        title={`${t('staff.conductors.title')} — ${viewTarget?.employee_id ?? ''}`}
        size="lg"
      >
        {viewTarget && (
          <div className="space-y-6 p-6">
            <Section icon={User} title={t('staff.conductors.personalInfo')} />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <DetailRow label="Full Name (EN)" value={viewTarget.full_name_en} />
              <DetailRow label="Full Name (NE)" value={viewTarget.full_name_ne} />
              <DetailRow label={t('staff.conductors.gender')} value={viewTarget.gender} />
              <DetailRow label="Date of Birth" value={viewTarget.dob} />
              <DetailRow label="Citizenship No." value={viewTarget.citizenship_no} />
              <DetailRow label="Phone" value={viewTarget.phone} />
              <div className="col-span-2 sm:col-span-3">
                <DetailRow label="Address" value={viewTarget.address} />
              </div>
              <DetailRow label="Emergency Contact" value={viewTarget.emergency_contact_name} />
              <DetailRow label="Emergency Phone" value={viewTarget.emergency_contact_number} />
            </div>

            <Section icon={Briefcase} title={t('staff.conductors.employmentInfo')} />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <DetailRow label={t('staff.conductors.employeeId')} value={viewTarget.employee_id} />
              <DetailRow label={t('staff.conductors.employmentType')} value={viewTarget.employment_type?.replace('_', ' ')} />
              <DetailRow label="Date of Joining" value={viewTarget.date_of_joining} />
              <DetailRow label={t('staff.conductors.shift')} value={viewTarget.shift} />
              <DetailRow label={t('common.status')} value={viewTarget.status} />
            </div>

            <Section icon={Bus} title={t('staff.conductors.busAssignment')} />
            <div className="grid grid-cols-2 gap-4">
              <DetailRow
                label={t('staff.conductors.assignedBus')}
                value={viewTarget.assigned_vehicle_id
                  ? (vehicleMap.get(viewTarget.assigned_vehicle_id) ?? viewTarget.assigned_vehicle_id)
                  : '—'}
              />
              <DetailRow
                label="Assigned Route"
                value={viewTarget.assigned_route_id
                  ? (routeMap.get(viewTarget.assigned_route_id) ?? viewTarget.assigned_route_id)
                  : '—'}
              />
            </div>

            <Section icon={Heart} title={t('staff.conductors.medicalInfo')} />
            <div className="grid grid-cols-2 gap-4">
              <DetailRow label={t('staff.conductors.bloodGroup')} value={viewTarget.blood_group} />
            </div>

            <Section icon={Wallet} title={t('staff.conductors.salaryWages')} />
            <div className="grid grid-cols-2 gap-4">
              <DetailRow label="Basic Salary (NPR)" value={viewTarget.basic_salary} />
            </div>

            <div className="flex justify-end border-t pt-4">
              <Button variant="secondary" onClick={() => setViewTarget(null)}>{t('common.close')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Edit Collector Modal ──────────────────────────────────────────── */}
      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={`${t('common.edit')} ${t('staff.conductors.title')} — ${editTarget?.employee_id ?? ''}`}
        size="md"
      >
        {editTarget && (
          <div className="space-y-4 p-6">
            <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              <strong>{editTarget.full_name_en}</strong> · {editTarget.employee_id}
            </p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="ON_LEAVE">On Leave</option>
                  <option value="SUSPENDED">Suspended</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Employment Type</label>
                <select
                  value={editEmploymentType}
                  onChange={(e) => setEditEmploymentType(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="PERMANENT">Permanent</option>
                  <option value="CONTRACT">Contract</option>
                  <option value="PART_TIME">Part Time</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Shift</label>
                <select
                  value={editShift}
                  onChange={(e) => setEditShift(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="">— Not assigned —</option>
                  <option value="MORNING">Morning (5am–12pm)</option>
                  <option value="DAY">Day (12pm–6pm)</option>
                  <option value="EVENING">Evening (6pm–10pm)</option>
                  <option value="NIGHT">Night (10pm–5am)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Blood Group</label>
                <select
                  value={editBloodGroup}
                  onChange={(e) => setEditBloodGroup(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="">— Unknown —</option>
                  {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((bg) => (
                    <option key={bg} value={bg}>{bg}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Phone Number</label>
                <input
                  type="text"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Assign to Bus</label>
                <select
                  value={editVehicleId}
                  onChange={(e) => setEditVehicleId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="">— Not assigned —</option>
                  {(vehicles as { id: string; registration_no?: string }[]).map((v) => (
                    <option key={v.id} value={v.id}>{v.registration_no ?? v.id}</option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700">Assign to Route</label>
                <select
                  value={editRouteId}
                  onChange={(e) => setEditRouteId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="">— Not assigned —</option>
                  {(routes as { id: string; route_code?: string; name_en?: string }[]).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.route_code ? `${r.route_code} — ` : ''}{r.name_en ?? r.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t pt-4">
              <Button variant="secondary" onClick={() => setEditTarget(null)}>{t('common.cancel')}</Button>
              <Button onClick={handleUpdate} loading={updateMutation.isPending}>
                {t('common.update')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Delete Collector Modal ────────────────────────────────────────── */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={`${t('common.delete')} ${t('staff.conductors.title')}`}
        size="sm"
      >
        {deleteTarget && (
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3 rounded-lg bg-red-50 p-4">
              <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-700">This action cannot be undone.</p>
                <p className="text-sm text-red-600 mt-1">
                  You are about to permanently remove{' '}
                  <strong>{deleteTarget.full_name_en}</strong>{' '}
                  ({deleteTarget.employee_id}) from the system.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
              <Button
                variant="danger"
                loading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                leftIcon={<Trash2 className="h-4 w-4" />}
              >
                {t('common.delete')} {t('staff.conductors.title')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Add Collector Modal ───────────────────────────────────────────── */}
      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); reset() }}
        title={t('staff.conductors.addConductor')}
        size="lg"
      >
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-6 p-6">

          {/* Personal Information */}
          <Section icon={User} title={t('staff.conductors.personalInfo')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label="Full Name (English)"
                required
                placeholder="e.g. Hari Prasad Adhikari"
                error={errors.full_name_en?.message}
                {...register('full_name_en', { required: 'Full name is required' })}
              />
            </div>
            <NepaliInput
              label="Full Name (Nepali)"
              placeholder="हरि प्रसाद अधिकारी"
              {...register('full_name_ne')}
            />
            <Controller
              name="gender"
              control={control}
              rules={{ required: 'Gender is required' }}
              render={({ field }) => (
                <SelectField label="Gender" required error={errors.gender?.message} {...field}>
                  <option value="">Select gender</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </SelectField>
              )}
            />
            <Input
              label="Date of Birth"
              type="date"
              required
              error={errors.dob?.message}
              {...register('dob', { required: 'Date of birth is required' })}
            />
            <Input
              label="Citizenship Number"
              required
              placeholder="e.g. 12-34-56-78901"
              error={errors.citizenship_no?.message}
              {...register('citizenship_no', { required: 'Citizenship number is required' })}
            />
            <div className="sm:col-span-2">
              <Input
                label="Address"
                required
                placeholder="e.g. Kalanki, Kathmandu"
                error={errors.address?.message}
                {...register('address', { required: 'Address is required' })}
              />
            </div>
            <Input
              label="Phone Number"
              required
              placeholder="+977-98XXXXXXXX"
              error={errors.phone?.message}
              {...register('phone', { required: 'Phone number is required' })}
            />
            <div />
            <Input
              label="Emergency Contact Name"
              placeholder="e.g. Sita Adhikari"
              {...register('emergency_contact_name')}
            />
            <Input
              label="Emergency Contact Number"
              placeholder="+977-98XXXXXXXX"
              {...register('emergency_contact_number')}
            />
          </div>

          {/* Employment Information */}
          <Section icon={Briefcase} title={t('staff.conductors.employmentInfo')} />
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2">
            <p className="text-xs text-blue-600">
              <strong>Employee ID</strong> is auto-generated (CDR-0001, CDR-0002 …)
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Date of Joining" type="date" {...register('date_of_joining')} />
            <SelectField label="Employment Type" {...register('employment_type')}>
              <option value="PERMANENT">Permanent</option>
              <option value="CONTRACT">Contract</option>
              <option value="PART_TIME">Part Time</option>
            </SelectField>
            <SelectField label="Shift" {...register('shift')}>
              <option value="">— Not assigned —</option>
              <option value="MORNING">Morning (5am–12pm)</option>
              <option value="DAY">Day (12pm–6pm)</option>
              <option value="EVENING">Evening (6pm–10pm)</option>
              <option value="NIGHT">Night (10pm–5am)</option>
            </SelectField>
            <SelectField label="Route Assigned" {...register('assigned_route_id')}>
              <option value="">— Not assigned —</option>
              {(routes as { id: string; route_code?: string; name_en?: string }[]).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.route_code ? `${r.route_code} — ` : ''}{r.name_en ?? r.id}
                </option>
              ))}
            </SelectField>
          </div>

          {/* Bus Assignment */}
          <Section icon={Bus} title={t('staff.conductors.busAssignment')} />
          <SelectField label="Assign to Bus" {...register('assigned_vehicle_id')}>
            <option value="">— Not assigned —</option>
            {(vehicles as { id: string; registration_no?: string; make?: string; model?: string; vehicle_type?: string }[]).map((v) => (
              <option key={v.id} value={v.id}>
                {v.registration_no ?? v.id}
                {v.make ? ` — ${v.make} ${v.model ?? ''}` : ''}
                {v.vehicle_type ? ` (${v.vehicle_type})` : ''}
              </option>
            ))}
          </SelectField>

          {/* Medical Information */}
          <Section icon={Heart} title={t('staff.conductors.medicalInfo')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField label="Blood Group" {...register('blood_group')}>
              <option value="">— Unknown —</option>
              {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((bg) => (
                <option key={bg} value={bg}>{bg}</option>
              ))}
            </SelectField>
          </div>

          {/* Salary & Wages */}
          <Section icon={Wallet} title={t('staff.conductors.salaryWages')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label="Basic Salary (NPR)"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 20000"
                {...register('basic_salary')}
              />
            </div>
          </div>

          {/* Allowances */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">{t('staff.conductors.allowances')}</label>
              <button
                type="button"
                onClick={() => setAllowances([...allowances, { title: '', amount: '' }])}
                className="flex items-center gap-1 rounded-lg border border-dashed border-primary-400
                           px-3 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 transition-colors"
              >
                <Plus className="h-3 w-3" /> Add Allowance
              </button>
            </div>
            {allowances.length === 0 && (
              <p className="text-xs text-gray-400 italic">No allowances added yet.</p>
            )}
            {allowances.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Title (e.g. Transport)"
                  value={item.title}
                  onChange={(e) => {
                    const updated = [...allowances]
                    updated[idx] = { ...updated[idx], title: e.target.value }
                    setAllowances(updated)
                  }}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm
                             focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
                <input
                  type="number"
                  placeholder="Amount (NPR)"
                  min="0"
                  value={item.amount}
                  onChange={(e) => {
                    const updated = [...allowances]
                    updated[idx] = { ...updated[idx], amount: e.target.value }
                    setAllowances(updated)
                  }}
                  className="w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm
                             focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
                <button
                  type="button"
                  onClick={() => setAllowances(allowances.filter((_, i) => i !== idx))}
                  className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" type="button" onClick={() => { setShowCreate(false); reset(); setAllowances([]) }}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={createMutation.isPending} leftIcon={<Plus className="h-4 w-4" />}>
              {t('staff.conductors.addConductor')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
