import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, AlertCircle, Bus, Hash, Gauge, Route, ShieldCheck, Eye, Pencil, Trash2, Info, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge, statusVariant } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { NepaliDateInput } from '@components/shared/NepaliDateInput'
import { DateDisplay } from '@components/shared/DateDisplay'
import { usePagination } from '@hooks/usePagination'
import fleetService, { Vehicle, VehicleCreatePayload, VehicleUpdatePayload } from '@services/fleetService'
import vehicleCategoryService from '@services/vehicleCategoryService'
import ownerService from '@services/ownerService'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { useForm, Controller } from 'react-hook-form'
import { cn } from '@utils/cn'

// ─── Types ────────────────────────────────────────────────────────────────────
interface VehicleForm {
  // Category
  category: string
  // Owner
  owner: string
  // Basic
  registration_no: string
  vehicle_type: string
  make: string
  model: string
  year: string
  color: string
  // Identification
  chassis_no: string
  engine_no: string
  // Capacity & Specs
  capacity_seated: string
  capacity_standing: string
  fuel_type: string
  engine_capacity_cc: string
  // Operational
  assigned_route_id: string
  // Insurance
  insurance_policy_no: string
  insurance_expiry_date: string
  // Fitness
  fitness_cert_no: string
  fitness_expiry_date: string
}

// The create form's only fields registered with a client-side `required`
// rule -- setError() is only safe to use for these (react-hook-form
// re-validates and clears them on the next handleSubmit() call). Every
// other field has no rule to re-run, so a manually-set error on one of
// them never clears and silently blocks all further submit attempts.
const FIELDS_WITH_CLIENT_RULES = new Set([
  'category', 'registration_no', 'vehicle_type', 'make', 'model',
  'year', 'chassis_no', 'capacity_seated', 'fuel_type',
])

