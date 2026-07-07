import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, AlertTriangle, User, FileText, Briefcase, Bus, Heart, Wallet, Trash2, Eye, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { NepaliInput } from '@components/shared/NepaliInput'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge, statusVariant } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { DateDisplay } from '@components/shared/DateDisplay'
import { NepaliDateInput } from '@components/shared/NepaliDateInput'
import { usePagination } from '@hooks/usePagination'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { useForm, Controller } from 'react-hook-form'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Driver {
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
  license_no: string
  license_category: string
  license_issue_date: string
  license_expiry: string
  license_issuing_authority: string
  experience_years: number
  employment_type: string
  date_of_joining: string
  previous_employer: string
  shift: string
  blood_group: string
  medical_conditions: string
  last_medical_checkup_date: string
  basic_salary: string
  status: string
}

interface DriverForm {
  // Personal
  full_name_en: string
  full_name_ne: string
  gender: string
  dob: string
  citizenship_no: string
  phone: string
  address: string
  emergency_contact_name: string
  emergency_contact_number: string
  // License
  license_no: string
  license_category: string
  license_issue_date: string
  license_expiry: string
  license_issuing_authority: string
  // Employment
  employment_type: string
  date_of_joining: string
  experience_years: string
  previous_employer: string
  route_id: string
  shift: string
  bus_id: string
  // Medical
  blood_group: string
  medical_conditions: string
  last_medical_checkup_date: string
  // Salary
  basic_salary: string
}

// ─── Section heading ──────────────────────────────────────────────────────────
function Section({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-gray-200 pb-2 pt-2">
      <Icon className="h-4 w-4 text-primary-600" />
      <h3 className="text-sm font-semibold uppercase tracking-wide text-primary-700">{title}</h3>
    </div>
  )
}

// ─── Select helper ────────────────────────────────────────────────────────────
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

