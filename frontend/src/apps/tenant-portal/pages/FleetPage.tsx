import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, AlertCircle, Bus, Hash, Gauge, Route, ShieldCheck, Eye, Pencil, Trash2, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge, statusVariant } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { NepaliDateInput } from '@components/shared/NepaliDateInput'
import { usePagination } from '@hooks/usePagination'
import fleetService, { Vehicle, VehicleCreatePayload, VehicleUpdatePayload } from '@services/fleetService'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { useForm, Controller } from 'react-hook-form'

// ─── Types ────────────────────────────────────────────────────────────────────
interface VehicleForm {
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
  const [editTarget, setEditTarget] = useState<Vehicle | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Vehicle | null>(null)
  // Edit form state
  const [editType, setEditType] = useState('')
  const [editStatus, setEditStatus] = useState('')
  const [editColor, setEditColor] = useState('')
  const [editSeated, setEditSeated] = useState('')
  const [editStanding, setEditStanding] = useState('')
  const [editFuel, setEditFuel] = useState('')
  const [editRouteId, setEditRouteId] = useState('')
  const [editInsurancePolicyNo, setEditInsurancePolicyNo] = useState('')
  const [editInsuranceExpiry, setEditInsuranceExpiry] = useState('')

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

  // Routes dropdown
  const { data: routes = [] } = useQuery({
    queryKey: ['routes-dropdown'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/routes/?page_size=200')
      return data.data?.results ?? data.data ?? []
    },
    staleTime: 5 * 60 * 1000,
  })

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<VehicleForm>({
    defaultValues: {
      vehicle_type: 'BUS',
      fuel_type: 'DIESEL',
    },
  })

  const createMutation = useMutation({
    mutationFn: (form: VehicleForm) => {
      const payload: VehicleCreatePayload = {
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
      qc.invalidateQueries({ queryKey: ['vehicles'] })
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
        toast.error(res?.message || (err as Error).message || 'Failed to add vehicle')
      }
    },
  })

  // Sync editTarget → edit form fields
  useEffect(() => {
    if (!editTarget) return
    setEditType(editTarget.vehicle_type)
    setEditStatus(editTarget.status)
    setEditColor(editTarget.color ?? '')
    setEditSeated(String(editTarget.capacity_seated))
    setEditStanding(String(editTarget.capacity_standing ?? 0))
    setEditFuel(editTarget.fuel_type)
    setEditRouteId(editTarget.assigned_route_id ?? '')
    // Pre-fill insurance from existing documents
    const insDoc = editTarget.documents?.find((d) => d.doc_type === 'INSURANCE')
    setEditInsurancePolicyNo(insDoc?.doc_no ?? '')
    setEditInsuranceExpiry(insDoc?.expiry_date ?? '')
  }, [editTarget])

