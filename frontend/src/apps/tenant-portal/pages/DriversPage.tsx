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
  full_name_en: string
  full_name_ne: string
  gender: string
  dob: string
  citizenship_no: string
  phone: string
  address: string
  emergency_contact_name: string
  emergency_contact_number: string
  license_no: string
  license_category: string
  license_issue_date: string
  license_expiry: string
  license_issuing_authority: string
  employment_type: string
  date_of_joining: string
  experience_years: string
  previous_employer: string
  route_id: string
  shift: string
  bus_id: string
  blood_group: string
  medical_conditions: string
  last_medical_checkup_date: string
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
function DetailRow({ label, value, dateValue }: { label: string; value?: string | number | null; dateValue?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</span>
      {dateValue
        ? <DateDisplay date={dateValue} className="text-sm text-gray-900" />
        : <span className="text-sm text-gray-900">{value ?? '—'}</span>
      }
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

  const [viewTarget, setViewTarget] = useState<Driver | null>(null)
  const [editTarget, setEditTarget] = useState<Driver | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Driver | null>(null)

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
      toast.success(t('staff.drivers.toast.created'))
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
        toast.error(res?.message || (err as Error).message || t('staff.drivers.toast.createFailed'))
      }
    },
  })

  // ── Update ────────────────────────────────────────────────────────────────────
  const updateDriverMutation = useMutation({
    mutationFn: (payload: Partial<Driver>) =>
      apiClient.patch(`/operator/drivers/${editTarget!.id}/`, payload),
    onSuccess: () => {
      toast.success(t('staff.drivers.toast.updated'))
      setEditTarget(null)
      qc.invalidateQueries({ queryKey: ['drivers'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || t('staff.drivers.toast.updateFailed'))
    },
  })

  // ── Delete ────────────────────────────────────────────────────────────────────
  const deleteDriverMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/operator/drivers/${id}/`),
    onSuccess: () => {
      toast.success(t('staff.drivers.toast.deleted'))
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['drivers'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || t('staff.drivers.toast.deleteFailed'))
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
      header: t('staff.drivers.table.employeeId'),
      render: (d) => (
        <code className="rounded bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
          {d.employee_id}
        </code>
      ),
    },
    {
      key: 'full_name_en',
      header: t('staff.drivers.table.driver'),
      render: (d) => (
        <div>
          <p className="font-medium text-gray-900">{d.full_name_en}</p>
          <p className="text-xs text-gray-400">{d.phone}</p>
        </div>
      ),
    },
    { key: 'gender', header: t('staff.drivers.table.gender'), render: (d) => d.gender || '—' },
    {
      key: 'license_no',
      header: t('staff.drivers.table.licenseNo'),
      render: (d) => (
        <code className="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700">{d.license_no}</code>
      ),
    },
    { key: 'license_category', header: t('staff.drivers.table.class') },
    {
      key: 'license_expiry',
      header: t('staff.drivers.table.licenseExpiry'),
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
      header: t('staff.drivers.table.experience'),
      render: (d) => t('staff.drivers.yrs', { count: d.experience_years ?? 0 }),
    },
    { key: 'shift', header: t('staff.drivers.table.shift'), render: (d) => d.shift || '—' },
    { key: 'blood_group', header: t('staff.drivers.table.blood'), render: (d) => d.blood_group || '—' },
    {
      key: 'status',
      header: t('staff.drivers.table.status'),
      render: (d) => <Badge variant={statusVariant(d.status)} dot>{d.status}</Badge>,
    },
    {
      key: 'id',
      header: t('staff.drivers.table.actions'),
      render: (d) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewTarget(d)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={() => setEditTarget(d)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDeleteTarget(d)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
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
          <h1 className="page-title">{t('staff.drivers.title')}</h1>
          <p className="page-subtitle">{t('staff.drivers.subtitle')}</p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
          {t('staff.drivers.addDriver')}
        </Button>
      </div>

      <Input
        placeholder={t('staff.drivers.searchPlaceholder')}
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
        title={`${t('staff.drivers.title')} — ${viewTarget?.employee_id ?? ''}`}
        size="lg"
      >
        {viewTarget && (
          <div className="space-y-6 p-6">
            <Section icon={User} title={t('staff.drivers.sections.personal')} />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <DetailRow label={t('staff.drivers.fields.fullNameEn')} value={viewTarget.full_name_en} />
              <DetailRow label={t('staff.drivers.fields.fullNameNe')} value={viewTarget.full_name_ne} />
              <DetailRow label={t('staff.drivers.fields.gender')} value={viewTarget.gender} />
              <DetailRow label={t('staff.drivers.fields.dob')} dateValue={viewTarget.dob} />
              <DetailRow label={t('staff.drivers.fields.citizenshipNo')} value={viewTarget.citizenship_no} />
              <DetailRow label={t('staff.drivers.fields.phone')} value={viewTarget.phone} />
              <div className="col-span-2 sm:col-span-3">
                <DetailRow label={t('staff.drivers.fields.address')} value={viewTarget.address} />
              </div>
              <DetailRow label={t('staff.drivers.fields.emergencyContact')} value={viewTarget.emergency_contact_name} />
              <DetailRow label={t('staff.drivers.fields.emergencyPhone')} value={viewTarget.emergency_contact_number} />
            </div>

            <Section icon={FileText} title={t('staff.drivers.sections.license')} />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <DetailRow label={t('staff.drivers.fields.licenseNo')} value={viewTarget.license_no} />
              <DetailRow label={t('staff.drivers.table.class')} value={viewTarget.license_category} />
              <DetailRow label={t('staff.drivers.fields.issueDate')} dateValue={viewTarget.license_issue_date} />
              <DetailRow label={t('staff.drivers.fields.expiryDate')} dateValue={viewTarget.license_expiry} />
              <div className="col-span-2">
                <DetailRow label={t('staff.drivers.fields.issuingAuthority')} value={viewTarget.license_issuing_authority} />
              </div>
            </div>

            <Section icon={Briefcase} title={t('staff.drivers.sections.employment')} />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <DetailRow label={t('staff.drivers.fields.employeeId')} value={viewTarget.employee_id} />
              <DetailRow label={t('staff.drivers.fields.employmentType')} value={viewTarget.employment_type?.replace('_', ' ')} />
              <DetailRow label={t('staff.drivers.fields.dateOfJoining')} dateValue={viewTarget.date_of_joining} />
              <DetailRow label={t('staff.drivers.experience')} value={viewTarget.experience_years != null ? t('staff.drivers.yrs', { count: viewTarget.experience_years }) : undefined} />
              <DetailRow label={t('staff.drivers.fields.shift')} value={viewTarget.shift} />
              <DetailRow label={t('staff.drivers.fields.previousEmployer')} value={viewTarget.previous_employer} />
            </div>

            <Section icon={Heart} title={t('staff.drivers.sections.medical')} />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <DetailRow label={t('staff.drivers.fields.bloodGroup')} value={viewTarget.blood_group} />
              <DetailRow label={t('staff.drivers.fields.lastCheckup')} dateValue={viewTarget.last_medical_checkup_date} />
              <div className="col-span-2 sm:col-span-3">
                <DetailRow label={t('staff.drivers.fields.medicalConditions')} value={viewTarget.medical_conditions} />
              </div>
            </div>

            <Section icon={Wallet} title={t('staff.drivers.sections.salary')} />
            <div className="grid grid-cols-2 gap-4">
              <DetailRow label={t('staff.drivers.fields.basicSalary')} value={viewTarget.basic_salary} />
              <DetailRow label={t('staff.drivers.status')} value={viewTarget.status} />
            </div>

            <div className="flex justify-end border-t pt-4">
              <Button variant="secondary" onClick={() => setViewTarget(null)}>{t('common:common.close')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Edit Driver Modal ─────────────────────────────────────────────── */}
      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={`${t('staff.drivers.title')} — ${editTarget?.employee_id ?? ''}`}
        size="md"
      >
        {editTarget && (
          <div className="space-y-4 p-6">
            <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              <strong>{editTarget.full_name_en}</strong> · {editTarget.employee_id}
            </p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('staff.drivers.status')}</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="ACTIVE">{t('staff.drivers.statuses.active')}</option>
                  <option value="INACTIVE">{t('staff.drivers.statuses.inactive')}</option>
                  <option value="ON_LEAVE">{t('staff.drivers.statuses.onLeave')}</option>
                  <option value="SUSPENDED">{t('staff.drivers.statuses.suspended')}</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('staff.drivers.fields.employmentType')}</label>
                <select
                  value={editEmploymentType}
                  onChange={(e) => setEditEmploymentType(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="PERMANENT">{t('staff.drivers.employmentTypes.permanent')}</option>
                  <option value="CONTRACT">{t('staff.drivers.employmentTypes.contract')}</option>
                  <option value="PART_TIME">{t('staff.drivers.employmentTypes.partTime')}</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('staff.drivers.fields.shift')}</label>
                <select
                  value={editShift}
                  onChange={(e) => setEditShift(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="">{t('staff.drivers.notAssigned')}</option>
                  <option value="MORNING">{t('staff.drivers.shifts.morning')}</option>
                  <option value="DAY">{t('staff.drivers.shifts.day')}</option>
                  <option value="EVENING">{t('staff.drivers.shifts.evening')}</option>
                  <option value="NIGHT">{t('staff.drivers.shifts.night')}</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('staff.drivers.fields.bloodGroup')}</label>
                <select
                  value={editBloodGroup}
                  onChange={(e) => setEditBloodGroup(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="">{t('staff.drivers.unknown')}</option>
                  {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((bg) => (
                    <option key={bg} value={bg}>{bg}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('staff.drivers.fields.phone')}</label>
                <input
                  type="text"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('staff.drivers.fields.experienceYears')}</label>
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
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('staff.drivers.licenseNumber')}</label>
                <input
                  type="text"
                  value={editLicenseNo}
                  onChange={(e) => setEditLicenseNo(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('staff.drivers.table.class')}</label>
                <select
                  value={editLicenseCat}
                  onChange={(e) => setEditLicenseCat(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="">{t('staff.drivers.selectClass')}</option>
                  <option value="A">{t('staff.drivers.licenseClasses.a')}</option>
                  <option value="B">{t('staff.drivers.licenseClasses.b')}</option>
                  <option value="C">{t('staff.drivers.licenseClasses.c')}</option>
                  <option value="D">{t('staff.drivers.licenseClasses.d')}</option>
                  <option value="E">{t('staff.drivers.licenseClasses.e')}</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <NepaliDateInput
                  label={t('staff.drivers.fields.licenseExpiryDate')}
                  value={editLicenseExpiry}
                  onChange={setEditLicenseExpiry}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t pt-4">
              <Button variant="secondary" onClick={() => setEditTarget(null)}>{t('common:common.cancel')}</Button>
              <Button onClick={handleUpdate} loading={updateDriverMutation.isPending}>
                {t('staff.drivers.saveChanges')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Delete Driver Modal ───────────────────────────────────────────── */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={t('staff.drivers.removeDriver')}
        size="sm"
      >
        {deleteTarget && (
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3 rounded-lg bg-red-50 p-4">
              <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-700">{t('staff.drivers.deleteWarning')}</p>
                <p className="text-sm text-red-600 mt-1">
                  {t('staff.drivers.deleteConfirm', {
                    name: deleteTarget.full_name_en,
                    id: deleteTarget.employee_id,
                  })}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t('common:common.cancel')}</Button>
              <Button
                variant="danger"
                loading={deleteDriverMutation.isPending}
                onClick={() => deleteDriverMutation.mutate(deleteTarget.id)}
                leftIcon={<Trash2 className="h-4 w-4" />}
              >
                {t('staff.drivers.deleteDriver')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Add Driver Modal ──────────────────────────────────────────────── */}
      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); reset() }}
        title={t('staff.drivers.addDriver')}
        size="lg"
      >
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-6 p-6">

          {/* Personal Information */}
          <Section icon={User} title={t('staff.drivers.sections.personal')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label={t('staff.drivers.fields.fullNameEn')}
                required
                placeholder="e.g. Ram Bahadur Shrestha"
                error={errors.full_name_en?.message}
                {...register('full_name_en', { required: t('staff.drivers.validation.fullNameRequired') })}
              />
            </div>
            <NepaliInput
              label={t('staff.drivers.fields.fullNameNe')}
              placeholder="राम बहादुर श्रेष्ठ"
              {...register('full_name_ne')}
            />
            <Controller
              name="gender"
              control={control}
              rules={{ required: t('staff.drivers.validation.genderRequired') }}
              render={({ field }) => (
                <SelectField label={t('staff.drivers.fields.gender')} required error={errors.gender?.message} {...field}>
                  <option value="MALE">{t('staff.drivers.genders.male')}</option>
                  <option value="FEMALE">{t('staff.drivers.genders.female')}</option>
                  <option value="OTHER">{t('staff.drivers.genders.other')}</option>
                </SelectField>
              )}
            />
            <Controller
              name="dob"
              control={control}
              rules={{ required: t('staff.drivers.validation.dobRequired') }}
              render={({ field }) => (
                <NepaliDateInput
                  label={t('staff.drivers.fields.dob')}
                  required
                  error={errors.dob?.message}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <Input
              label={t('staff.drivers.fields.citizenshipNo')}
              placeholder="e.g. 12-34-56-78901"
              required
              error={errors.citizenship_no?.message}
              {...register('citizenship_no', { required: t('staff.drivers.validation.citizenshipRequired') })}
            />
            <div className="sm:col-span-2">
              <Input
                label={t('staff.drivers.fields.address')}
                placeholder="e.g. Kalanki, Kathmandu"
                required
                error={errors.address?.message}
                {...register('address', { required: t('staff.drivers.validation.addressRequired') })}
              />
            </div>
            <Input
              label={t('staff.drivers.fields.phone')}
              placeholder="+977-98XXXXXXXX"
              required
              error={errors.phone?.message}
              {...register('phone', { required: t('staff.drivers.validation.phoneRequired') })}
            />
            <div />
            <Input
              label={t('staff.drivers.fields.emergencyContact')}
              placeholder="e.g. Sita Shrestha"
              {...register('emergency_contact_name')}
            />
            <Input
              label={t('staff.drivers.fields.emergencyPhone')}
              placeholder="+977-98XXXXXXXX"
              {...register('emergency_contact_number')}
            />
          </div>

          {/* Driver License Information */}
          <Section icon={FileText} title={t('staff.drivers.sections.licenseInfo')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t('staff.drivers.licenseNumber')}
              required
              placeholder="e.g. 07-01-123456"
              error={errors.license_no?.message}
              {...register('license_no', { required: t('staff.drivers.validation.licenseRequired') })}
            />
            <Controller
              name="license_category"
              control={control}
              rules={{ required: t('staff.drivers.validation.licenseClassRequired') }}
              render={({ field }) => (
                <SelectField label={t('staff.drivers.fields.licenseClass')} required error={errors.license_category?.message} {...field}>
                  <option value="">{t('staff.drivers.selectClass')}</option>
                  <option value="A">{t('staff.drivers.licenseClasses.a')}</option>
                  <option value="B">{t('staff.drivers.licenseClasses.b')}</option>
                  <option value="C">{t('staff.drivers.licenseClasses.c')}</option>
                  <option value="D">{t('staff.drivers.licenseClasses.d')}</option>
                  <option value="E">{t('staff.drivers.licenseClasses.e')}</option>
                </SelectField>
              )}
            />
            <Controller
              name="license_issue_date"
              control={control}
              render={({ field }) => (
                <NepaliDateInput label={t('staff.drivers.fields.issueDate')} value={field.value} onChange={field.onChange} />
              )}
            />
            <Controller
              name="license_expiry"
              control={control}
              rules={{ required: t('staff.drivers.validation.licenseExpiryRequired') }}
              render={({ field }) => (
                <NepaliDateInput
                  label={t('staff.drivers.fields.expiryDate')}
                  required
                  error={errors.license_expiry?.message}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <div className="sm:col-span-2">
              <Input
                label={t('staff.drivers.fields.issuingAuthority')}
                placeholder="e.g. Department of Transport Management, Bagmati Province"
                {...register('license_issuing_authority')}
              />
            </div>
          </div>

          {/* Employment Information */}
          <Section icon={Briefcase} title={t('staff.drivers.sections.employment')} />
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2">
            <p className="text-xs text-blue-600">
              <strong>{t('staff.drivers.fields.employeeId')}</strong> — {t('staff.drivers.employeeIdAuto')}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Controller
              name="date_of_joining"
              control={control}
              render={({ field }) => (
                <NepaliDateInput label={t('staff.drivers.fields.dateOfJoining')} value={field.value} onChange={field.onChange} />
              )}
            />
            <Input
              label={t('staff.drivers.fields.experienceYears')}
              type="number"
              min="0"
              max="50"
              placeholder="e.g. 5"
              {...register('experience_years')}
            />
            <SelectField label={t('staff.drivers.fields.employmentType')} {...register('employment_type')}>
              <option value="PERMANENT">{t('staff.drivers.employmentTypes.permanent')}</option>
              <option value="CONTRACT">{t('staff.drivers.employmentTypes.contract')}</option>
              <option value="PART_TIME">{t('staff.drivers.employmentTypes.partTime')}</option>
            </SelectField>
            <Input
              label={t('staff.drivers.fields.previousEmployer')}
              placeholder="e.g. Sajha Yatayat"
              {...register('previous_employer')}
            />
            <SelectField label={t('staff.drivers.fields.shift')} {...register('shift')}>
              <option value="">{t('staff.drivers.notAssigned')}</option>
              <option value="MORNING">{t('staff.drivers.shifts.morning')}</option>
              <option value="DAY">{t('staff.drivers.shifts.day')}</option>
              <option value="EVENING">{t('staff.drivers.shifts.evening')}</option>
              <option value="NIGHT">{t('staff.drivers.shifts.night')}</option>
            </SelectField>
          </div>

          {/* Vehicle Information */}
          <Section icon={Bus} title={t('staff.drivers.sections.vehicle')} />
          <SelectField label={t('staff.drivers.fields.busVehicle')} {...register('bus_id')}>
            <option value="">{t('staff.drivers.notAssigned')}</option>
            {(vehicles as { id: string; registration_no?: string; make?: string; model?: string }[]).map((v) => (
              <option key={v.id} value={v.id}>
                {v.registration_no ?? v.id}
                {v.make ? ` — ${v.make} ${v.model ?? ''}` : ''}
              </option>
            ))}
          </SelectField>

          {/* Medical Information */}
          <Section icon={Heart} title={t('staff.drivers.sections.medical')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField label={t('staff.drivers.fields.bloodGroup')} {...register('blood_group')}>
              <option value="">{t('staff.drivers.unknown')}</option>
              {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((bg) => (
                <option key={bg} value={bg}>{bg}</option>
              ))}
            </SelectField>
            <Controller
              name="last_medical_checkup_date"
              control={control}
              render={({ field }) => (
                <NepaliDateInput label={t('staff.drivers.fields.lastCheckup')} value={field.value} onChange={field.onChange} />
              )}
            />
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t('staff.drivers.fields.medicalConditions')}
              </label>
              <textarea
                rows={3}
                placeholder={t('staff.drivers.medicalConditionsPlaceholder')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                {...register('medical_conditions')}
              />
            </div>
          </div>

          {/* Salary & Wages */}
          <Section icon={Wallet} title={t('staff.drivers.sections.salaryWages')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label={t('staff.drivers.fields.basicSalary')}
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
              <label className="text-sm font-medium text-gray-700">{t('staff.drivers.allowances')}</label>
              <button
                type="button"
                onClick={() => setAllowances([...allowances, { title: '', amount: '' }])}
                className="flex items-center gap-1 rounded-lg border border-dashed border-primary-400
                           px-3 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 transition-colors"
              >
                <Plus className="h-3 w-3" /> {t('staff.drivers.addAllowance')}
              </button>
            </div>
            {allowances.length === 0 && (
              <p className="text-xs text-gray-400 italic">{t('staff.drivers.noAllowances')}</p>
            )}
            {allowances.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={t('staff.drivers.allowanceTitlePlaceholder')}
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
                  placeholder={t('staff.drivers.allowanceAmountPlaceholder')}
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
            <Button
              variant="secondary"
              type="button"
              onClick={() => { setShowCreate(false); reset(); setAllowances([]) }}
            >
              {t('common:common.cancel')}
            </Button>
            <Button type="submit" loading={createMutation.isPending} leftIcon={<Plus className="h-4 w-4" />}>
              {t('staff.drivers.addDriver')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
