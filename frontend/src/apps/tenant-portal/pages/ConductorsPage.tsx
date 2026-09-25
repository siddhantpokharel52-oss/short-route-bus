import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, User, Briefcase, Bus, Heart, Wallet, Trash2, Eye, Pencil, AlertTriangle, KeyRound, Link2, Unlink, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { NepaliInput } from '@components/shared/NepaliInput'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge, statusVariant } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { PhotoUploadField } from '@components/shared/PhotoUploadField'
import { NepaliDateInput } from '@components/shared/NepaliDateInput'
import { DateDisplay } from '@components/shared/DateDisplay'
import { usePagination } from '@hooks/usePagination'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { useForm, Controller } from 'react-hook-form'
import { sanitizePhoneDigits, isValidPhone, PHONE_VALIDATION_MESSAGE } from '@utils/phone'
import { isValidEmail, EMAIL_VALIDATION_MESSAGE } from '@utils/email'
import { isValidPassword, PASSWORD_VALIDATION_MESSAGE } from '@utils/password'
import { cn } from '@utils/cn'

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
  photo: string | null
  citizenship_photo: string | null
  shift: string
  blood_group: string
  employment_type: string
  date_of_joining: string
  assigned_vehicle_id: string | null
  assigned_route_id: string | null
  basic_salary: string
  status: string
  user_id: string | null
  partner_linked: { partner: string; external_partner_id: string } | null
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