  const updateVehicleMutation = useMutation({
    mutationFn: (id: string) => {
      const payload: VehicleUpdatePayload = {
        vehicle_type: editType as Vehicle['vehicle_type'],
        status: editStatus as Vehicle['status'],
        color: editColor,
        capacity_seated: Number(editSeated),
        capacity_standing: Number(editStanding),
        fuel_type: editFuel as Vehicle['fuel_type'],
        assigned_route_id: editRouteId || null,
      }
      if (editInsurancePolicyNo && editInsuranceExpiry) {
        payload.insurance_policy_no = editInsurancePolicyNo
        payload.insurance_expiry_date = editInsuranceExpiry
      }
      return fleetService.vehicles.update(id, payload)
    },
    onSuccess: () => {
      toast.success('Vehicle updated.')
      setEditTarget(null)
      qc.invalidateQueries({ queryKey: ['vehicles'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || (err as Error).message || 'Failed to update vehicle')
    },
  })

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
            onClick={() => setViewTarget(v)}
            className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
          >
            <Eye className="h-3 w-3" /> {t('common.view')}
          </button>
          <button
            onClick={() => setEditTarget(v)}
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
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalCount={totalCount}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
        />
      </div>

      {/* ── View Vehicle Modal ───────────────────────────────────────────────── */}
      {viewTarget && (
        <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title={t('fleet.vehicleDetails')} size="md">
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('fleet.labels.registrationNo')}</p>
                <p className="font-mono font-bold text-gray-900">{viewTarget.registration_no}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('fleet.columns.type')}</p>
                <Badge variant="neutral">{t(`fleet.vehicleTypes.${viewTarget.vehicle_type}`, { defaultValue: viewTarget.vehicle_type?.replace('_', ' ') })}</Badge>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('fleet.labels.brandModel')}</p>
                <p className="text-sm font-semibold text-gray-800">{viewTarget.make} {viewTarget.model}</p>
                <p className="text-xs text-gray-500">{viewTarget.year} · {viewTarget.color || '—'}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('common.status')}</p>
                <Badge variant={viewTarget.status === 'ACTIVE' || viewTarget.status === 'AVAILABLE' ? 'success' : viewTarget.status === 'ASSIGNED' || viewTarget.status === 'IN_SERVICE' ? 'info' : 'warning'} dot>
                  {t(`fleet.statuses.${viewTarget.status}`, { defaultValue: viewTarget.status?.replace('_', ' ') })}
                </Badge>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('fleet.columns.capacity')}</p>
                <p className="text-sm text-gray-800">
                  {viewTarget.capacity_seated} {t('fleet.seated')}
                  {viewTarget.capacity_standing > 0 && <span className="text-gray-500"> +{viewTarget.capacity_standing} {t('fleet.standing')}</span>}
                </p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('fleet.fuelType')}</p>
                <p className="text-sm text-gray-800">{t(`fleet.fuelTypes.${viewTarget.fuel_type}`, { defaultValue: viewTarget.fuel_type })}</p>
              </div>
              {viewTarget.chassis_no && (
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="text-xs text-gray-400 mb-0.5">{t('fleet.labels.chassisNo')}</p>
                  <code className="text-xs text-gray-700">{viewTarget.chassis_no}</code>
                </div>
              )}
              {viewTarget.engine_no && (
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="text-xs text-gray-400 mb-0.5">{t('fleet.labels.engineNo')}</p>
                  <code className="text-xs text-gray-700">{viewTarget.engine_no}</code>
                </div>
              )}
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('fleet.labels.odometer')}</p>
                <p className="text-sm text-gray-800">{viewTarget.odometer_km?.toLocaleString() ?? '—'} km</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('fleet.labels.availableForTrip')}</p>
                <Badge variant={viewTarget.is_available_for_trip ? 'success' : 'warning'}>
                  {viewTarget.is_available_for_trip ? t('common.yes') : t('common.no')}
                </Badge>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="secondary" onClick={() => setViewTarget(null)}>{t('common.close')}</Button>
              <Button onClick={() => { setViewTarget(null); setEditTarget(viewTarget) }}>{t('fleet.editVehicle')}</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Edit Vehicle Modal ────────────────────────────────────────────────── */}
      {editTarget && (
        <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={t('fleet.editTitle', { reg: editTarget.registration_no })} size="md">
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('fleet.labels.vehicleType')}</label>
                <select value={editType} onChange={(e) => setEditType(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500">
                  <option value="BUS">{t('fleet.vehicleTypes.BUS')}</option>
                  <option value="MICROBUS">{t('fleet.vehicleTypes.MICROBUS')}</option>
                  <option value="MINIBUS">{t('fleet.vehicleTypes.MINIBUS')}</option>
                  <option value="TEMPO">{t('fleet.vehicleTypes.TEMPO')}</option>
                  <option value="ELECTRIC_BUS">{t('fleet.vehicleTypes.ELECTRIC_BUS')}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('common.status')}</label>
                <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500">
                  <option value="ACTIVE">{t('fleet.statuses.ACTIVE')}</option>
                  <option value="AVAILABLE">{t('fleet.statuses.AVAILABLE')}</option>
                  <option value="ASSIGNED">{t('fleet.statuses.ASSIGNED')}</option>
                  <option value="IN_SERVICE">{t('fleet.statuses.IN_SERVICE')}</option>
                  <option value="IN_MAINTENANCE">{t('fleet.statuses.IN_MAINTENANCE')}</option>
                  <option value="INACTIVE">{t('fleet.statuses.INACTIVE')}</option>
                  <option value="RETIRED">{t('fleet.statuses.RETIRED')}</option>
                  <option value="BREAKDOWN">{t('fleet.statuses.BREAKDOWN')}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('fleet.labels.color')}</label>
                <input value={editColor} onChange={(e) => setEditColor(e.target.value)}
                  placeholder="e.g. Red & White"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('fleet.fuelType')}</label>
                <select value={editFuel} onChange={(e) => setEditFuel(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500">
                  <option value="DIESEL">{t('fleet.fuelTypes.DIESEL')}</option>
                  <option value="PETROL">{t('fleet.fuelTypes.PETROL')}</option>
                  <option value="CNG">{t('fleet.fuelTypes.CNG')}</option>
                  <option value="ELECTRIC">{t('fleet.fuelTypes.ELECTRIC')}</option>
                  <option value="HYBRID">{t('fleet.fuelTypes.HYBRID')}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('fleet.labels.seatingCapacity')}</label>
                <input type="number" min={1} value={editSeated} onChange={(e) => setEditSeated(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('fleet.labels.standingCapacity')}</label>
                <input type="number" min={0} value={editStanding} onChange={(e) => setEditStanding(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('fleet.labels.assignedRoute')}</label>
                <select value={editRouteId} onChange={(e) => setEditRouteId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500">
                  <option value="">{t('fleet.notAssigned')}</option>
                  {(routes as { id: string; route_number?: string; name?: string; route_code?: string; name_en?: string }[]).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.route_code ?? r.route_number ?? ''}{(r.route_code ?? r.route_number) ? ' — ' : ''}{r.name_en ?? r.name ?? r.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── Insurance (controls "Available for Trip") ─────────────────── */}
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
              <div className="mb-3 flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
                <div>
                  <p className="text-xs font-semibold text-blue-700">{t('fleet.insuranceNote')}</p>
                  <p className="text-xs text-blue-600 mt-0.5">{t('fleet.insuranceDesc')}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">{t('fleet.labels.insurancePolicyNo')}</label>
                  <input
                    value={editInsurancePolicyNo}
                    onChange={(e) => setEditInsurancePolicyNo(e.target.value)}
                    placeholder="e.g. NIC/VH/2024/001234"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <NepaliDateInput
                    label={t('fleet.labels.insuranceExpiryDate')}
                    value={editInsuranceExpiry}
                    onChange={setEditInsuranceExpiry}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="secondary" onClick={() => setEditTarget(null)}>{t('common.cancel')}</Button>
              <Button
                loading={updateVehicleMutation.isPending}
                onClick={() => updateVehicleMutation.mutate(editTarget.id)}
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

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
        onClose={() => { setShowCreate(false); reset() }}
        title={t('fleet.addVehicle')}
        size="lg"
      >
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-6 p-6">

          {/* ── Basic Information ──────────────────────────────────────────── */}
          <Section icon={Bus} title={t('fleet.sections.basicInfo')} />
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2">
            <p className="text-xs text-blue-600">{t('fleet.busIdNote')}</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label={t('fleet.labels.busRegistrationNo')}
                required
                placeholder="e.g. Ba 1 Kha 2345"
                error={errors.registration_no?.message}
                {...register('registration_no', { required: 'Registration number is required' })}
              />
            </div>
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

          {/* ── Vehicle Identification ─────────────────────────────────────── */}
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

          {/* ── Capacity & Specifications ──────────────────────────────────── */}
          <Section icon={Gauge} title={t('fleet.sections.capacitySpecs')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

          {/* ── Operational Information ────────────────────────────────────── */}
          <Section icon={Route} title={t('fleet.sections.operational')} />
          <SelectField label={t('fleet.labels.routeAssigned')} {...register('assigned_route_id')}>
            <option value="">{t('fleet.notAssigned')}</option>
            {(routes as { id: string; route_number?: string; name?: string }[]).map((r) => (
              <option key={r.id} value={r.id}>
                {r.route_number ? `${r.route_number} — ` : ''}{r.name ?? r.id}
              </option>
            ))}
          </SelectField>

          {/* ── Insurance & Compliance ─────────────────────────────────────── */}
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

          {/* ── Actions ───────────────────────────────────────────────────── */}
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button
              variant="secondary"
              type="button"
              onClick={() => { setShowCreate(false); reset() }}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={createMutation.isPending} leftIcon={<Plus className="h-4 w-4" />}>
              {t('fleet.addVehicle')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
