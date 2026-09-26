import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, AlertTriangle, User, FileText, Briefcase, Bus, Heart, Wallet, Trash2, Eye, Pencil, KeyRound, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { NepaliInput } from '@components/shared/NepaliInput'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge, statusVariant } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { PhotoUploadField } from '@components/shared/PhotoUploadField'
import { DateDisplay } from '@components/shared/DateDisplay'
import { NepaliDateInput } from '@components/shared/NepaliDateInput'
import { usePagination } from '@hooks/usePagination'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { useForm, Controller } from 'react-hook-form'
import { sanitizePhoneDigits, isValidPhone, PHONE_VALIDATION_MESSAGE } from '@utils/phone'
import { isValidEmail, EMAIL_VALIDATION_MESSAGE } from '@utils/email'
import { isValidPassword, PASSWORD_VALIDATION_MESSAGE } from '@utils/password'
import { cn } from '@utils/cn'

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
  photo: string | null
  license_no: string
  license_category: string
  license_issue_date: string
  license_expiry: string
  license_issuing_authority: string
  license_photo: string | null
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
  user_id: string | null
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

// Pokhara QA report: setError() is only safe on a field with a client-side
// `required`/`rules` prop -- react-hook-form re-validates and clears those
// on the next handleSubmit() call. A manually-set error on a rule-less
// field never clears, which (in the sibling Add Vehicle bug) permanently
// blocked resubmission on the same open modal -- same allowlist pattern
// as FleetPage.tsx's FIELDS_WITH_CLIENT_RULES.
const FIELDS_WITH_CLIENT_RULES = new Set([
  'full_name_en', 'gender', 'dob', 'citizenship_no', 'phone', 'address',
  'license_no', 'license_category', 'license_expiry',
])

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

  // Optional photo uploads -- tracked separately from the react-hook-form
  // fields since they're Files, not text values (same pattern as the
  // company logo upload in TenantSettingsPage). Multipart only kicks in on
  // submit if one of these is actually set.
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [licensePhotoFile, setLicensePhotoFile] = useState<File | null>(null)
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null)
  const [editLicensePhotoFile, setEditLicensePhotoFile] = useState<File | null>(null)

  const [viewTarget, setViewTarget] = useState<Driver | null>(null)
  const [viewStep, setViewStep] = useState(0)
  const VIEW_STEPS: { label: string; icon: React.ElementType }[] = [
    { label: t('staff.drivers.sections.personal'), icon: User },
    { label: t('staff.drivers.sections.license'), icon: FileText },
    { label: t('staff.drivers.sections.employment'), icon: Briefcase },
    { label: t('staff.drivers.sections.medical'), icon: Heart },
    { label: t('staff.drivers.sections.salary'), icon: Wallet },
  ]
  // Same 5 sections as VIEW_STEPS (not the Add wizard's 6 -- there's no
  // Vehicle tab in View and Driver has no assignable-vehicle field to edit
  // here), each naming exactly which DriverForm fields it edits so the
  // submit handler can scope its PATCH payload to just the chosen section.
  const EDIT_SECTIONS: { label: string; icon: React.ElementType; fields: (keyof DriverForm)[] }[] = [
    { label: t('staff.drivers.sections.personal'), icon: User, fields: ['full_name_en', 'full_name_ne', 'gender', 'dob', 'citizenship_no', 'phone', 'address', 'emergency_contact_name', 'emergency_contact_number'] },
    { label: t('staff.drivers.sections.license'), icon: FileText, fields: ['license_no', 'license_category', 'license_issue_date', 'license_expiry', 'license_issuing_authority'] },
    { label: t('staff.drivers.sections.employment'), icon: Briefcase, fields: ['employment_type', 'date_of_joining', 'experience_years', 'shift', 'previous_employer'] },
    { label: t('staff.drivers.sections.medical'), icon: Heart, fields: ['blood_group', 'last_medical_checkup_date', 'medical_conditions'] },
    { label: t('staff.drivers.sections.salary'), icon: Wallet, fields: ['basic_salary'] },
  ]
  // Edit is a two-step flow: pick a section (editPickerTarget), then edit
  // just that section's fields (editTarget + editSection) -- same shape as
  // the View modal's tabs, so whatever gets changed here is exactly what
  // View already shows for that section. editSection indexes EDIT_SECTIONS,
  // defined further down once t() and the field-editing form exist.
  const [editPickerTarget, setEditPickerTarget] = useState<Driver | null>(null)
  const [editTarget, setEditTarget] = useState<Driver | null>(null)
  const [editSection, setEditSection] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<Driver | null>(null)
  const [loginTarget, setLoginTarget] = useState<Driver | null>(null)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // status isn't part of DriverForm (it's an operational field, not
  // something set at creation time) -- kept as its own piece of state,
  // edited alongside basic_salary on the Salary section, matching where
  // the View modal already shows it.
  const [editStatus, setEditStatus] = useState('')

  const openEditPicker = (d: Driver) => setEditPickerTarget(d)
  const chooseEditSection = (index: number) => {
    if (!editPickerTarget) return
    setEditTarget(editPickerTarget)
    setEditSection(index)
    setEditStatus(editPickerTarget.status ?? '')
    setEditPhotoFile(null)
    setEditLicensePhotoFile(null)
    editForm.reset({
      full_name_en: editPickerTarget.full_name_en ?? '',
      full_name_ne: editPickerTarget.full_name_ne ?? '',
      gender: editPickerTarget.gender ?? '',
      dob: editPickerTarget.dob ?? '',
      citizenship_no: editPickerTarget.citizenship_no ?? '',
      phone: editPickerTarget.phone ?? '',
      address: editPickerTarget.address ?? '',
      emergency_contact_name: editPickerTarget.emergency_contact_name ?? '',
      emergency_contact_number: editPickerTarget.emergency_contact_number ?? '',
      license_no: editPickerTarget.license_no ?? '',
      license_category: editPickerTarget.license_category ?? '',
      license_issue_date: editPickerTarget.license_issue_date ?? '',
      license_expiry: editPickerTarget.license_expiry ?? '',
      license_issuing_authority: editPickerTarget.license_issuing_authority ?? '',
      employment_type: editPickerTarget.employment_type ?? '',
      date_of_joining: editPickerTarget.date_of_joining ?? '',
      experience_years: String(editPickerTarget.experience_years ?? ''),
      previous_employer: editPickerTarget.previous_employer ?? '',
      shift: editPickerTarget.shift ?? '',
      blood_group: editPickerTarget.blood_group ?? '',
      medical_conditions: editPickerTarget.medical_conditions ?? '',
      last_medical_checkup_date: editPickerTarget.last_medical_checkup_date ?? '',
      basic_salary: editPickerTarget.basic_salary ?? '',
      route_id: '',
      bus_id: '',
    })
    setEditPickerTarget(null)
  }
  const closeEdit = () => { setEditTarget(null); setEditPhotoFile(null); setEditLicensePhotoFile(null) }

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

  const { register, handleSubmit, reset, control, setError, trigger, formState: { errors } } = useForm<DriverForm>({
    defaultValues: {
      gender: 'MALE',
      license_category: '',
      employment_type: 'PERMANENT',
      shift: '',
    },
  })

  // Separate form instance for editing -- seeded per-driver, per-section from
  // chooseEditSection() above, not from these defaults (Create's and Edit's
  // forms are independent, same as their separate photo-file state already
  // was before this change).
  const editForm = useForm<DriverForm>()

  // Add Driver wizard: each section is a step. Nothing is saved server-side
  // until the final step's real submit -- currentStep/maxStepReached are
  // purely client-side navigation state, not a draft record. Only Personal
  // and License have required fields, so by the time a user reaches the
  // last step every field handleSubmit's own full-form validation checks
  // has already been triggered once via a step's "Next".
  const [currentStep, setCurrentStep] = useState(0)
  const [maxStepReached, setMaxStepReached] = useState(0)
  const STEPS: { label: string; icon: React.ElementType; fields: (keyof DriverForm)[] }[] = [
    { label: t('staff.drivers.sections.personal'), icon: User, fields: ['full_name_en', 'gender', 'dob', 'citizenship_no', 'phone', 'address'] },
    { label: t('staff.drivers.sections.licenseInfo'), icon: FileText, fields: ['license_no', 'license_category', 'license_expiry'] },
    { label: t('staff.drivers.sections.employment'), icon: Briefcase, fields: [] },
    { label: t('staff.drivers.sections.vehicle'), icon: Bus, fields: [] },
    { label: t('staff.drivers.sections.medical'), icon: Heart, fields: [] },
    { label: t('staff.drivers.sections.salaryWages'), icon: Wallet, fields: [] },
  ]
  const isLastStep = currentStep === STEPS.length - 1

  const resetWizard = () => { setCurrentStep(0); setMaxStepReached(0) }

  const goToStep = (index: number) => {
    if (index <= maxStepReached) setCurrentStep(index)
  }

  const handleNext = async () => {
    const valid = await trigger(STEPS[currentStep].fields)
    if (!valid) return
    const next = Math.min(currentStep + 1, STEPS.length - 1)
    setCurrentStep(next)
    setMaxStepReached((m) => Math.max(m, next))
  }

  const handleBack = () => setCurrentStep((s) => Math.max(s - 1, 0))

  // ── Create ────────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (payload: DriverForm) => {
      const cleanAllowances = allowances
        .filter((a) => a.title.trim())
        .map((a) => ({ title: a.title.trim(), amount: parseFloat(a.amount) || 0 }))

      // Pokhara QA report: experience_years is a PositiveSmallIntegerField
      // with no null=True on the model -- leaving it blank (it has no
      // required asterisk) sends "" straight to DRF's IntegerField, which
      // rejects it outright with a silent-feeling 400. Same guard already
      // used for basic_salary just below, and already applied on the edit
      // path (see editExperience above) -- create was the one gap.
      const experienceYears = payload.experience_years ? Number(payload.experience_years) : 0
      if (!photoFile && !licensePhotoFile) {
        return apiClient.post('/operator/drivers/', {
          ...payload,
          basic_salary: payload.basic_salary || null,
          experience_years: experienceYears,
          allowances: cleanAllowances,
        })
      }
      // Multipart only when a photo was actually picked
      const fd = new FormData()
      Object.entries(payload).forEach(([key, value]) => fd.append(key, value ?? ''))
      fd.set('basic_salary', payload.basic_salary || '')
      fd.set('experience_years', String(experienceYears))
      fd.set('allowances', JSON.stringify(cleanAllowances))
      if (photoFile) fd.append('photo', photoFile)
      if (licensePhotoFile) fd.append('license_photo', licensePhotoFile)
      return apiClient.post('/operator/drivers/', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: () => {
      toast.success(t('staff.drivers.toast.created'))
      setShowCreate(false)
      reset()
      setAllowances([])
      setPhotoFile(null)
      setLicensePhotoFile(null)
      resetWizard()
      qc.invalidateQueries({ queryKey: ['drivers'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { message?: string; errors?: Record<string, unknown> } } }
      if (e?.response?.status === 403) return
      const res = e?.response?.data
      if (res?.errors && typeof res.errors === 'object' && Object.keys(res.errors).length > 0) {
        const firstKey = Object.keys(res.errors)[0]
        const val = res.errors[firstKey]
        const msg = Array.isArray(val) ? String(val[0]) : String(val)
        if (FIELDS_WITH_CLIENT_RULES.has(firstKey)) {
          setError(firstKey as keyof DriverForm, { type: 'server', message: msg })
        }
        toast.error(`${firstKey}: ${msg}`)
      } else {
        toast.error(res?.message || (err as Error).message || t('staff.drivers.toast.createFailed'))
      }
    },
  })

  // ── Update ────────────────────────────────────────────────────────────────────
  const updateDriverMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => {
      if (!editPhotoFile && !editLicensePhotoFile) {
        return apiClient.patch(`/operator/drivers/${editTarget!.id}/`, payload)
      }
      const fd = new FormData()
      Object.entries(payload).forEach(([key, value]) => {
        if (value !== undefined) fd.append(key, value === null ? '' : String(value))
      })
      if (editPhotoFile) fd.append('photo', editPhotoFile)
      if (editLicensePhotoFile) fd.append('license_photo', editLicensePhotoFile)
      return apiClient.patch(`/operator/drivers/${editTarget!.id}/`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: () => {
      toast.success(t('staff.drivers.toast.updated'))
      closeEdit()
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

  // Pokhara QA report: a Driver created via Add Driver has no linked
  // login, so it can never appear in a vehicle group's driver picker --
  // this lets an admin create one after the fact.
  const createLoginMutation = useMutation({
    mutationFn: ({ id, email, password }: { id: string; email: string; password: string }) =>
      apiClient.post(`/operator/drivers/${id}/create-login/`, { email, password }),
    onSuccess: () => {
      toast.success('Login created.')
      setLoginTarget(null)
      setLoginEmail('')
      setLoginPassword('')
      qc.invalidateQueries({ queryKey: ['drivers'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to create login.')
    },
  })

  // Scoped to whichever section was chosen in the picker -- only that
  // section's fields go in the PATCH, so an edit to License can't
  // accidentally resend (and overwrite with stale data) Personal's fields.
  const handleUpdate = (values: DriverForm) => {
    const fields = EDIT_SECTIONS[editSection].fields
    const payload: Record<string, unknown> = {}
    for (const field of fields) {
      if (field === 'experience_years') {
        payload.experience_years = values.experience_years ? Number(values.experience_years) : 0
      } else if (field === 'basic_salary') {
        payload.basic_salary = values.basic_salary || null
      } else {
        payload[field] = values[field]
      }
    }
    if (editSection === EDIT_SECTIONS.length - 1) {
      // Salary section also carries status -- it's not part of DriverForm
      // (an operational field, not something set at creation), so it's
      // added here rather than in the fields loop above.
      payload.status = editStatus
    }
    updateDriverMutation.mutate(payload)
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
            onClick={() => { setViewTarget(d); setViewStep(0) }}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={() => openEditPicker(d)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {!d.user_id && (
            <button
              onClick={() => setLoginTarget(d)}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
              title="Create Login"
            >
              <KeyRound className="h-4 w-4" />
            </button>
          )}
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
        {/* RG-003: avoid flashing "0 of 0 results" under the spinner while loading */}
        {!isLoading && (
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalCount={totalCount}
            pageSize={pagination.pageSize}
            onPageChange={pagination.setPage}
          />
        )}
      </div>

      {/* ── View Driver Modal ─────────────────────────────────────────────── */}
      <Modal
        open={!!viewTarget}
        onClose={() => setViewTarget(null)}
        title={`${t('staff.drivers.title')} — ${viewTarget?.employee_id ?? ''}`}
        size="full"
      >
        {viewTarget && (
          <div className="space-y-6 p-6">
            {/* Nothing to validate here -- every section is freely clickable,
                unlike the Add Driver wizard's gated steps. */}
            <div className="flex items-center gap-2 overflow-x-auto border-b pb-3">
              {VIEW_STEPS.map((step, index) => {
                const StepIcon = step.icon
                const isCurrent = index === viewStep
                return (
                  <button
                    key={step.label}
                    type="button"
                    onClick={() => setViewStep(index)}
                    className={cn(
                      'flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                      isCurrent ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                    )}
                  >
                    <StepIcon className="h-3.5 w-3.5" />
                    {step.label}
                  </button>
                )
              })}
            </div>

            {viewStep === 0 && (
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
            )}

            {viewStep === 1 && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <DetailRow label={t('staff.drivers.fields.licenseNo')} value={viewTarget.license_no} />
                <DetailRow label={t('staff.drivers.table.class')} value={viewTarget.license_category} />
                <DetailRow label={t('staff.drivers.fields.issueDate')} dateValue={viewTarget.license_issue_date} />
                <DetailRow label={t('staff.drivers.fields.expiryDate')} dateValue={viewTarget.license_expiry} />
                <div className="col-span-2">
                  <DetailRow label={t('staff.drivers.fields.issuingAuthority')} value={viewTarget.license_issuing_authority} />
                </div>
              </div>
            )}

            {viewStep === 2 && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <DetailRow label={t('staff.drivers.fields.employeeId')} value={viewTarget.employee_id} />
                <DetailRow label={t('staff.drivers.fields.employmentType')} value={viewTarget.employment_type?.replace('_', ' ')} />
                <DetailRow label={t('staff.drivers.fields.dateOfJoining')} dateValue={viewTarget.date_of_joining} />
                <DetailRow label={t('staff.drivers.experience')} value={viewTarget.experience_years != null ? t('staff.drivers.yrs', { count: viewTarget.experience_years }) : undefined} />
                <DetailRow label={t('staff.drivers.fields.shift')} value={viewTarget.shift} />
                <DetailRow label={t('staff.drivers.fields.previousEmployer')} value={viewTarget.previous_employer} />
              </div>
            )}

            {viewStep === 3 && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <DetailRow label={t('staff.drivers.fields.bloodGroup')} value={viewTarget.blood_group} />
                <DetailRow label={t('staff.drivers.fields.lastCheckup')} dateValue={viewTarget.last_medical_checkup_date} />
                <div className="col-span-2 sm:col-span-3">
                  <DetailRow label={t('staff.drivers.fields.medicalConditions')} value={viewTarget.medical_conditions} />
                </div>
              </div>
            )}

            {viewStep === 4 && (
              <div className="grid grid-cols-2 gap-4">
                <DetailRow label={t('staff.drivers.fields.basicSalary')} value={viewTarget.basic_salary} />
                <DetailRow label={t('staff.drivers.status')} value={viewTarget.status} />
              </div>
            )}

            <div className="flex justify-end border-t pt-4">
              <Button variant="secondary" onClick={() => setViewTarget(null)}>{t('common:common.close')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Edit: choose a section ────────────────────────────────────────── */}
      <Modal
        open={!!editPickerTarget}
        onClose={() => setEditPickerTarget(null)}
        title={t('staff.drivers.editSectionPickerTitle', { defaultValue: 'What do you want to edit?' })}
        size="sm"
      >
        {editPickerTarget && (
          <div className="p-6 space-y-4">
            <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              <strong>{editPickerTarget.full_name_en}</strong> · {editPickerTarget.employee_id}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {EDIT_SECTIONS.map((section, index) => {
                const SectionIcon = section.icon
                return (
                  <button
                    key={section.label}
                    type="button"
                    onClick={() => chooseEditSection(index)}
                    className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 px-3 py-4 text-center text-sm font-medium text-gray-700 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 transition-colors"
                  >
                    <SectionIcon className="h-5 w-5" />
                    {section.label}
                  </button>
                )
              })}
            </div>
            <div className="flex justify-end border-t pt-4">
              <Button variant="secondary" onClick={() => setEditPickerTarget(null)}>{t('common:common.cancel')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Edit: the chosen section's fields ─────────────────────────────── */}
      <Modal
        open={!!editTarget}
        onClose={closeEdit}
        title={`${t('staff.drivers.title')} — ${editTarget?.employee_id ?? ''} — ${EDIT_SECTIONS[editSection].label}`}
        size="md"
      >
        {editTarget && (
          <form onSubmit={editForm.handleSubmit(handleUpdate)} className="space-y-4 p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                <strong>{editTarget.full_name_en}</strong> · {editTarget.employee_id}
              </p>
              <button
                type="button"
                onClick={() => { setEditPickerTarget(editTarget); setEditTarget(null) }}
                className="text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                {t('staff.drivers.changeSection', { defaultValue: 'Change section' })}
              </button>
            </div>

            {editSection === 0 && <>
              <PhotoUploadField label="Photo" existingUrl={editTarget.photo} onFileChange={setEditPhotoFile} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label={t('staff.drivers.fields.fullNameEn')} {...editForm.register('full_name_en')} />
                <NepaliInput label={t('staff.drivers.fields.fullNameNe')} {...editForm.register('full_name_ne')} />
                <Controller
                  name="gender"
                  control={editForm.control}
                  render={({ field }) => (
                    <SelectField label={t('staff.drivers.fields.gender')} {...field}>
                      <option value="MALE">{t('staff.drivers.genders.male')}</option>
                      <option value="FEMALE">{t('staff.drivers.genders.female')}</option>
                      <option value="OTHER">{t('staff.drivers.genders.other')}</option>
                    </SelectField>
                  )}
                />
                <Controller
                  name="dob"
                  control={editForm.control}
                  render={({ field }) => (
                    <NepaliDateInput label={t('staff.drivers.fields.dob')} value={field.value} onChange={field.onChange} />
                  )}
                />
                <Input label={t('staff.drivers.fields.citizenshipNo')} {...editForm.register('citizenship_no')} />
                <Input
                  label={t('staff.drivers.fields.phone')}
                  maxLength={10}
                  inputMode="numeric"
                  {...editForm.register('phone', {
                    onChange: (e) => { e.target.value = sanitizePhoneDigits(e.target.value) },
                  })}
                />
                <div className="sm:col-span-2">
                  <Input label={t('staff.drivers.fields.address')} {...editForm.register('address')} />
                </div>
                <Input label={t('staff.drivers.fields.emergencyContact')} {...editForm.register('emergency_contact_name')} />
                <Input
                  label={t('staff.drivers.fields.emergencyPhone')}
                  maxLength={10}
                  inputMode="numeric"
                  {...editForm.register('emergency_contact_number', {
                    onChange: (e) => { e.target.value = sanitizePhoneDigits(e.target.value) },
                  })}
                />
              </div>
            </>}

            {editSection === 1 && <>
              <PhotoUploadField label="License Photo" existingUrl={editTarget.license_photo} onFileChange={setEditLicensePhotoFile} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label={t('staff.drivers.licenseNumber')} {...editForm.register('license_no')} />
                <Controller
                  name="license_category"
                  control={editForm.control}
                  render={({ field }) => (
                    <SelectField label={t('staff.drivers.fields.licenseClass')} {...field}>
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
                  control={editForm.control}
                  render={({ field }) => (
                    <NepaliDateInput label={t('staff.drivers.fields.issueDate')} value={field.value} onChange={field.onChange} />
                  )}
                />
                <Controller
                  name="license_expiry"
                  control={editForm.control}
                  render={({ field }) => (
                    <NepaliDateInput label={t('staff.drivers.fields.expiryDate')} value={field.value} onChange={field.onChange} />
                  )}
                />
                <div className="sm:col-span-2">
                  <Input label={t('staff.drivers.fields.issuingAuthority')} {...editForm.register('license_issuing_authority')} />
                </div>
              </div>
            </>}

            {editSection === 2 && <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Controller
                  name="date_of_joining"
                  control={editForm.control}
                  render={({ field }) => (
                    <NepaliDateInput label={t('staff.drivers.fields.dateOfJoining')} value={field.value} onChange={field.onChange} />
                  )}
                />
                <Input label={t('staff.drivers.fields.experienceYears')} type="number" min="0" max="50" {...editForm.register('experience_years')} />
                <Controller
                  name="employment_type"
                  control={editForm.control}
                  render={({ field }) => (
                    <SelectField label={t('staff.drivers.fields.employmentType')} {...field}>
                      <option value="PERMANENT">{t('staff.drivers.employmentTypes.permanent')}</option>
                      <option value="CONTRACT">{t('staff.drivers.employmentTypes.contract')}</option>
                      <option value="PART_TIME">{t('staff.drivers.employmentTypes.partTime')}</option>
                    </SelectField>
                  )}
                />
                <Input label={t('staff.drivers.fields.previousEmployer')} {...editForm.register('previous_employer')} />
                <Controller
                  name="shift"
                  control={editForm.control}
                  render={({ field }) => (
                    <SelectField label={t('staff.drivers.fields.shift')} {...field}>
                      <option value="">{t('staff.drivers.notAssigned')}</option>
                      <option value="MORNING">{t('staff.drivers.shifts.morning')}</option>
                      <option value="DAY">{t('staff.drivers.shifts.day')}</option>
                      <option value="EVENING">{t('staff.drivers.shifts.evening')}</option>
                      <option value="NIGHT">{t('staff.drivers.shifts.night')}</option>
                    </SelectField>
                  )}
                />
              </div>
            </>}

            {editSection === 3 && <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Controller
                  name="blood_group"
                  control={editForm.control}
                  render={({ field }) => (
                    <SelectField label={t('staff.drivers.fields.bloodGroup')} {...field}>
                      <option value="">{t('staff.drivers.unknown')}</option>
                      {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((bg) => (
                        <option key={bg} value={bg}>{bg}</option>
                      ))}
                    </SelectField>
                  )}
                />
                <Controller
                  name="last_medical_checkup_date"
                  control={editForm.control}
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
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    {...editForm.register('medical_conditions')}
                  />
                </div>
              </div>
            </>}

            {editSection === 4 && <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label={t('staff.drivers.fields.basicSalary')} type="number" min="0" step="0.01" {...editForm.register('basic_salary')} />
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
              </div>
            </>}

            <div className="flex justify-end gap-3 border-t pt-4">
              <Button type="button" variant="secondary" onClick={closeEdit}>{t('common:common.cancel')}</Button>
              <Button type="submit" loading={updateDriverMutation.isPending}>
                {t('staff.drivers.saveChanges')}
              </Button>
            </div>
          </form>
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

      {/* ── Create Login Modal ────────────────────────────────────────────── */}
      <Modal
        open={!!loginTarget}
        onClose={() => { setLoginTarget(null); setLoginEmail(''); setLoginPassword('') }}
        title={`Create Login — ${loginTarget?.full_name_en ?? ''}`}
        size="sm"
      >
        {loginTarget && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-600">
              Lets {loginTarget.full_name_en} sign in, and makes them selectable when staffing a vehicle group.
            </p>
            <Input
              label="Email" type="email" required
              placeholder="e.g. krishna.thapa@example.com"
              value={loginEmail}
              error={loginEmail && !isValidEmail(loginEmail) ? EMAIL_VALIDATION_MESSAGE : undefined}
              onChange={(e) => setLoginEmail(e.target.value)}
            />
            <Input
              label="Password" type="password" required
              placeholder="Temporary password"
              value={loginPassword}
              error={loginPassword && !isValidPassword(loginPassword) ? PASSWORD_VALIDATION_MESSAGE : undefined}
              onChange={(e) => setLoginPassword(e.target.value)}
            />
            <div className="flex justify-end gap-3 border-t pt-4">
              <Button variant="secondary" onClick={() => { setLoginTarget(null); setLoginEmail(''); setLoginPassword('') }}>
                {t('common:common.cancel')}
              </Button>
              <Button
                loading={createLoginMutation.isPending}
                disabled={!isValidEmail(loginEmail) || !isValidPassword(loginPassword)}
                leftIcon={<KeyRound className="h-4 w-4" />}
                onClick={() => createLoginMutation.mutate({ id: loginTarget.id, email: loginEmail, password: loginPassword })}
              >
                Create Login
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Add Driver Modal ──────────────────────────────────────────────── */}
      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); reset(); setAllowances([]); setPhotoFile(null); setLicensePhotoFile(null); resetWizard() }}
        title={t('staff.drivers.addDriver')}
        size="full"
      >
        <form
          onSubmit={handleSubmit((d) => createMutation.mutate(d))}
          onKeyDown={(e) => {
            // Enter must never reach the browser's native "submit via GET to
            // the current URL" fallback -- on the last step, !isLastStep was
            // false so this handler used to do nothing, leaving Enter to
            // fall through to that native submit, which reloads the whole
            // page and silently discards every step's data (confirmed live:
            // pressing Enter in Basic Salary on the last step navigated to
            // a fresh GET /tenant/drivers, no POST ever fired). Always
            // intercept Enter here instead, and on the last step trigger
            // the real React-controlled submit via requestSubmit() rather
            // than letting the keypress do anything by default. Exempted:
            // the Medical Conditions textarea, where Enter should insert a
            // newline like any other multi-line field.
            if (e.key !== 'Enter' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
            e.preventDefault()
            if (isLastStep) {
              e.currentTarget.requestSubmit()
            } else {
              handleNext()
            }
          }}
          className="space-y-6 p-6"
        >
          {/* ── Step indicator ──────────────────────────────────────────────── */}
          <div className="flex items-center overflow-x-auto pb-2">
            {STEPS.map((step, index) => {
              const isDone = index < maxStepReached
              const isCurrent = index === currentStep
              const isUnlocked = index <= maxStepReached
              const StepIcon = step.icon
              return (
                <div key={step.label} className="flex items-center">
                  <button
                    type="button"
                    disabled={!isUnlocked}
                    onClick={() => goToStep(index)}
                    className={cn(
                      'flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                      isCurrent && 'bg-primary-600 text-white',
                      !isCurrent && isDone && 'bg-primary-50 text-primary-700 hover:bg-primary-100 cursor-pointer',
                      !isCurrent && !isDone && isUnlocked && 'bg-gray-100 text-gray-600 hover:bg-gray-200 cursor-pointer',
                      !isUnlocked && 'bg-gray-50 text-gray-300 cursor-not-allowed',
                    )}
                  >
                    {isDone
                      ? <Check className="h-3.5 w-3.5" />
                      : <StepIcon className="h-3.5 w-3.5" />}
                    {step.label}
                  </button>
                  {index < STEPS.length - 1 && (
                    <div className={cn('h-px w-6 shrink-0', isDone ? 'bg-primary-300' : 'bg-gray-200')} />
                  )}
                </div>
              )
            })}
          </div>

          {/* Personal Information */}
          {currentStep === 0 && <>
          <Section icon={User} title={t('staff.drivers.sections.personal')} />
          <PhotoUploadField label="Photo" hint="Optional — can be added later via Edit" onFileChange={setPhotoFile} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-1">
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
            <Input
              label={t('staff.drivers.fields.phone')}
              placeholder="98XXXXXXXX"
              maxLength={10}
              inputMode="numeric"
              required
              error={errors.phone?.message}
              {...register('phone', {
                required: t('staff.drivers.validation.phoneRequired'),
                validate: (v) => isValidPhone(v) || PHONE_VALIDATION_MESSAGE,
                onChange: (e) => { e.target.value = sanitizePhoneDigits(e.target.value) },
              })}
            />
            <div className="sm:col-span-2 lg:col-span-3">
              <Input
                label={t('staff.drivers.fields.address')}
                placeholder="e.g. Kalanki, Kathmandu"
                required
                error={errors.address?.message}
                {...register('address', { required: t('staff.drivers.validation.addressRequired') })}
              />
            </div>
            <Input
              label={t('staff.drivers.fields.emergencyContact')}
              placeholder="e.g. Sita Shrestha"
              {...register('emergency_contact_name')}
            />
            <Input
              label={t('staff.drivers.fields.emergencyPhone')}
              placeholder="98XXXXXXXX"
              maxLength={10}
              inputMode="numeric"
              error={errors.emergency_contact_number?.message}
              {...register('emergency_contact_number', {
                validate: (v) => !v || isValidPhone(v) || PHONE_VALIDATION_MESSAGE,
                onChange: (e) => { e.target.value = sanitizePhoneDigits(e.target.value) },
              })}
            />
          </div>
          </>}

          {/* Driver License Information */}
          {currentStep === 1 && <>
          <Section icon={FileText} title={t('staff.drivers.sections.licenseInfo')} />
          <PhotoUploadField label="License Photo" hint="Optional — can be added later via Edit" onFileChange={setLicensePhotoFile} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            <div className="sm:col-span-2 lg:col-span-2">
              <Input
                label={t('staff.drivers.fields.issuingAuthority')}
                placeholder="e.g. Department of Transport Management, Bagmati Province"
                {...register('license_issuing_authority')}
              />
            </div>
          </div>
          </>}

          {/* Employment Information */}
          {currentStep === 2 && <>
          <Section icon={Briefcase} title={t('staff.drivers.sections.employment')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          </>}

          {/* Vehicle Information */}
          {currentStep === 3 && <>
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
          </>}

          {/* Medical Information */}
          {currentStep === 4 && <>
          <Section icon={Heart} title={t('staff.drivers.sections.medical')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            <div className="sm:col-span-2 lg:col-span-3">
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
          </>}

          {/* Salary & Wages */}
          {currentStep === 5 && <>
          <Section icon={Wallet} title={t('staff.drivers.sections.salaryWages')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              label={t('staff.drivers.fields.basicSalary')}
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 25000"
              {...register('basic_salary')}
            />
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
          </>}

          {/* Actions */}
          <div className="flex justify-between gap-3 border-t pt-4">
            <div>
              {currentStep > 0 && (
                <Button variant="secondary" type="button" leftIcon={<ChevronLeft className="h-4 w-4" />} onClick={handleBack}>
                  {t('common:common.back', { defaultValue: 'Back' })}
                </Button>
              )}
            </div>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                type="button"
                onClick={() => { setShowCreate(false); reset(); setAllowances([]); setPhotoFile(null); setLicensePhotoFile(null); resetWizard() }}
              >
                {t('common:common.cancel')}
              </Button>
              {isLastStep ? (
                <Button type="submit" loading={createMutation.isPending} leftIcon={<Plus className="h-4 w-4" />}>
                  {t('staff.drivers.addDriver')}
                </Button>
              ) : (
                <Button type="button" rightIcon={<ChevronRight className="h-4 w-4" />} onClick={handleNext}>
                  {t('common:common.next', { defaultValue: 'Next' })}
                </Button>
              )}
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