// An owner who hasn't logged in and set their own password yet is still
// selectable (staff usually knows who owns a bus before that owner ever
// logs in) -- just flagged, so nobody assigns a bus expecting the owner
// to already have working access.
function ownerOptionLabel(o: { name: string; is_activated: boolean }, t: (k: string, o?: Record<string, unknown>) => string) {
  return o.is_activated ? o.name : `${o.name} (${t('fleet.ownerNotActivated', { defaultValue: 'Not activated' })})`
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
export default function FleetPage() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const pagination = usePagination(totalCount)

  // View / Edit / Delete state
  const [viewTarget, setViewTarget] = useState<Vehicle | null>(null)
  const [viewStep, setViewStep] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<Vehicle | null>(null)
  // Edit is a two-step flow, same shape as Drivers'/Collectors': pick a
  // section (editPickerTarget), then edit just that section's fields
  // (editTarget + editSection).
  const [editPickerTarget, setEditPickerTarget] = useState<Vehicle | null>(null)
  const [editTarget, setEditTarget] = useState<Vehicle | null>(null)
  const [editSection, setEditSection] = useState(0)
  // status/odometer are Operational-only, edit-time fields -- not part of
  // VehicleForm (Add doesn't collect them; a new vehicle defaults to ACTIVE
  // and 0 km) -- same "kept as its own piece of state" pattern DriversPage
  // uses for its own edit-only status field.
  const [editStatus, setEditStatus] = useState('')
  const [editOdometer, setEditOdometer] = useState('')
  const [editInsuranceFile, setEditInsuranceFile] = useState<File | null>(null)

  // Vehicle list
  const { data, isLoading } = useQuery({
    queryKey: ['vehicles', pagination.page, search],
    queryFn: async () => {
      const { data } = await apiClient.get('/fleet/vehicles/', {
        params: { ...pagination.queryParams, ...(search && { search }) },
      })
      setTotalCount(data.meta?.total_count ?? data.data?.count ?? 0)
      return data.data?.results ?? data.data ?? []
    },
  })

  // Category dropdown (RG-009 -- category is required on the vehicle form)
  const { data: categories = [] } = useQuery({
    queryKey: ['vehicle-categories'],
    queryFn: () => vehicleCategoryService.list(),
  })

  // Owner dropdown -- Team Implementation Guide §3.7
  const { data: owners = [] } = useQuery({
    queryKey: ['owners-dropdown'],
    queryFn: () => ownerService.list(),
  })

  // Routes dropdown
  const { data: routes = [] } = useQuery({
    queryKey: ['routes-dropdown'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/routes/?page_size=200')
      return data.data?.results ?? data.data ?? []
    },
    staleTime: 5 * 60 * 1000,
  })

  const { register, handleSubmit, reset, control, setError, trigger, formState: { errors } } = useForm<VehicleForm>({
    defaultValues: {
      vehicle_type: 'BUS',
      fuel_type: 'DIESEL',
    },
  })

  // Add Vehicle wizard: one section per step, same shape as Drivers'/
  // Collectors' Add wizard -- nothing is saved server-side until the final
  // step's real submit; currentStep/maxStepReached are purely client-side
  // navigation state.
  const [currentStep, setCurrentStep] = useState(0)
  const [maxStepReached, setMaxStepReached] = useState(0)
  const STEPS: { label: string; icon: React.ElementType; fields: (keyof VehicleForm)[] }[] = [
    { label: t('fleet.sections.basicInfo'), icon: Bus, fields: ['category', 'registration_no', 'vehicle_type', 'make', 'model', 'year'] },
    { label: t('fleet.sections.vehicleId'), icon: Hash, fields: ['chassis_no'] },
    { label: t('fleet.sections.capacitySpecs'), icon: Gauge, fields: ['capacity_seated', 'fuel_type'] },
    { label: t('fleet.sections.operational'), icon: Route, fields: [] },
    { label: t('fleet.sections.insurance'), icon: ShieldCheck, fields: [] },
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

  const createMutation = useMutation({
    mutationFn: (form: VehicleForm) => {
      const payload: VehicleCreatePayload = {
        category: form.category,
        owner: form.owner || undefined,
        registration_no: form.registration_no,
        vehicle_type: form.vehicle_type as Vehicle['vehicle_type'],
        make: form.make,
        model: form.model,
        year: Number(form.year),
        color: form.color,
        chassis_no: form.chassis_no,
        engine_no: form.engine_no,
        capacity_seated: Number(form.capacity_seated),
        capacity_standing: Number(form.capacity_standing) || 0,
        fuel_type: form.fuel_type as Vehicle['fuel_type'],
        engine_capacity_cc: form.engine_capacity_cc ? Number(form.engine_capacity_cc) : undefined,
        assigned_route_id: form.assigned_route_id || undefined,
        insurance_policy_no: form.insurance_policy_no || undefined,
        insurance_expiry_date: form.insurance_expiry_date || undefined,
        fitness_cert_no: form.fitness_cert_no || undefined,
        fitness_expiry_date: form.fitness_expiry_date || undefined,
      }
      return fleetService.vehicles.create(payload)
    },
    onSuccess: () => {
      toast.success('Vehicle added successfully!')
      setShowCreate(false)
      reset()
      resetWizard()
      qc.invalidateQueries({ queryKey: ['vehicles'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: Record<string, unknown> } }
      if (e?.response?.status === 403) return
      const res = e?.response?.data ?? {}
      // Prefer the { errors: {...} } shape used by hand-written views; fall back to
      // DRF ModelViewSet's default validation body, which puts field errors directly
      // at the top level (e.g. { registration_no: ["...already exists."] }) with no
      // wrapper at all -- that shape was previously falling through to a generic,
      // unhelpful message because only the wrapped shape was ever checked.
      const fieldErrors = (
        res.errors && typeof res.errors === 'object' ? res.errors : res
      ) as Record<string, unknown>
      const firstKey = Object.keys(fieldErrors).find(
        (k) => !['success', 'data', 'message', 'meta'].includes(k)
      )
      if (firstKey) {
        const val = fieldErrors[firstKey]
        const msg = Array.isArray(val) ? String(val[0]) : String(val)
        // Pokhara QA report: setError() on a field with no client-side
        // `rules`/`Controller rules` (e.g. assigned_route_id, insurance/
        // fitness fields) never gets re-validated/cleared by react-hook-
        // form on the next handleSubmit() call, permanently blocking
        // resubmission on the same open modal -- no further network
        // request, no visible disabled state, until the modal is closed
        // and reopened. Only set the inline field error for fields that
        // actually have a rule to re-run; every other key still gets the
        // toast (which is never at risk of getting stuck).
        if (FIELDS_WITH_CLIENT_RULES.has(firstKey)) {
          setError(firstKey as keyof VehicleForm, { type: 'server', message: msg })
        }
        toast.error(`${firstKey}: ${msg}`)
      } else {
        toast.error((res as { message?: string }).message || (err as Error).message || 'Failed to add vehicle')
      }
    },
  })

  // Separate form instance for editing -- seeded per-vehicle, per-section
  // from chooseEditSection() below, same as DriversPage/ConductorsPage.
  const editForm = useForm<VehicleForm>()

  // View tabs and Edit's section picker share the same 5 groupings as the
  // Add Vehicle wizard, so whatever a vehicle shows in View/Edit lines up
  // exactly with where it was entered at creation time.
  const VIEW_STEPS: { label: string; icon: React.ElementType }[] = [
    { label: t('fleet.sections.basicInfo'), icon: Bus },
    { label: t('fleet.sections.vehicleId'), icon: Hash },
    { label: t('fleet.sections.capacitySpecs'), icon: Gauge },
    { label: t('fleet.sections.operational'), icon: Route },
    { label: t('fleet.sections.insurance'), icon: ShieldCheck },
  ]
  const EDIT_SECTIONS: { label: string; icon: React.ElementType; fields: (keyof VehicleForm)[] }[] = [
    { label: t('fleet.sections.basicInfo'), icon: Bus, fields: ['category', 'owner', 'vehicle_type', 'make', 'model', 'year', 'color'] },
    { label: t('fleet.sections.vehicleId'), icon: Hash, fields: ['chassis_no', 'engine_no'] },
    { label: t('fleet.sections.capacitySpecs'), icon: Gauge, fields: ['capacity_seated', 'capacity_standing', 'fuel_type', 'engine_capacity_cc'] },
    { label: t('fleet.sections.operational'), icon: Route, fields: ['assigned_route_id'] },
    { label: t('fleet.sections.insurance'), icon: ShieldCheck, fields: ['insurance_policy_no', 'insurance_expiry_date', 'fitness_cert_no', 'fitness_expiry_date'] },
  ]

  const openEditPicker = (v: Vehicle) => setEditPickerTarget(v)
  const chooseEditSection = (index: number) => {
    if (!editPickerTarget) return
    const insDoc = editPickerTarget.documents?.find((d) => d.doc_type === 'INSURANCE')
    const fitDoc = editPickerTarget.documents?.find((d) => d.doc_type === 'FITNESS')
    setEditTarget(editPickerTarget)
    setEditSection(index)
    setEditStatus(editPickerTarget.status ?? '')
    setEditOdometer(String(editPickerTarget.odometer_km ?? 0))
    setEditInsuranceFile(null)
    editForm.reset({
      category: editPickerTarget.category ?? '',
      owner: editPickerTarget.owner ?? '',
      vehicle_type: editPickerTarget.vehicle_type,
      make: editPickerTarget.make ?? '',
      model: editPickerTarget.model ?? '',
      year: String(editPickerTarget.year ?? ''),
      color: editPickerTarget.color ?? '',
      chassis_no: editPickerTarget.chassis_no ?? '',
      engine_no: editPickerTarget.engine_no ?? '',
      capacity_seated: String(editPickerTarget.capacity_seated ?? ''),
      capacity_standing: String(editPickerTarget.capacity_standing ?? 0),
      fuel_type: editPickerTarget.fuel_type,
      engine_capacity_cc: editPickerTarget.engine_capacity_cc != null ? String(editPickerTarget.engine_capacity_cc) : '',
      assigned_route_id: editPickerTarget.assigned_route_id ?? '',
      insurance_policy_no: insDoc?.doc_no ?? '',
      insurance_expiry_date: insDoc?.expiry_date ?? '',
      fitness_cert_no: fitDoc?.doc_no ?? '',
      fitness_expiry_date: fitDoc?.expiry_date ?? '',
      registration_no: '',
    })
    setEditPickerTarget(null)
  }
  const closeEdit = () => { setEditTarget(null); setEditInsuranceFile(null) }

  const updateVehicleMutation = useMutation({
    mutationFn: async (payload: VehicleUpdatePayload) => {
      const id = editTarget!.id
      const result = await fleetService.vehicles.update(id, payload)
      if (editSection === 4 && editInsuranceFile) {
        const insDoc = result.documents?.find((d) => d.doc_type === 'INSURANCE')
        if (insDoc) {
          await fleetService.attachDocumentFile(id, insDoc.id, editInsuranceFile)
        } else {
          toast.error('Set a policy number and expiry date before uploading the insurance document.')
        }
      }
      return result
    },
    onSuccess: () => {
      toast.success('Vehicle updated.')
      closeEdit()
      qc.invalidateQueries({ queryKey: ['vehicles'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || (err as Error).message || 'Failed to update vehicle')
    },
  })

  // Scoped to whichever section was chosen in the picker -- only that
  // section's fields go in the PATCH, matching DriversPage/ConductorsPage.
  const handleUpdate = (values: VehicleForm) => {
    let payload: VehicleUpdatePayload = {}
    if (editSection === 0) {
      payload = {
        category: values.category || null,
        owner: values.owner || null,
        vehicle_type: values.vehicle_type as Vehicle['vehicle_type'],
        make: values.make,
        model: values.model,
        year: Number(values.year),
        color: values.color,
      }
    } else if (editSection === 1) {
      payload = { chassis_no: values.chassis_no, engine_no: values.engine_no }
    } else if (editSection === 2) {
      payload = {
        capacity_seated: Number(values.capacity_seated),
        capacity_standing: Number(values.capacity_standing) || 0,
        fuel_type: values.fuel_type as Vehicle['fuel_type'],
        engine_capacity_cc: values.engine_capacity_cc ? Number(values.engine_capacity_cc) : undefined,
      }
    } else if (editSection === 3) {
      payload = {
        assigned_route_id: values.assigned_route_id || null,
        status: editStatus as Vehicle['status'],
        odometer_km: Number(editOdometer) || 0,
      }
    } else if (editSection === 4) {
      if (values.insurance_policy_no && values.insurance_expiry_date) {
        payload.insurance_policy_no = values.insurance_policy_no
        payload.insurance_expiry_date = values.insurance_expiry_date
      }
      if (values.fitness_cert_no && values.fitness_expiry_date) {
        payload.fitness_cert_no = values.fitness_cert_no
        payload.fitness_expiry_date = values.fitness_expiry_date
      }
    }
    updateVehicleMutation.mutate(payload)
  }

  const deleteVehicleMutation = useMutation({
    mutationFn: (id: string) => fleetService.vehicles.delete(id),
    onSuccess: () => {
      toast.success('Vehicle deleted.')
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['vehicles'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to delete vehicle')
    },
  })

  const columns: Column<Vehicle>[] = [
    {
      key: 'registration_no',
      header: t('fleet.columns.regNo'),
      render: (v) => (
        <span className="font-mono font-bold text-gray-900 dark:text-white">{v.registration_no}</span>
      ),
    },
    {
      key: 'vehicle_type',
      header: t('fleet.columns.type'),
      render: (v) => (
        <Badge variant="neutral">{t(`fleet.vehicleTypes.${v.vehicle_type}`, { defaultValue: v.vehicle_type?.replace('_', ' ') ?? '—' })}</Badge>
      ),
    },
    {
      key: 'category_code',
      header: t('fleet.columns.category', { defaultValue: 'Category' }),
      render: (v) => v.category_code ? (
        <Badge variant="neutral">{v.category_code}</Badge>
      ) : (
        <span className="text-xs text-gray-400">—</span>
      ),
    },
    {
      key: 'make',
      header: t('fleet.columns.brandModel'),
      render: (v) => (
        <div>
          <p className="font-medium text-gray-900">{v.make} {v.model}</p>
          <p className="text-xs text-gray-400">{v.year} · {v.color || '—'}</p>
        </div>
      ),
    },
    {
      key: 'capacity_seated',
      header: t('fleet.columns.capacity'),
      render: (v) => (
        <div className="text-sm">
          <span>{v.capacity_seated} {t('fleet.seated')}</span>
          {v.capacity_standing > 0 && (
            <span className="ml-1 text-gray-400">+{v.capacity_standing} {t('fleet.standing')}</span>
          )}
        </div>
      ),
    },
    { key: 'fuel_type', header: t('fleet.columns.fuel'), render: (v) => <span>{t(`fleet.fuelTypes.${v.fuel_type}`, { defaultValue: v.fuel_type })}</span> },
    {
      key: 'status',
      header: t('common.status'),
      render: (v) => <Badge variant={statusVariant(v.status)} dot>{t(`fleet.statuses.${v.status}`, { defaultValue: v.status?.replace('_', ' ') })}</Badge>,
    },
    {
      key: 'is_available_for_trip',
      header: t('fleet.columns.available'),
      render: (v) => v.is_available_for_trip ? (
        <Badge variant="success">{t('common.yes')}</Badge>
      ) : (
        <span
          className="flex items-center gap-1 group relative cursor-default w-fit"
          title="Available = Status is ACTIVE + valid insurance document on file"
        >
          <Badge variant="warning">
            <AlertCircle className="mr-1 h-3 w-3" />
            {t('common.no')}
          </Badge>
          <Info className="h-3 w-3 text-gray-400 group-hover:text-gray-600" />
        </span>
      ),
    },
    {
      key: 'id',
      header: t('common.actions'),
      render: (v) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setViewTarget(v); setViewStep(0) }}
            className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
          >
            <Eye className="h-3 w-3" /> {t('common.view')}
          </button>
          <button
            onClick={() => openEditPicker(v)}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
          >
            <Pencil className="h-3 w-3" /> {t('common.edit')}
          </button>
          <button
            onClick={() => setDeleteTarget(v)}
            className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
          >
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
          <h1 className="page-title">{t('fleet.title')}</h1>
          <p className="page-subtitle">{t('fleet.subtitle')}</p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
          {t('fleet.addVehicle')}
        </Button>
      </div>

      <Input
        placeholder={t('fleet.searchPlaceholder')}
        leftAddon={<Search className="h-4 w-4" />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="card p-0">
        <Table columns={columns} data={data ?? []} keyExtractor={(v) => v.id} loading={isLoading} />
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

      {/* ── View Vehicle Modal ───────────────────────────────────────────────── */}
      <Modal
        open={!!viewTarget}
        onClose={() => setViewTarget(null)}
        title={`${t('fleet.vehicleDetails')} — ${viewTarget?.registration_no ?? ''}`}
        size="full"
      >
        {viewTarget && (
          <div className="space-y-6 p-6">
            {/* Nothing to validate here -- every section is freely clickable,
                unlike the Add Vehicle wizard's gated steps. */}
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
                <DetailRow label={t('fleet.labels.registrationNo')} value={viewTarget.registration_no} />
                <DetailRow label={t('common.columns.busNumber', { defaultValue: 'Bus Number' })} value={viewTarget.bus_number} />
                <DetailRow label={t('fleet.labels.category', { defaultValue: 'Category' })} value={viewTarget.category_name ? `${viewTarget.category_code} — ${viewTarget.category_name}` : undefined} />
                <DetailRow label={t('fleet.labels.owner', { defaultValue: 'Owner' })} value={viewTarget.owner_display_name} />
                <DetailRow label={t('fleet.columns.type')} value={t(`fleet.vehicleTypes.${viewTarget.vehicle_type}`, { defaultValue: viewTarget.vehicle_type?.replace('_', ' ') })} />
                <DetailRow label={t('fleet.labels.manufacturer')} value={viewTarget.make} />
                <DetailRow label={t('fleet.labels.model')} value={viewTarget.model} />
                <DetailRow label={t('fleet.labels.yearOfManufacture')} value={viewTarget.year} />
                <DetailRow label={t('fleet.labels.color')} value={viewTarget.color} />
              </div>
            )}

            {viewStep === 1 && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <DetailRow label={t('fleet.labels.chassisVin')} value={viewTarget.chassis_no} />
                <DetailRow label={t('fleet.labels.engineNumber')} value={viewTarget.engine_no} />
              </div>
            )}

            {viewStep === 2 && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <DetailRow label={t('fleet.labels.seatingCapacity')} value={viewTarget.capacity_seated} />
                <DetailRow label={t('fleet.labels.standingCapacityOpt')} value={viewTarget.capacity_standing} />
                <DetailRow label={t('fleet.fuelType')} value={t(`fleet.fuelTypes.${viewTarget.fuel_type}`, { defaultValue: viewTarget.fuel_type })} />
                <DetailRow label={t('fleet.labels.engineCapacityCc')} value={viewTarget.engine_capacity_cc} />
              </div>
            )}

            {viewStep === 3 && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{t('common.status')}</span>
                  <Badge variant={viewTarget.status === 'ACTIVE' || viewTarget.status === 'AVAILABLE' ? 'success' : viewTarget.status === 'ASSIGNED' || viewTarget.status === 'IN_SERVICE' ? 'info' : 'warning'} dot>
                    {t(`fleet.statuses.${viewTarget.status}`, { defaultValue: viewTarget.status?.replace('_', ' ') })}
                  </Badge>
                </div>
                <DetailRow
                  label={t('fleet.labels.routeAssigned')}
                  value={(() => {
                    const r = (routes as { id: string; route_code?: string; name_en?: string }[]).find((r) => r.id === viewTarget.assigned_route_id)
                    return r ? `${r.route_code ? `${r.route_code} — ` : ''}${r.name_en ?? r.id}` : undefined
                  })()}
                />
                <DetailRow label={t('fleet.labels.odometer')} value={viewTarget.odometer_km != null ? `${viewTarget.odometer_km.toLocaleString()} km` : undefined} />
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{t('fleet.labels.availableForTrip')}</span>
                  <Badge variant={viewTarget.is_available_for_trip ? 'success' : 'warning'}>
                    {viewTarget.is_available_for_trip ? t('common.yes') : t('common.no')}
                  </Badge>
                </div>
              </div>
            )}

            {viewStep === 4 && (() => {
              const insDoc = viewTarget.documents?.find((d) => d.doc_type === 'INSURANCE')
              const fitDoc = viewTarget.documents?.find((d) => d.doc_type === 'FITNESS')
              return (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <DetailRow label={t('fleet.labels.insurancePolicyNo')} value={insDoc?.doc_no} />
                  <DetailRow label={t('fleet.labels.insuranceExpiryDate')} dateValue={insDoc?.expiry_date} />
                  <DetailRow label={t('fleet.labels.fitnessCertNo')} value={fitDoc?.doc_no} />
                  <DetailRow label={t('fleet.labels.fitnessExpiryDate')} dateValue={fitDoc?.expiry_date} />
                </div>
              )
            })()}

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="secondary" onClick={() => setViewTarget(null)}>{t('common.close')}</Button>
              <Button onClick={() => { setViewTarget(null); openEditPicker(viewTarget) }}>{t('fleet.editVehicle')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Edit: choose a section ────────────────────────────────────────── */}
      <Modal
        open={!!editPickerTarget}
        onClose={() => setEditPickerTarget(null)}
        title={t('fleet.editSectionPickerTitle', { defaultValue: 'What do you want to edit?' })}
        size="sm"
      >
        {editPickerTarget && (
          <div className="p-6 space-y-4">
            <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              <strong>{editPickerTarget.registration_no}</strong> · {editPickerTarget.make} {editPickerTarget.model}
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
              <Button variant="secondary" onClick={() => setEditPickerTarget(null)}>{t('common.cancel')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Edit: the chosen section's fields ─────────────────────────────── */}
      <Modal
        open={!!editTarget}
        onClose={closeEdit}
        title={`${t('fleet.editTitle', { reg: editTarget?.registration_no ?? '' })} — ${EDIT_SECTIONS[editSection].label}`}
        size="md"
      >
        {editTarget && (
          <form onSubmit={editForm.handleSubmit(handleUpdate)} className="space-y-4 p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                <strong>{editTarget.registration_no}</strong> · {editTarget.make} {editTarget.model}
              </p>
              <button
                type="button"
                onClick={() => { setEditPickerTarget(editTarget); setEditTarget(null) }}
                className="text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                {t('fleet.changeSection', { defaultValue: 'Change section' })}
              </button>
            </div>

            {editSection === 0 && <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Controller
                  name="category"
                  control={editForm.control}
                  render={({ field }) => (
                    <SelectField label={t('fleet.labels.category', { defaultValue: 'Category' })} {...field}>
                      <option value="">— No category —</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.code} — {c.name_en}</option>
                      ))}
                    </SelectField>
                  )}
                />
                <Controller
                  name="owner"
                  control={editForm.control}
                  render={({ field }) => (
                    <SelectField label={t('fleet.labels.owner', { defaultValue: 'Owner' })} {...field}>
                      <option value="">— No owner —</option>
                      {owners.map((o) => (
                        <option key={o.id} value={o.id}>{ownerOptionLabel(o, t)}</option>
                      ))}
                    </SelectField>
                  )}
                />
                <Controller
                  name="vehicle_type"
                  control={editForm.control}
                  render={({ field }) => (
                    <SelectField label={t('fleet.labels.vehicleType')} {...field}>
                      <option value="BUS">{t('fleet.vehicleTypes.BUS')}</option>
                      <option value="MICROBUS">{t('fleet.vehicleTypes.MICROBUS')}</option>
                      <option value="MINIBUS">{t('fleet.vehicleTypes.MINIBUS')}</option>
                      <option value="TEMPO">{t('fleet.vehicleTypes.TEMPO')}</option>
                      <option value="ELECTRIC_BUS">{t('fleet.vehicleTypes.ELECTRIC_BUS')}</option>
                    </SelectField>
                  )}
                />
                <Input label={t('fleet.labels.manufacturer')} {...editForm.register('make')} />
                <Input label={t('fleet.labels.model')} {...editForm.register('model')} />
                <Input label={t('fleet.labels.yearOfManufacture')} type="number" {...editForm.register('year')} />
                <Input label={t('fleet.labels.color')} {...editForm.register('color')} />
              </div>
            </>}

            {editSection === 1 && <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label={t('fleet.labels.chassisVin')} {...editForm.register('chassis_no')} />
                <Input label={t('fleet.labels.engineNumber')} {...editForm.register('engine_no')} />
              </div>
            </>}

            {editSection === 2 && <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label={t('fleet.labels.seatingCapacity')} type="number" min={1} {...editForm.register('capacity_seated')} />
                <Input label={t('fleet.labels.standingCapacityOpt')} type="number" min={0} {...editForm.register('capacity_standing')} />
                <Controller
                  name="fuel_type"
                  control={editForm.control}
                  render={({ field }) => (
                    <SelectField label={t('fleet.fuelType')} {...field}>
                      <option value="DIESEL">{t('fleet.fuelTypes.DIESEL')}</option>
                      <option value="PETROL">{t('fleet.fuelTypes.PETROL')}</option>
                      <option value="CNG">{t('fleet.fuelTypes.CNG')}</option>
                      <option value="ELECTRIC">{t('fleet.fuelTypes.ELECTRIC')}</option>
                      <option value="HYBRID">{t('fleet.fuelTypes.HYBRID')}</option>
                    </SelectField>
                  )}
                />
                <Input label={t('fleet.labels.engineCapacityCc')} type="number" min={0} {...editForm.register('engine_capacity_cc')} />
              </div>
            </>}

            {editSection === 3 && <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Controller
                  name="assigned_route_id"
                  control={editForm.control}
                  render={({ field }) => (
                    <SelectField label={t('fleet.labels.routeAssigned')} {...field}>
                      <option value="">{t('fleet.notAssigned')}</option>
                      {(routes as { id: string; route_code?: string; name_en?: string }[]).map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.route_code ? `${r.route_code} — ` : ''}{r.name_en ?? r.id}
                        </option>
                      ))}
                    </SelectField>
                  )}
                />
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{t('common.status')}</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="ACTIVE">{t('fleet.statuses.ACTIVE')}</option>
                    <option value="AVAILABLE">{t('fleet.statuses.AVAILABLE')}</option>
                    <option value="ASSIGNED">{t('fleet.statuses.ASSIGNED')}</option>
                    <option value="IN_SERVICE">{t('fleet.statuses.IN_SERVICE')}</option>
                    <option value="IN_MAINTENANCE">{t('fleet.statuses.IN_MAINTENANCE')}</option>
                    <option value="INACTIVE">{t('fleet.statuses.INACTIVE')}</option>
                    <option value="RETIRED">{t('fleet.statuses.RETIRED')}</option>
                    <option value="BREAKDOWN">{t('fleet.statuses.BREAKDOWN')}</option>
                    <option value="RESERVE">{t('fleet.statuses.RESERVE', { defaultValue: 'Reserve' })}</option>
                  </select>
                </div>
                <Input
                  label={t('fleet.labels.odometer')}
                  type="number"
                  min={0}
                  value={editOdometer}
                  onChange={(e) => setEditOdometer(e.target.value)}
                />
              </div>
            </>}

            {editSection === 4 && <>
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 space-y-3">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
                  <div>
                    <p className="text-xs font-semibold text-blue-700">{t('fleet.insuranceNote')}</p>
                    <p className="text-xs text-blue-600 mt-0.5">{t('fleet.insuranceDesc')}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input label={t('fleet.labels.insurancePolicyNo')} {...editForm.register('insurance_policy_no')} />
                  <Controller
                    name="insurance_expiry_date"
                    control={editForm.control}
                    render={({ field }) => (
                      <NepaliDateInput label={t('fleet.labels.insuranceExpiryDate')} value={field.value} onChange={field.onChange} />
                    )}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Insurance Document</label>
                  {editTarget.documents?.find((d) => d.doc_type === 'INSURANCE') ? (
                    <p className="mb-1 text-xs text-blue-600">
                      A document is already on file — choose a new file below to replace it.
                    </p>
                  ) : null}
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setEditInsuranceFile(e.target.files?.[0] ?? null)}
                    className="w-full text-xs text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-blue-700 hover:file:bg-blue-200"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label={t('fleet.labels.fitnessCertNo')} {...editForm.register('fitness_cert_no')} />
                <Controller
                  name="fitness_expiry_date"
                  control={editForm.control}
                  render={({ field }) => (
                    <NepaliDateInput label={t('fleet.labels.fitnessExpiryDate')} value={field.value} onChange={field.onChange} />
                  )}
                />
              </div>
            </>}

            <div className="flex justify-end gap-3 border-t pt-4">
              <Button type="button" variant="secondary" onClick={closeEdit}>{t('common.cancel')}</Button>
              <Button type="submit" loading={updateVehicleMutation.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Delete Vehicle Modal ──────────────────────────────────────────────── */}
      {deleteTarget && (
        <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t('fleet.deleteVehicle')} size="sm">
          <div className="p-5 space-y-4">
            <div className="rounded-xl border border-red-100 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-700 mb-1">{t('fleet.cannotUndo')}</p>
              <p className="text-sm text-red-600">
                {t('fleet.deleteDesc', { reg: deleteTarget.registration_no, make: deleteTarget.make, model: deleteTarget.model })}
              </p>
              {(deleteTarget.status === 'ASSIGNED' || deleteTarget.status === 'IN_SERVICE') && (
                <p className="mt-2 text-xs text-red-500">
                  {t('fleet.activeWarning', { status: t(`fleet.statuses.${deleteTarget.status}`, { defaultValue: deleteTarget.status.replace('_', ' ') }) })}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t('fleet.keepVehicle')}</Button>
              <Button
                variant="danger"
                loading={deleteVehicleMutation.isPending}
                onClick={() => deleteVehicleMutation.mutate(deleteTarget.id)}
              >
                {t('fleet.deleteVehicle')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Add Vehicle Modal ─────────────────────────────────────────────── */}
      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); reset(); resetWizard() }}
        title={t('fleet.addVehicle')}
        size="full"
      >
        <form
          onSubmit={handleSubmit((d) => createMutation.mutate(d))}
          noValidate
          onKeyDown={(e) => {
            // Same fix as Drivers'/Collectors' Add wizard: never let Enter
            // fall through to the browser's native "submit via GET to the
            // current URL" fallback, which would reload the page and
            // silently discard every step's data.
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

          {/* ── Basic Information ──────────────────────────────────────────── */}
          {currentStep === 0 && <>
          <Section icon={Bus} title={t('fleet.sections.basicInfo')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Controller
              name="category"
              control={control}
              rules={{ required: 'Category is required' }}
              render={({ field }) => (
                <SelectField label={t('fleet.labels.category', { defaultValue: 'Category' })} required error={errors.category?.message} {...field}>
                  <option value="">— Select category —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.code} — {c.name_en}</option>
                  ))}
                </SelectField>
              )}
            />
            <Controller
              name="owner"
              control={control}
              render={({ field }) => (
                <SelectField label={t('fleet.labels.owner', { defaultValue: 'Owner' })} {...field}>
                  <option value="">— No owner —</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>{ownerOptionLabel(o, t)}</option>
                  ))}
                </SelectField>
              )}
            />
            <Input
              label={t('fleet.labels.busRegistrationNo')}
              required
              placeholder="e.g. Ba 1 Kha 2345"
              error={errors.registration_no?.message}
              {...register('registration_no', { required: 'Registration number is required' })}
            />
            <Controller
              name="vehicle_type"
              control={control}
              rules={{ required: 'Vehicle type is required' }}
              render={({ field }) => (
                <SelectField label={t('fleet.labels.vehicleType')} required error={errors.vehicle_type?.message} {...field}>
                  <option value="BUS">{t('fleet.vehicleTypes.BUS')}</option>
                  <option value="MICROBUS">{t('fleet.vehicleTypes.MICROBUS')}</option>
                  <option value="MINIBUS">{t('fleet.vehicleTypes.MINIBUS')}</option>
                  <option value="TEMPO">{t('fleet.vehicleTypes.TEMPO')}</option>
                  <option value="ELECTRIC_BUS">{t('fleet.vehicleTypes.ELECTRIC_BUS')}</option>
                </SelectField>
              )}
            />
            <Input
              label={t('fleet.labels.manufacturer')}
              required
              placeholder="e.g. Tata, Ashok Leyland, Yutong"
              error={errors.make?.message}
              {...register('make', { required: 'Brand is required' })}
            />
            <Input
              label={t('fleet.labels.model')}
              required
              placeholder="e.g. LP 909, Viking, ZK6122HG"
              error={errors.model?.message}
              {...register('model', { required: 'Model is required' })}
            />
            <Input
              label={t('fleet.labels.yearOfManufacture')}
              type="number"
              required
              placeholder="e.g. 2020"
              min={1990}
              max={new Date().getFullYear() + 1}
              error={errors.year?.message}
              {...register('year', { required: 'Year is required' })}
            />
            <Input
              label={t('fleet.labels.color')}
              placeholder="e.g. Red & White"
              {...register('color')}
            />
          </div>
          </>}

          {/* ── Vehicle Identification ─────────────────────────────────────── */}
          {currentStep === 1 && <>
          <Section icon={Hash} title={t('fleet.sections.vehicleId')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t('fleet.labels.chassisVin')}
              required
              placeholder="e.g. MA1TA2BBYP1234567"
              error={errors.chassis_no?.message}
              {...register('chassis_no', { required: 'Chassis number is required' })}
            />
            <Input
              label={t('fleet.labels.engineNumber')}
              placeholder="e.g. 497SP50G08123456"
              {...register('engine_no')}
            />
          </div>
          </>}

          {/* ── Capacity & Specifications ──────────────────────────────────── */}
          {currentStep === 2 && <>
          <Section icon={Gauge} title={t('fleet.sections.capacitySpecs')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              label={t('fleet.labels.seatingCapacity')}
              type="number"
              required
              placeholder="e.g. 45"
              min={1}
              error={errors.capacity_seated?.message}
              {...register('capacity_seated', { required: 'Seating capacity is required' })}
            />
            <Input
              label={t('fleet.labels.standingCapacityOpt')}
              type="number"
              placeholder="e.g. 20"
              min={0}
              {...register('capacity_standing')}
            />
            <Controller
              name="fuel_type"
              control={control}
              rules={{ required: 'Fuel type is required' }}
              render={({ field }) => (
                <SelectField label={t('fleet.fuelType')} required error={errors.fuel_type?.message} {...field}>
                  <option value="DIESEL">{t('fleet.fuelTypes.DIESEL')}</option>
                  <option value="PETROL">{t('fleet.fuelTypes.PETROL')}</option>
                  <option value="CNG">{t('fleet.fuelTypes.CNG')}</option>
                  <option value="ELECTRIC">{t('fleet.fuelTypes.ELECTRIC')}</option>
                  <option value="HYBRID">{t('fleet.fuelTypes.HYBRID')}</option>
                </SelectField>
              )}
            />
            <Input
              label={t('fleet.labels.engineCapacityCc')}
              type="number"
              placeholder="e.g. 5700"
              min={0}
              {...register('engine_capacity_cc')}
            />
          </div>
          </>}

          {/* ── Operational Information ────────────────────────────────────── */}
          {currentStep === 3 && <>
          <Section icon={Route} title={t('fleet.sections.operational')} />
          <SelectField label={t('fleet.labels.routeAssigned')} {...register('assigned_route_id')}>
            <option value="">{t('fleet.notAssigned')}</option>
            {(routes as { id: string; route_code?: string; name_en?: string }[]).map((r) => (
              <option key={r.id} value={r.id}>
                {r.route_code ? `${r.route_code} — ` : ''}{r.name_en ?? r.id}
              </option>
            ))}
          </SelectField>
          </>}

          {/* ── Insurance & Compliance ─────────────────────────────────────── */}
          {currentStep === 4 && <>
          <Section icon={ShieldCheck} title={t('fleet.sections.insurance')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t('fleet.labels.insurancePolicyNo')}
              placeholder="e.g. NIC/VH/2024/001234"
              {...register('insurance_policy_no')}
            />
            <Controller
              name="insurance_expiry_date"
              control={control}
              render={({ field }) => (
                <NepaliDateInput
                  label={t('fleet.labels.insuranceExpiryDate')}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <Input
              label={t('fleet.labels.fitnessCertNo')}
              placeholder="e.g. FIT/2024/KTM/5678"
              {...register('fitness_cert_no')}
            />
            <Controller
              name="fitness_expiry_date"
              control={control}
              render={({ field }) => (
                <NepaliDateInput
                  label={t('fleet.labels.fitnessExpiryDate')}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
          </>}

          {/* ── Actions ───────────────────────────────────────────────────── */}
          <div className="flex justify-between gap-3 border-t pt-4">
            <div>
              {currentStep > 0 && (
                <Button variant="secondary" type="button" leftIcon={<ChevronLeft className="h-4 w-4" />} onClick={handleBack}>
                  {t('common.back', { defaultValue: 'Back' })}
                </Button>
              )}
            </div>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                type="button"
                onClick={() => { setShowCreate(false); reset(); resetWizard() }}
              >
                {t('common.cancel')}
              </Button>
              {isLastStep ? (
                <Button type="submit" loading={createMutation.isPending} leftIcon={<Plus className="h-4 w-4" />}>
                  {t('fleet.addVehicle')}
                </Button>
              ) : (
                <Button type="button" rightIcon={<ChevronRight className="h-4 w-4" />} onClick={handleNext}>
                  {t('common.next', { defaultValue: 'Next' })}
                </Button>
              )}
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