function DetailRow({
  label,
  value,
  dateValue,
}: {
  label: string
  value?: string | number | null
  dateValue?: string | null
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</span>
      {dateValue != null
        ? <DateDisplay date={dateValue} />
        : <span className="text-sm text-gray-900">{value ?? '—'}</span>
      }
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

  // Optional photo uploads -- same "tracked separately from react-hook-form,
  // multipart only if actually set" pattern as Drivers/company logo.
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [citizenshipPhotoFile, setCitizenshipPhotoFile] = useState<File | null>(null)
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null)
  const [editCitizenshipPhotoFile, setEditCitizenshipPhotoFile] = useState<File | null>(null)

  // ── CRUD targets ─────────────────────────────────────────────────────────────
  const [viewTarget, setViewTarget] = useState<Collector | null>(null)
  const [viewStep, setViewStep] = useState(0)
  const VIEW_STEPS: { label: string; icon: React.ElementType }[] = [
    { label: t('staff.conductors.personalInfo'), icon: User },
    { label: t('staff.conductors.employmentInfo'), icon: Briefcase },
    { label: t('staff.conductors.busAssignment'), icon: Bus },
    { label: t('staff.conductors.medicalInfo'), icon: Heart },
    { label: t('staff.conductors.salaryWages'), icon: Wallet },
  ]
  // Same 5 sections as VIEW_STEPS, each naming which CollectorForm fields it
  // edits -- same two-step "pick a section, then edit just that section"
  // flow as DriversPage.tsx, adapted to Collector's own fields (no license,
  // vehicle/route assignment instead).
  const EDIT_SECTIONS: { label: string; icon: React.ElementType; fields: (keyof CollectorForm)[] }[] = [
    { label: t('staff.conductors.personalInfo'), icon: User, fields: ['full_name_en', 'full_name_ne', 'gender', 'dob', 'citizenship_no', 'phone', 'address', 'emergency_contact_name', 'emergency_contact_number'] },
    { label: t('staff.conductors.employmentInfo'), icon: Briefcase, fields: ['employment_type', 'date_of_joining', 'shift', 'assigned_route_id'] },
    { label: t('staff.conductors.busAssignment'), icon: Bus, fields: ['assigned_vehicle_id'] },
    { label: t('staff.conductors.medicalInfo'), icon: Heart, fields: ['blood_group'] },
    { label: t('staff.conductors.salaryWages'), icon: Wallet, fields: ['basic_salary'] },
  ]

  const [editPickerTarget, setEditPickerTarget] = useState<Collector | null>(null)
  const [editTarget, setEditTarget] = useState<Collector | null>(null)
  const [editSection, setEditSection] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<Collector | null>(null)
  const [loginTarget, setLoginTarget] = useState<Collector | null>(null)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [linkTarget, setLinkTarget] = useState<Collector | null>(null)
  const [yatrooExternalId, setYatrooExternalId] = useState('')

  // status isn't part of CollectorForm (operational, not set at creation) --
  // kept separately, edited alongside basic_salary on the Salary section.
  const [editStatus, setEditStatus] = useState('')

  const openEditPicker = (c: Collector) => setEditPickerTarget(c)
  const chooseEditSection = (index: number) => {
    if (!editPickerTarget) return
    setEditTarget(editPickerTarget)
    setEditSection(index)
    setEditStatus(editPickerTarget.status ?? '')
    setEditPhotoFile(null)
    setEditCitizenshipPhotoFile(null)
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
      blood_group: editPickerTarget.blood_group ?? '',
      employment_type: editPickerTarget.employment_type ?? '',
      date_of_joining: editPickerTarget.date_of_joining ?? '',
      shift: editPickerTarget.shift ?? '',
      assigned_vehicle_id: editPickerTarget.assigned_vehicle_id ?? '',
      assigned_route_id: editPickerTarget.assigned_route_id ?? '',
      basic_salary: editPickerTarget.basic_salary ?? '',
    })
    setEditPickerTarget(null)
  }
  const closeEdit = () => { setEditTarget(null); setEditPhotoFile(null); setEditCitizenshipPhotoFile(null) }

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

  const { register, handleSubmit, reset, control, trigger, formState: { errors } } = useForm<CollectorForm>({
    defaultValues: { gender: 'MALE', employment_type: 'PERMANENT', shift: '', assigned_route_id: '', assigned_vehicle_id: '' },
  })

  // Separate form instance for editing -- seeded per-conductor, per-section
  // from chooseEditSection() above, same independence from Create's form as
  // DriversPage.tsx's editForm.
  const editForm = useForm<CollectorForm>()

  // Add Collector wizard: each section is a step, gated the same way as
  // Add Driver's -- only Personal has required fields, so by the last step
  // every field's client-side validation has already run via a "Next".
  const [currentStep, setCurrentStep] = useState(0)
  const [maxStepReached, setMaxStepReached] = useState(0)
  const STEPS: { label: string; icon: React.ElementType; fields: (keyof CollectorForm)[] }[] = [
    { label: t('staff.conductors.personalInfo'), icon: User, fields: ['full_name_en', 'gender', 'dob', 'citizenship_no', 'phone', 'address'] },
    { label: t('staff.conductors.employmentInfo'), icon: Briefcase, fields: [] },
    { label: t('staff.conductors.busAssignment'), icon: Bus, fields: [] },
    { label: t('staff.conductors.medicalInfo'), icon: Heart, fields: [] },
    { label: t('staff.conductors.salaryWages'), icon: Wallet, fields: [] },
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
    mutationFn: (payload: CollectorForm) => {
      const cleanAllowances = allowances
        .filter((a) => a.title.trim())
        .map((a) => ({ title: a.title.trim(), amount: parseFloat(a.amount) || 0 }))

      if (!photoFile && !citizenshipPhotoFile) {
        return apiClient.post('/operator/conductors/', {
          ...payload,
          assigned_vehicle_id: payload.assigned_vehicle_id || null,
          assigned_route_id: payload.assigned_route_id || null,
          basic_salary: payload.basic_salary || null,
          allowances: cleanAllowances,
        })
      }
      const fd = new FormData()
      Object.entries(payload).forEach(([key, value]) => fd.append(key, value ?? ''))
      fd.set('assigned_vehicle_id', payload.assigned_vehicle_id || '')
      fd.set('assigned_route_id', payload.assigned_route_id || '')
      fd.set('basic_salary', payload.basic_salary || '')
      fd.set('allowances', JSON.stringify(cleanAllowances))
      if (photoFile) fd.append('photo', photoFile)
      if (citizenshipPhotoFile) fd.append('citizenship_photo', citizenshipPhotoFile)
      return apiClient.post('/operator/conductors/', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: () => {
      toast.success(t('staff.conductors.toast.addSuccess'))
      setShowCreate(false)
      reset()
      setAllowances([])
      setPhotoFile(null)
      setCitizenshipPhotoFile(null)
      resetWizard()
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
        toast.error(res?.message || (err as Error).message || t('staff.conductors.toast.addError'))
      }
    },
  })

  // ── Update ────────────────────────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => {
      if (!editPhotoFile && !editCitizenshipPhotoFile) {
        return apiClient.patch(`/operator/conductors/${editTarget!.id}/`, payload)
      }
      const fd = new FormData()
      Object.entries(payload).forEach(([key, value]) => {
        if (value !== undefined) fd.append(key, value === null ? '' : String(value))
      })
      if (editPhotoFile) fd.append('photo', editPhotoFile)
      if (editCitizenshipPhotoFile) fd.append('citizenship_photo', editCitizenshipPhotoFile)
      return apiClient.patch(`/operator/conductors/${editTarget!.id}/`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: () => {
      toast.success(t('staff.conductors.toast.updateSuccess'))
      closeEdit()
      qc.invalidateQueries({ queryKey: ['conductors'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || t('staff.conductors.toast.updateError'))
    },
  })

  // ── Delete ────────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/operator/conductors/${id}/`),
    onSuccess: () => {
      toast.success(t('staff.conductors.toast.deleteSuccess'))
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['conductors'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || t('staff.conductors.toast.deleteError'))
    },
  })

  // Pokhara QA report: a Collector created via Add Collector has no linked
  // login, so it can never appear in a vehicle group's conductor picker --
  // this lets an admin create one after the fact.
  const createLoginMutation = useMutation({
    mutationFn: ({ id, email, password }: { id: string; email: string; password: string }) =>
      apiClient.post(`/operator/conductors/${id}/create-login/`, { email, password }),
    onSuccess: () => {
      toast.success('Login created.')
      setLoginTarget(null)
      setLoginEmail('')
      setLoginPassword('')
      qc.invalidateQueries({ queryKey: ['conductors'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to create login.')
    },
  })

  // Yatroo conductor mode: links this conductor's existing login to a
  // specific Yatroo account, so their federated-login call returns a
  // CONDUCTOR token for this exact person instead of a fresh passenger.
  const linkPartnerMutation = useMutation({
    mutationFn: ({ id, externalPartnerId }: { id: string; externalPartnerId: string }) =>
      apiClient.post(`/operator/conductors/${id}/link-partner-account/`, { external_partner_id: externalPartnerId }),
    onSuccess: () => {
      toast.success('Linked to Yatroo.')
      setLinkTarget(null)
      setYatrooExternalId('')
      qc.invalidateQueries({ queryKey: ['conductors'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to link.')
    },
  })

  const unlinkPartnerMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/operator/conductors/${id}/unlink-partner-account/`),
    onSuccess: () => {
      toast.success('Unlinked from Yatroo.')
      qc.invalidateQueries({ queryKey: ['conductors'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to unlink.')
    },
  })

  // Scoped to whichever section was chosen in the picker -- same design as
  // DriversPage.tsx's handleUpdate.
  const handleUpdate = (values: CollectorForm) => {
    const fields = EDIT_SECTIONS[editSection].fields
    const payload: Record<string, unknown> = {}
    for (const field of fields) {
      if (field === 'assigned_vehicle_id' || field === 'assigned_route_id') {
        payload[field] = values[field] || null
      } else if (field === 'basic_salary') {
        payload.basic_salary = values.basic_salary || null
      } else {
        payload[field] = values[field]
      }
    }
    if (editSection === EDIT_SECTIONS.length - 1) {
      // Salary section also carries status -- see editStatus's own comment.
      payload.status = editStatus
    }
    updateMutation.mutate(payload)
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
        : <span className="text-xs text-gray-400 italic">{t('staff.conductors.notAssigned')}</span>,
    },
    {
      key: 'employment_type',
      header: t('staff.conductors.employmentType'),
      render: (c) => c.employment_type?.replace('_', ' ') || '—',
    },
    { key: 'blood_group', header: t('staff.conductors.bloodGroup'), render: (c) => c.blood_group || '—' },
    {
      key: 'status',
      header: t('staff.conductors.status'),
      render: (c) => <Badge variant={statusVariant(c.status)} dot>{c.status}</Badge>,
    },
    {
      key: 'id',
      header: t('staff.conductors.actions'),
      render: (c) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewTarget(c)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
            title={t('common:common.view')}
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={() => openEditPicker(c)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
            title={t('common:common.edit')}
          >
            <Pencil className="h-4 w-4" />
          </button>
          {!c.user_id && (
            <button
              onClick={() => setLoginTarget(c)}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
              title="Create Login"
            >
              <KeyRound className="h-4 w-4" />
            </button>
          )}
          {c.user_id && !c.partner_linked && (
            <button
              onClick={() => setLinkTarget(c)}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-sky-50 hover:text-sky-600 transition-colors"
              title="Link to Yatroo"
            >
              <Link2 className="h-4 w-4" />
            </button>
          )}
          {c.partner_linked && (
            <button
              onClick={() => unlinkPartnerMutation.mutate(c.id)}
              className="rounded-lg p-1.5 text-sky-500 hover:bg-red-50 hover:text-red-600 transition-colors"
              title={`Linked to Yatroo (${c.partner_linked.external_partner_id}) — click to unlink`}
            >
              <Unlink className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => setDeleteTarget(c)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
            title={t('common:common.delete')}
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
        {/* RG-003: avoid flashing "0 of 0 results" under the spinner while loading */}
        {!isLoading && (
          <Pagination
            page={pagination.page} totalPages={pagination.totalPages}
            totalCount={totalCount} pageSize={pagination.pageSize}
            onPageChange={pagination.setPage}
          />
        )}
      </div>

      {/* ── View Collector Modal ──────────────────────────────────────────── */}
      <Modal
        open={!!viewTarget}
        onClose={() => setViewTarget(null)}
        title={`${t('staff.conductors.title')} — ${viewTarget?.employee_id ?? ''}`}
        size="full"
      >
        {viewTarget && (
          <div className="space-y-6 p-6">
            {/* Nothing to validate here -- every section is freely clickable,
                unlike the Add Collector wizard's gated steps. */}
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
                <DetailRow label={t('staff.conductors.fullNameEn')} value={viewTarget.full_name_en} />
                <DetailRow label={t('staff.conductors.fullNameNe')} value={viewTarget.full_name_ne} />
                <DetailRow label={t('staff.conductors.gender')} value={viewTarget.gender} />
                <DetailRow label={t('staff.conductors.dateOfBirth')} dateValue={viewTarget.dob} />
                <DetailRow label={t('staff.conductors.citizenshipNo')} value={viewTarget.citizenship_no} />
                <DetailRow label={t('staff.conductors.phone')} value={viewTarget.phone} />
                <div className="col-span-2 sm:col-span-3">
                  <DetailRow label={t('staff.conductors.address')} value={viewTarget.address} />
                </div>
                <DetailRow label={t('staff.conductors.emergencyContact')} value={viewTarget.emergency_contact_name} />
                <DetailRow label={t('staff.conductors.emergencyPhone')} value={viewTarget.emergency_contact_number} />
              </div>
            )}

            {viewStep === 1 && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <DetailRow label={t('staff.conductors.employeeId')} value={viewTarget.employee_id} />
                <DetailRow label={t('staff.conductors.employmentType')} value={viewTarget.employment_type?.replace('_', ' ')} />
                <DetailRow label={t('staff.conductors.dateOfJoining')} dateValue={viewTarget.date_of_joining} />
                <DetailRow label={t('staff.conductors.shift')} value={viewTarget.shift} />
                <DetailRow label={t('staff.conductors.status')} value={viewTarget.status} />
              </div>
            )}

            {viewStep === 2 && (
              <div className="grid grid-cols-2 gap-4">
                <DetailRow
                  label={t('staff.conductors.assignedBus')}
                  value={viewTarget.assigned_vehicle_id
                    ? (vehicleMap.get(viewTarget.assigned_vehicle_id) ?? viewTarget.assigned_vehicle_id)
                    : '—'}
                />
                <DetailRow
                  label={t('staff.conductors.assignedRoute')}
                  value={viewTarget.assigned_route_id
                    ? (routeMap.get(viewTarget.assigned_route_id) ?? viewTarget.assigned_route_id)
                    : '—'}
                />
              </div>
            )}

            {viewStep === 3 && (
              <div className="grid grid-cols-2 gap-4">
                <DetailRow label={t('staff.conductors.bloodGroup')} value={viewTarget.blood_group} />
              </div>
            )}

            {viewStep === 4 && (
              <div className="grid grid-cols-2 gap-4">
                <DetailRow label={t('staff.conductors.basicSalary')} value={viewTarget.basic_salary} />
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
        title={t('staff.conductors.editSectionPickerTitle', { defaultValue: 'What do you want to edit?' })}
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
        title={`${t('staff.conductors.title')} — ${editTarget?.employee_id ?? ''} — ${EDIT_SECTIONS[editSection].label}`}
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
                {t('staff.conductors.changeSection', { defaultValue: 'Change section' })}
              </button>
            </div>

            {editSection === 0 && <>
              <PhotoUploadField label="Photo" existingUrl={editTarget.photo} onFileChange={setEditPhotoFile} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label={t('staff.conductors.fullNameEn')} {...editForm.register('full_name_en')} />
                <NepaliInput label={t('staff.conductors.fullNameNe')} {...editForm.register('full_name_ne')} />
                <Controller
                  name="gender"
                  control={editForm.control}
                  render={({ field }) => (
                    <SelectField label={t('staff.conductors.gender')} {...field}>
                      <option value="MALE">{t('staff.conductors.genders.MALE')}</option>
                      <option value="FEMALE">{t('staff.conductors.genders.FEMALE')}</option>
                      <option value="OTHER">{t('staff.conductors.genders.OTHER')}</option>
                    </SelectField>
                  )}
                />
                <Controller
                  name="dob"
                  control={editForm.control}
                  render={({ field }) => (
                    <NepaliDateInput label={t('staff.conductors.dateOfBirth')} value={field.value} onChange={field.onChange} />
                  )}
                />
                <Input label={t('staff.conductors.citizenshipNo')} {...editForm.register('citizenship_no')} />
                <Input
                  label={t('staff.conductors.phoneNumber')}
                  maxLength={10}
                  inputMode="numeric"
                  {...editForm.register('phone', {
                    onChange: (e) => { e.target.value = sanitizePhoneDigits(e.target.value) },
                  })}
                />
                <div className="sm:col-span-2">
                  <Input label={t('staff.conductors.address')} {...editForm.register('address')} />
                </div>
                <Input label={t('staff.conductors.emergencyContact')} {...editForm.register('emergency_contact_name')} />
                <Input
                  label={t('staff.conductors.emergencyPhone')}
                  maxLength={10}
                  inputMode="numeric"
                  {...editForm.register('emergency_contact_number', {
                    onChange: (e) => { e.target.value = sanitizePhoneDigits(e.target.value) },
                  })}
                />
              </div>
            </>}

            {editSection === 1 && <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Controller
                  name="date_of_joining"
                  control={editForm.control}
                  render={({ field }) => (
                    <NepaliDateInput label={t('staff.conductors.dateOfJoining')} value={field.value} onChange={field.onChange} />
                  )}
                />
                <Controller
                  name="employment_type"
                  control={editForm.control}
                  render={({ field }) => (
                    <SelectField label={t('staff.conductors.employmentType')} {...field}>
                      <option value="PERMANENT">{t('staff.conductors.types.PERMANENT')}</option>
                      <option value="CONTRACT">{t('staff.conductors.types.CONTRACT')}</option>
                      <option value="PART_TIME">{t('staff.conductors.types.PART_TIME')}</option>
                    </SelectField>
                  )}
                />
                <Controller
                  name="shift"
                  control={editForm.control}
                  render={({ field }) => (
                    <SelectField label={t('staff.conductors.shift')} {...field}>
                      <option value="">{t('staff.conductors.notAssignedOption')}</option>
                      <option value="MORNING">{t('staff.conductors.shifts.MORNING')}</option>
                      <option value="DAY">{t('staff.conductors.shifts.DAY')}</option>
                      <option value="EVENING">{t('staff.conductors.shifts.EVENING')}</option>
                      <option value="NIGHT">{t('staff.conductors.shifts.NIGHT')}</option>
                    </SelectField>
                  )}
                />
                <Controller
                  name="assigned_route_id"
                  control={editForm.control}
                  render={({ field }) => (
                    <SelectField label={t('staff.conductors.routeAssigned')} {...field}>
                      <option value="">{t('staff.conductors.notAssignedOption')}</option>
                      {(routes as { id: string; route_code?: string; name_en?: string }[]).map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.route_code ? `${r.route_code} — ` : ''}{r.name_en ?? r.id}
                        </option>
                      ))}
                    </SelectField>
                  )}
                />
              </div>
            </>}

            {editSection === 2 && <>
              <Controller
                name="assigned_vehicle_id"
                control={editForm.control}
                render={({ field }) => (
                  <SelectField label={t('staff.conductors.assignToBus')} {...field}>
                    <option value="">{t('staff.conductors.notAssignedOption')}</option>
                    {(vehicles as { id: string; registration_no?: string }[]).map((v) => (
                      <option key={v.id} value={v.id}>{v.registration_no ?? v.id}</option>
                    ))}
                  </SelectField>
                )}
              />
            </>}

            {editSection === 3 && <>
              <Controller
                name="blood_group"
                control={editForm.control}
                render={({ field }) => (
                  <SelectField label={t('staff.conductors.bloodGroup')} {...field}>
                    <option value="">{t('staff.conductors.unknownBloodGroup')}</option>
                    {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((bg) => (
                      <option key={bg} value={bg}>{bg}</option>
                    ))}
                  </SelectField>
                )}
              />
            </>}

            {editSection === 4 && <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label={t('staff.conductors.basicSalary')} type="number" min="0" step="0.01" {...editForm.register('basic_salary')} />
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{t('staff.conductors.status')}</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="ACTIVE">{t('staff.conductors.statusOptions.ACTIVE')}</option>
                    <option value="INACTIVE">{t('staff.conductors.statusOptions.INACTIVE')}</option>
                    <option value="ON_LEAVE">{t('staff.conductors.statusOptions.ON_LEAVE')}</option>
                    <option value="SUSPENDED">{t('staff.conductors.statusOptions.SUSPENDED')}</option>
                  </select>
                </div>
              </div>
            </>}

            <div className="flex justify-end gap-3 border-t pt-4">
              <Button type="button" variant="secondary" onClick={closeEdit}>{t('common:common.cancel')}</Button>
              <Button type="submit" loading={updateMutation.isPending}>
                {t('common:common.update')}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Delete Collector Modal ────────────────────────────────────────── */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={`${t('common:common.delete')} ${t('staff.conductors.title')}`}
        size="sm"
      >
        {deleteTarget && (
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3 rounded-lg bg-red-50 p-4">
              <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-700">{t('staff.conductors.deleteWarning')}</p>
                <p className="text-sm text-red-600 mt-1">
                  {t('staff.conductors.deleteConfirm', {
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
                loading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                leftIcon={<Trash2 className="h-4 w-4" />}
              >
                {t('common:common.delete')} {t('staff.conductors.title')}
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
              placeholder="e.g. ramesh.gurung@example.com"
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

      {/* ── Link to Yatroo Modal ──────────────────────────────────────────── */}
      <Modal
        open={!!linkTarget}
        onClose={() => { setLinkTarget(null); setYatrooExternalId('') }}
        title={`Link to Yatroo — ${linkTarget?.full_name_en ?? ''}`}
        size="sm"
      >
        {linkTarget && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-600">
              When Yatroo's app signs {linkTarget.full_name_en} in with this account id, they'll get a conductor
              session for this exact login — never a new one created automatically.
            </p>
            <Input
              label="Yatroo external_user_id" required
              placeholder="e.g. yatroo-driver-4471"
              value={yatrooExternalId}
              onChange={(e) => setYatrooExternalId(e.target.value)}
            />
            <div className="flex justify-end gap-3 border-t pt-4">
              <Button variant="secondary" onClick={() => { setLinkTarget(null); setYatrooExternalId('') }}>
                {t('common:common.cancel')}
              </Button>
              <Button
                loading={linkPartnerMutation.isPending}
                disabled={!yatrooExternalId.trim()}
                leftIcon={<Link2 className="h-4 w-4" />}
                onClick={() => linkPartnerMutation.mutate({ id: linkTarget.id, externalPartnerId: yatrooExternalId.trim() })}
              >
                Link
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Add Collector Modal ───────────────────────────────────────────── */}
      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); reset(); setAllowances([]); setPhotoFile(null); setCitizenshipPhotoFile(null); resetWizard() }}
        title={t('staff.conductors.addConductor')}
        size="full"
      >
        <form
          onSubmit={handleSubmit((d) => createMutation.mutate(d))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isLastStep) { e.preventDefault(); handleNext() }
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
          <Section icon={User} title={t('staff.conductors.personalInfo')} />
          <PhotoUploadField label="Photo" hint="Optional — can be added later via Edit" onFileChange={setPhotoFile} />
          <PhotoUploadField label="Citizenship Photo" hint="Optional — can be added later via Edit" onFileChange={setCitizenshipPhotoFile} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-1">
              <Input
                label={t('staff.conductors.fullNameEn')}
                required
                placeholder="e.g. Hari Prasad Adhikari"
                error={errors.full_name_en?.message}
                {...register('full_name_en', { required: t('staff.conductors.validation.fullNameRequired') })}
              />
            </div>
            <NepaliInput
              label={t('staff.conductors.fullNameNe')}
              placeholder="हरि प्रसाद अधिकारी"
              {...register('full_name_ne')}
            />
            <Controller
              name="gender"
              control={control}
              rules={{ required: t('staff.conductors.validation.genderRequired') }}
              render={({ field }) => (
                <SelectField label={t('staff.conductors.gender')} required error={errors.gender?.message} {...field}>
                  <option value="">{t('staff.conductors.selectGender')}</option>
                  <option value="MALE">{t('staff.conductors.genders.MALE')}</option>
                  <option value="FEMALE">{t('staff.conductors.genders.FEMALE')}</option>
                  <option value="OTHER">{t('staff.conductors.genders.OTHER')}</option>
                </SelectField>
              )}
            />
            <Controller
              name="dob"
              control={control}
              rules={{ required: t('staff.conductors.validation.dobRequired') }}
              render={({ field }) => (
                <NepaliDateInput
                  label={t('staff.conductors.dateOfBirth')}
                  required
                  error={errors.dob?.message}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <Input
              label={t('staff.conductors.citizenshipNo')}
              required
              placeholder="e.g. 12-34-56-78901"
              error={errors.citizenship_no?.message}
              {...register('citizenship_no', { required: t('staff.conductors.validation.citizenshipRequired') })}
            />
            <Input
              label={t('staff.conductors.phoneNumber')}
              required
              placeholder="98XXXXXXXX"
              maxLength={10}
              inputMode="numeric"
              error={errors.phone?.message}
              {...register('phone', {
                required: t('staff.conductors.validation.phoneRequired'),
                validate: (v) => isValidPhone(v) || PHONE_VALIDATION_MESSAGE,
                onChange: (e) => { e.target.value = sanitizePhoneDigits(e.target.value) },
              })}
            />
            <div className="sm:col-span-2 lg:col-span-3">
              <Input
                label={t('staff.conductors.address')}
                required
                placeholder="e.g. Kalanki, Kathmandu"
                error={errors.address?.message}
                {...register('address', { required: t('staff.conductors.validation.addressRequired') })}
              />
            </div>
            <Input
              label={t('staff.conductors.emergencyContact')}
              placeholder="e.g. Sita Adhikari"
              {...register('emergency_contact_name')}
            />
            <Input
              label={t('staff.conductors.emergencyPhone')}
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

          {/* Employment Information */}
          {currentStep === 1 && <>
          <Section icon={Briefcase} title={t('staff.conductors.employmentInfo')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Controller
              name="date_of_joining"
              control={control}
              render={({ field }) => (
                <NepaliDateInput label={t('staff.conductors.dateOfJoining')} value={field.value} onChange={field.onChange} />
              )}
            />
            <SelectField label={t('staff.conductors.employmentType')} {...register('employment_type')}>
              <option value="PERMANENT">{t('staff.conductors.types.PERMANENT')}</option>
              <option value="CONTRACT">{t('staff.conductors.types.CONTRACT')}</option>
              <option value="PART_TIME">{t('staff.conductors.types.PART_TIME')}</option>
            </SelectField>
            <SelectField label={t('staff.conductors.shift')} {...register('shift')}>
              <option value="">{t('staff.conductors.notAssignedOption')}</option>
              <option value="MORNING">{t('staff.conductors.shifts.MORNING')}</option>
              <option value="DAY">{t('staff.conductors.shifts.DAY')}</option>
              <option value="EVENING">{t('staff.conductors.shifts.EVENING')}</option>
              <option value="NIGHT">{t('staff.conductors.shifts.NIGHT')}</option>
            </SelectField>
            <SelectField label={t('staff.conductors.routeAssigned')} {...register('assigned_route_id')}>
              <option value="">{t('staff.conductors.notAssignedOption')}</option>
              {(routes as { id: string; route_code?: string; name_en?: string }[]).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.route_code ? `${r.route_code} — ` : ''}{r.name_en ?? r.id}
                </option>
              ))}
            </SelectField>
          </div>
          </>}

          {/* Bus Assignment */}
          {currentStep === 2 && <>
          <Section icon={Bus} title={t('staff.conductors.busAssignment')} />
          <SelectField label={t('staff.conductors.assignToBus')} {...register('assigned_vehicle_id')}>
            <option value="">{t('staff.conductors.notAssignedOption')}</option>
            {(vehicles as { id: string; registration_no?: string; make?: string; model?: string; vehicle_type?: string }[]).map((v) => (
              <option key={v.id} value={v.id}>
                {v.registration_no ?? v.id}
                {v.make ? ` — ${v.make} ${v.model ?? ''}` : ''}
                {v.vehicle_type ? ` (${v.vehicle_type})` : ''}
              </option>
            ))}
          </SelectField>
          </>}

          {/* Medical Information */}
          {currentStep === 3 && <>
          <Section icon={Heart} title={t('staff.conductors.medicalInfo')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField label={t('staff.conductors.bloodGroup')} {...register('blood_group')}>
              <option value="">{t('staff.conductors.unknownBloodGroup')}</option>
              {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((bg) => (
                <option key={bg} value={bg}>{bg}</option>
              ))}
            </SelectField>
          </div>
          </>}

          {/* Salary & Wages */}
          {currentStep === 4 && <>
          <Section icon={Wallet} title={t('staff.conductors.salaryWages')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              label={t('staff.conductors.basicSalary')}
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 20000"
              {...register('basic_salary')}
            />
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
                <Plus className="h-3 w-3" /> {t('staff.conductors.addAllowance')}
              </button>
            </div>
            {allowances.length === 0 && (
              <p className="text-xs text-gray-400 italic">{t('staff.conductors.noAllowances')}</p>
            )}
            {allowances.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={t('staff.conductors.allowanceTitle')}
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
                  placeholder={t('staff.conductors.allowanceAmount')}
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
                onClick={() => { setShowCreate(false); reset(); setAllowances([]); setPhotoFile(null); setCitizenshipPhotoFile(null); resetWizard() }}
              >
                {t('common:common.cancel')}
              </Button>
              {isLastStep ? (
                <Button type="submit" loading={createMutation.isPending} leftIcon={<Plus className="h-4 w-4" />}>
                  {t('staff.conductors.addConductor')}
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