// ─── Detail row helper ────────────────────────────────────────────────────────
function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</span>
      <span className="text-sm text-gray-900">{value ?? '—'}</span>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DriversPage() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [allowances, setAllowances] = useState<{ title: string; amount: string }[]>([])
  const pagination = usePagination(totalCount)

  // ── CRUD targets ─────────────────────────────────────────────────────────────
  const [viewTarget, setViewTarget] = useState<Driver | null>(null)
  const [editTarget, setEditTarget] = useState<Driver | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Driver | null>(null)

  // ── Edit form state ───────────────────────────────────────────────────────────
  const [editStatus, setEditStatus] = useState('')
  const [editShift, setEditShift] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editLicenseNo, setEditLicenseNo] = useState('')
  const [editLicenseCat, setEditLicenseCat] = useState('')
  const [editLicenseExpiry, setEditLicenseExpiry] = useState('')
  const [editExperience, setEditExperience] = useState('')
  const [editBloodGroup, setEditBloodGroup] = useState('')
  const [editEmploymentType, setEditEmploymentType] = useState('')

  useEffect(() => {
    if (!editTarget) return
    setEditStatus(editTarget.status ?? '')
    setEditShift(editTarget.shift ?? '')
    setEditPhone(editTarget.phone ?? '')
    setEditLicenseNo(editTarget.license_no ?? '')
    setEditLicenseCat(editTarget.license_category ?? '')
    setEditLicenseExpiry(editTarget.license_expiry ?? '')
    setEditExperience(String(editTarget.experience_years ?? ''))
    setEditBloodGroup(editTarget.blood_group ?? '')
    setEditEmploymentType(editTarget.employment_type ?? '')
  }, [editTarget])

  // Driver list
  const { data, isLoading } = useQuery({
    queryKey: ['drivers', pagination.page, search],
    queryFn: async () => {
      const { data } = await apiClient.get('/operator/drivers/', {
        params: { ...pagination.queryParams, ...(search && { search }) },
      })
      setTotalCount(data.meta?.total_count ?? data.data?.count ?? 0)
      return data.data?.results ?? data.data ?? []
    },
  })

  // Vehicles dropdown
  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles-dropdown'],
    queryFn: async () => {
      const { data } = await apiClient.get('/fleet/vehicles/?page_size=200')
      return data.data?.results ?? data.data ?? []
    },
    staleTime: 5 * 60 * 1000,
  })

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<DriverForm>({
    defaultValues: {
      gender: 'MALE',
      license_category: '',
      employment_type: 'PERMANENT',
      shift: '',
    },
  })

  // ── Create ────────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (payload: DriverForm) =>
      apiClient.post('/operator/drivers/', {
        ...payload,
        basic_salary: payload.basic_salary || null,
        allowances: allowances
          .filter((a) => a.title.trim())
          .map((a) => ({ title: a.title.trim(), amount: parseFloat(a.amount) || 0 })),
      }),
    onSuccess: () => {
      toast.success('Driver added successfully!')
      setShowCreate(false)
      reset()
      setAllowances([])
      qc.invalidateQueries({ queryKey: ['drivers'] })
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
        toast.error(res?.message || (err as Error).message || 'Failed to add driver')
      }
    },
  })

  // ── Update ────────────────────────────────────────────────────────────────────
  const updateDriverMutation = useMutation({
    mutationFn: (payload: Partial<Driver>) =>
      apiClient.patch(`/operator/drivers/${editTarget!.id}/`, payload),
    onSuccess: () => {
      toast.success('Driver updated successfully!')
      setEditTarget(null)
      qc.invalidateQueries({ queryKey: ['drivers'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to update driver')
    },
  })

  // ── Delete ────────────────────────────────────────────────────────────────────
  const deleteDriverMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/operator/drivers/${id}/`),
    onSuccess: () => {
      toast.success('Driver removed successfully.')
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['drivers'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to delete driver')
    },
  })

  const handleUpdate = () => {
    updateDriverMutation.mutate({
      status: editStatus,
      shift: editShift || undefined,
      phone: editPhone,
      license_no: editLicenseNo,
      license_category: editLicenseCat,
      license_expiry: editLicenseExpiry,
      experience_years: editExperience ? Number(editExperience) : undefined,
      blood_group: editBloodGroup || undefined,
      employment_type: editEmploymentType,
    })
  }

  // ── Table columns ─────────────────────────────────────────────────────────────
  const columns: Column<Driver>[] = [
    {
      key: 'employee_id',
      header: 'Employee ID',
      render: (d) => (
        <code className="rounded bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
          {d.employee_id}
        </code>
      ),
    },
    {
      key: 'full_name_en',
      header: 'Driver',
      render: (d) => (
        <div>
          <p className="font-medium text-gray-900">{d.full_name_en}</p>
          <p className="text-xs text-gray-400">{d.phone}</p>
        </div>
      ),
    },
    { key: 'gender', header: 'Gender', render: (d) => d.gender || '—' },
    {
      key: 'license_no',
      header: 'License No.',
      render: (d) => (
        <code className="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700">{d.license_no}</code>
      ),
    },
    { key: 'license_category', header: 'Class' },
    {
      key: 'license_expiry',
      header: 'License Expiry',
      render: (d) => {
        const daysLeft = Math.floor((new Date(d.license_expiry).getTime() - Date.now()) / 86400000)
        return (
          <div className="flex items-center gap-1.5">
            <DateDisplay date={d.license_expiry} />
            {daysLeft < 30 && <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />}
          </div>
        )
      },
    },
    {
      key: 'experience_years',
      header: 'Experience',
      render: (d) => `${d.experience_years ?? 0} yrs`,
    },
    { key: 'shift', header: 'Shift', render: (d) => d.shift || '—' },
    { key: 'blood_group', header: 'Blood', render: (d) => d.blood_group || '—' },
    {
      key: 'status',
      header: 'Status',
      render: (d) => <Badge variant={statusVariant(d.status)} dot>{d.status}</Badge>,
    },
    {
      key: 'id',
      header: 'Actions',
      render: (d) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewTarget(d)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
            title="View"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={() => setEditTarget(d)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDeleteTarget(d)}
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
          <h1 className="page-title">Drivers</h1>
          <p className="page-subtitle">Manage all registered bus drivers</p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
          Add Driver
        </Button>
      </div>

      <Input
        placeholder="Search by name, license number…"
        leftAddon={<Search className="h-4 w-4" />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="card p-0">
        <Table columns={columns} data={data ?? []} keyExtractor={(d) => d.id} loading={isLoading} />
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalCount={totalCount}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
        />
      </div>

      {/* ── View Driver Modal ─────────────────────────────────────────────── */}
      <Modal
        open={!!viewTarget}
        onClose={() => setViewTarget(null)}
        title={`Driver — ${viewTarget?.employee_id ?? ''}`}
        size="lg"
      >
        {viewTarget && (
          <div className="space-y-6 p-6">
            <Section icon={User} title="Personal Information" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <DetailRow label="Full Name (EN)" value={viewTarget.full_name_en} />
              <DetailRow label="Full Name (NE)" value={viewTarget.full_name_ne} />
              <DetailRow label="Gender" value={viewTarget.gender} />
              <DetailRow label="Date of Birth" value={viewTarget.dob} />
              <DetailRow label="Citizenship No." value={viewTarget.citizenship_no} />
              <DetailRow label="Phone" value={viewTarget.phone} />
              <div className="col-span-2 sm:col-span-3">
                <DetailRow label="Address" value={viewTarget.address} />
              </div>
              <DetailRow label="Emergency Contact" value={viewTarget.emergency_contact_name} />
              <DetailRow label="Emergency Phone" value={viewTarget.emergency_contact_number} />
            </div>

            <Section icon={FileText} title="License Information" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <DetailRow label="License No." value={viewTarget.license_no} />
              <DetailRow label="Class" value={viewTarget.license_category} />
              <DetailRow label="Issue Date" value={viewTarget.license_issue_date} />
              <DetailRow label="Expiry Date" value={viewTarget.license_expiry} />
              <div className="col-span-2">
                <DetailRow label="Issuing Authority" value={viewTarget.license_issuing_authority} />
              </div>
            </div>

            <Section icon={Briefcase} title="Employment Information" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <DetailRow label="Employee ID" value={viewTarget.employee_id} />
              <DetailRow label="Employment Type" value={viewTarget.employment_type?.replace('_', ' ')} />
              <DetailRow label="Date of Joining" value={viewTarget.date_of_joining} />
              <DetailRow label="Experience" value={viewTarget.experience_years != null ? `${viewTarget.experience_years} yrs` : undefined} />
              <DetailRow label="Shift" value={viewTarget.shift} />
              <DetailRow label="Previous Employer" value={viewTarget.previous_employer} />
            </div>

            <Section icon={Heart} title="Medical Information" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <DetailRow label="Blood Group" value={viewTarget.blood_group} />
              <DetailRow label="Last Check-up" value={viewTarget.last_medical_checkup_date} />
              <div className="col-span-2 sm:col-span-3">
                <DetailRow label="Medical Conditions" value={viewTarget.medical_conditions} />
              </div>
            </div>

            <Section icon={Wallet} title="Salary" />
            <div className="grid grid-cols-2 gap-4">
              <DetailRow label="Basic Salary (NPR)" value={viewTarget.basic_salary} />
              <DetailRow label="Status" value={viewTarget.status} />
            </div>

            <div className="flex justify-end border-t pt-4">
              <Button variant="secondary" onClick={() => setViewTarget(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Edit Driver Modal ─────────────────────────────────────────────── */}
      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={`Edit Driver — ${editTarget?.employee_id ?? ''}`}
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
                <label className="mb-1 block text-sm font-medium text-gray-700">Years of Experience</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={editExperience}
                  onChange={(e) => setEditExperience(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">License Number</label>
                <input
                  type="text"
                  value={editLicenseNo}
                  onChange={(e) => setEditLicenseNo(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">License Class</label>
                <select
                  value={editLicenseCat}
                  onChange={(e) => setEditLicenseCat(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="">Select class</option>
                  <option value="A">Class A — Motorcycle</option>
                  <option value="B">Class B — Light Vehicle</option>
                  <option value="C">Class C — Heavy Vehicle</option>
                  <option value="D">Class D — Public Vehicle</option>
                  <option value="E">Class E — Tractor</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <NepaliDateInput
                  label="License Expiry Date"
                  value={editLicenseExpiry}
                  onChange={setEditLicenseExpiry}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t pt-4">
              <Button variant="secondary" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button onClick={handleUpdate} loading={updateDriverMutation.isPending}>
                Save Changes
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Delete Driver Modal ───────────────────────────────────────────── */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Remove Driver"
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
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button
                variant="danger"
                loading={deleteDriverMutation.isPending}
                onClick={() => deleteDriverMutation.mutate(deleteTarget.id)}
                leftIcon={<Trash2 className="h-4 w-4" />}
              >
                Delete Driver
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Add Driver Modal ──────────────────────────────────────────────── */}
      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); reset() }}
        title="Add Driver"
        size="lg"
      >
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-6 p-6">

          {/* ── Personal Information ─────────────────────────────────────── */}
          <Section icon={User} title="Personal Information" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label="Full Name (English)"
                required
                placeholder="e.g. Ram Bahadur Shrestha"
                error={errors.full_name_en?.message}
                {...register('full_name_en', { required: 'Full name is required' })}
              />
            </div>
            <NepaliInput
              label="Full Name (Nepali)"
              placeholder="राम बहादुर श्रेष्ठ"
              {...register('full_name_ne')}
            />
            <Controller
              name="gender"
              control={control}
              rules={{ required: 'Gender is required' }}
              render={({ field }) => (
                <SelectField label="Gender" required error={errors.gender?.message} {...field}>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </SelectField>
              )}
            />
            <Controller
              name="dob"
              control={control}
              rules={{ required: 'Date of birth is required' }}
              render={({ field }) => (
                <NepaliDateInput
                  label="Date of Birth"
                  required
                  error={errors.dob?.message}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <Input
              label="Citizenship Number"
              placeholder="e.g. 12-34-56-78901"
              required
              error={errors.citizenship_no?.message}
              {...register('citizenship_no', { required: 'Citizenship number is required' })}
            />
            <div className="sm:col-span-2">
              <Input
                label="Address"
                placeholder="e.g. Kalanki, Kathmandu"
                required
                error={errors.address?.message}
                {...register('address', { required: 'Address is required' })}
              />
            </div>
            <Input
              label="Phone Number"
              placeholder="+977-98XXXXXXXX"
              required
              error={errors.phone?.message}
              {...register('phone', { required: 'Phone number is required' })}
            />
            <div />
            <Input
              label="Emergency Contact Name"
              placeholder="e.g. Sita Shrestha"
              {...register('emergency_contact_name')}
            />
            <Input
              label="Emergency Contact Number"
              placeholder="+977-98XXXXXXXX"
              {...register('emergency_contact_number')}
            />
          </div>

          {/* ── Driver License Information ────────────────────────────────── */}
          <Section icon={FileText} title="Driver License Information" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="License Number"
              required
              placeholder="e.g. 07-01-123456"
              error={errors.license_no?.message}
              {...register('license_no', { required: 'License number is required' })}
            />
            <Controller
              name="license_category"
              control={control}
              rules={{ required: 'License class is required' }}
              render={({ field }) => (
                <SelectField label="License Type / Class" required error={errors.license_category?.message} {...field}>
                  <option value="">Select class</option>
                  <option value="A">Class A — Motorcycle</option>
                  <option value="B">Class B — Light Vehicle</option>
                  <option value="C">Class C — Heavy Vehicle</option>
                  <option value="D">Class D — Public Vehicle</option>
                  <option value="E">Class E — Tractor</option>
                </SelectField>
              )}
            />
            <Controller
              name="license_issue_date"
              control={control}
              render={({ field }) => (
                <NepaliDateInput label="Issue Date" value={field.value} onChange={field.onChange} />
              )}
            />
            <Controller
              name="license_expiry"
              control={control}
              rules={{ required: 'License expiry is required' }}
              render={({ field }) => (
                <NepaliDateInput
                  label="Expiry Date"
                  required
                  error={errors.license_expiry?.message}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <div className="sm:col-span-2">
              <Input
                label="Issuing Authority"
                placeholder="e.g. Department of Transport Management, Bagmati Province"
                {...register('license_issuing_authority')}
              />
            </div>
          </div>

          {/* ── Employment Information ────────────────────────────────────── */}
          <Section icon={Briefcase} title="Employment Information" />
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2">
            <p className="text-xs text-blue-600">
              <strong>Employee ID</strong> is generated automatically (DRV-0001, DRV-0002 …)
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Controller
              name="date_of_joining"
              control={control}
              render={({ field }) => (
                <NepaliDateInput label="Date of Joining" value={field.value} onChange={field.onChange} />
              )}
            />
            <Input
              label="Years of Driving Experience"
              type="number"
              min="0"
              max="50"
              placeholder="e.g. 5"
              {...register('experience_years')}
            />
            <SelectField label="Employment Type" {...register('employment_type')}>
              <option value="PERMANENT">Permanent</option>
              <option value="CONTRACT">Contract</option>
              <option value="PART_TIME">Part Time</option>
            </SelectField>
            <Input
              label="Previous Employer"
              placeholder="e.g. Sajha Yatayat"
              {...register('previous_employer')}
            />
            <SelectField label="Shift" {...register('shift')}>
              <option value="">— Not assigned —</option>
              <option value="MORNING">Morning (5am–12pm)</option>
              <option value="DAY">Day (12pm–6pm)</option>
              <option value="EVENING">Evening (6pm–10pm)</option>
              <option value="NIGHT">Night (10pm–5am)</option>
            </SelectField>
          </div>

          {/* ── Vehicle Information ───────────────────────────────────────── */}
          <Section icon={Bus} title="Vehicle Information" />
          <SelectField label="Bus Number / Vehicle" {...register('bus_id')}>
            <option value="">— Not assigned —</option>
            {(vehicles as { id: string; registration_no?: string; make?: string; model?: string }[]).map((v) => (
              <option key={v.id} value={v.id}>
                {v.registration_no ?? v.id}
                {v.make ? ` — ${v.make} ${v.model ?? ''}` : ''}
              </option>
            ))}
          </SelectField>

          {/* ── Medical Information ───────────────────────────────────────── */}
          <Section icon={Heart} title="Medical Information" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField label="Blood Group" {...register('blood_group')}>
              <option value="">— Unknown —</option>
              {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((bg) => (
                <option key={bg} value={bg}>{bg}</option>
              ))}
            </SelectField>
            <Controller
              name="last_medical_checkup_date"
              control={control}
              render={({ field }) => (
                <NepaliDateInput label="Last Medical Check-up Date" value={field.value} onChange={field.onChange} />
              )}
            />
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Medical Conditions (if any)
              </label>
              <textarea
                rows={3}
                placeholder="List any known medical conditions, allergies, or medications…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                {...register('medical_conditions')}
              />
            </div>
          </div>

          {/* ── Salary & Wages ───────────────────────────────────────────── */}
          <Section icon={Wallet} title="Salary & Wages" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label="Basic Salary (NPR)"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 25000"
                {...register('basic_salary')}
              />
            </div>
          </div>

          {/* Allowances */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Allowances</label>
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

          {/* ── Actions ──────────────────────────────────────────────────── */}
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button
              variant="secondary"
              type="button"
              onClick={() => { setShowCreate(false); reset(); setAllowances([]) }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={createMutation.isPending} leftIcon={<Plus className="h-4 w-4" />}>
              Add Driver
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
