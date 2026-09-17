/**
 * VehicleGroupsPage — build groups of vehicles, the unit of assignment to a
 * route (Route/Group Rotation doc section 3.3/5.5). The live capability
 * profile and live eligible-route list are "the feature that makes the
 * category model understandable" per the doc -- shown as members are
 * added/removed, not just after saving.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Users2, Snowflake, X, CheckCircle2, XCircle, Gauge, UserCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Badge } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import apiClient from '@services/api'
import vehicleGroupService, { VehicleGroup } from '@services/vehicleGroupService'
import { Vehicle } from '@services/fleetService'
import toast from 'react-hot-toast'
import { useForm, Controller } from 'react-hook-form'

interface DriverOption { id: string; user_id: string | null; full_name_en: string }
interface ConductorOption { id: string; user_id: string | null; full_name_en: string }

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

const kindVariant: Record<string, 'info' | 'neutral' | 'warning'> = { ROTATING: 'info', FIXED: 'neutral', RESERVE: 'warning' }

interface GroupForm {
  code: string
  kind: VehicleGroup['kind']
  composition_mode: VehicleGroup['composition_mode']
}

export default function VehicleGroupsPage() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [manageTarget, setManageTarget] = useState<VehicleGroup | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<VehicleGroup | null>(null)
  const [pickerVehicleId, setPickerVehicleId] = useState('')
  const [pickerDriverUserId, setPickerDriverUserId] = useState('')
  const [pickerConductorUserId, setPickerConductorUserId] = useState('')
  const [dayType, setDayType] = useState('WEEKDAY')

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['vehicle-groups'],
    queryFn: () => vehicleGroupService.list(),
  })

  const { data: vehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ['vehicles-for-groups'],
    queryFn: async () => {
      const { data } = await apiClient.get('/fleet/vehicles/', { params: { page_size: 500 } })
      return data.data?.results ?? data.data ?? []
    },
    staleTime: 60_000,
  })

  const { data: balance } = useQuery({
    queryKey: ['route-balance', dayType],
    queryFn: () => vehicleGroupService.balance(dayType),
  })

  const { data: drivers = [] } = useQuery<DriverOption[]>({
    queryKey: ['drivers-for-groups'],
    queryFn: async () => {
      const { data } = await apiClient.get('/operator/drivers/', { params: { page_size: 500 } })
      return data.data?.results ?? data.data ?? []
    },
    staleTime: 60_000,
  })

  const { data: conductors = [] } = useQuery<ConductorOption[]>({
    queryKey: ['conductors-for-groups'],
    queryFn: async () => {
      const { data } = await apiClient.get('/operator/conductors/', { params: { page_size: 500 } })
      return data.data?.results ?? data.data ?? []
    },
    staleTime: 60_000,
  })

  const liveManageTarget = manageTarget ? groups.find((g) => g.id === manageTarget.id) ?? manageTarget : null

  const saveDepotMutation = useMutation({
    mutationFn: ({ groupId, home_latitude, home_longitude }: { groupId: string; home_latitude: string | null; home_longitude: string | null }) =>
      vehicleGroupService.update(groupId, { home_latitude, home_longitude }),
    onSuccess: () => {
      toast.success('Depot location saved.')
      qc.invalidateQueries({ queryKey: ['vehicle-groups'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to save depot location.')
    },
  })

  const { data: groupDrivers = [] } = useQuery({
    queryKey: ['group-drivers', liveManageTarget?.id],
    queryFn: () => vehicleGroupService.listDrivers(liveManageTarget!.id),
    enabled: !!liveManageTarget,
  })

  const { data: groupConductors = [] } = useQuery({
    queryKey: ['group-conductors', liveManageTarget?.id],
    queryFn: () => vehicleGroupService.listConductors(liveManageTarget!.id),
    enabled: !!liveManageTarget,
  })

  const { data: eligibility } = useQuery({
    queryKey: ['group-eligibility', liveManageTarget?.id, liveManageTarget?.members.length],
    queryFn: () => vehicleGroupService.eligibility(liveManageTarget!.id),
    enabled: !!liveManageTarget,
  })

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<GroupForm>({
    defaultValues: { kind: 'ROTATING', composition_mode: 'UNIFORM' },
  })

  const createMutation = useMutation({
    mutationFn: (payload: GroupForm) => vehicleGroupService.create(payload),
    onSuccess: (group) => {
      toast.success(`Group '${group.code}' created.`)
      qc.invalidateQueries({ queryKey: ['vehicle-groups'] })
      setShowCreate(false)
      reset()
      setManageTarget(group)
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to create group.')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => vehicleGroupService.delete(id),
    onSuccess: () => {
      toast.success('Group deleted.')
      qc.invalidateQueries({ queryKey: ['vehicle-groups'] })
      setDeleteTarget(null)
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to delete group.')
    },
  })

  const addMemberMutation = useMutation({
    mutationFn: ({ groupId, vehicleId }: { groupId: string; vehicleId: string }) => vehicleGroupService.addMember(groupId, vehicleId),
    onSuccess: () => {
      toast.success('Vehicle added to group.')
      qc.invalidateQueries({ queryKey: ['vehicle-groups'] })
      setPickerVehicleId('')
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { errors?: { vehicle?: string[] }; message?: string } } }
      const reason = e?.response?.data?.errors?.vehicle?.[0]
      toast.error(reason || e?.response?.data?.message || 'Failed to add vehicle -- it may violate a composition rule.')
    },
  })

  const removeMemberMutation = useMutation({
    mutationFn: ({ groupId, memberId }: { groupId: string; memberId: string }) => vehicleGroupService.removeMember(groupId, memberId),
    onSuccess: () => {
      toast.success('Vehicle removed from group.')
      qc.invalidateQueries({ queryKey: ['vehicle-groups'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to remove vehicle.')
    },
  })

  const addDriverMutation = useMutation({
    mutationFn: ({ groupId, driverUserId }: { groupId: string; driverUserId: string }) =>
      vehicleGroupService.addDriver(groupId, driverUserId),
    onSuccess: () => {
      toast.success('Driver assigned to group.')
      qc.invalidateQueries({ queryKey: ['group-drivers', liveManageTarget?.id] })
      setPickerDriverUserId('')
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { errors?: { driver_user_id?: string[] }; message?: string } } }
      toast.error(e?.response?.data?.errors?.driver_user_id?.[0] || e?.response?.data?.message || 'Failed to assign driver.')
    },
  })

  const removeDriverMutation = useMutation({
    mutationFn: ({ groupId, assignmentId }: { groupId: string; assignmentId: string }) =>
      vehicleGroupService.removeDriver(groupId, assignmentId),
    onSuccess: () => {
      toast.success('Driver removed from group.')
      qc.invalidateQueries({ queryKey: ['group-drivers', liveManageTarget?.id] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to remove driver.')
    },
  })

  const addConductorMutation = useMutation({
    mutationFn: ({ groupId, conductorUserId }: { groupId: string; conductorUserId: string }) =>
      vehicleGroupService.addConductor(groupId, conductorUserId),
    onSuccess: () => {
      toast.success('Conductor assigned to group.')
      qc.invalidateQueries({ queryKey: ['group-conductors', liveManageTarget?.id] })
      setPickerConductorUserId('')
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { errors?: { conductor_user_id?: string[] }; message?: string } } }
      toast.error(e?.response?.data?.errors?.conductor_user_id?.[0] || e?.response?.data?.message || 'Failed to assign conductor.')
    },
  })

  const removeConductorMutation = useMutation({
    mutationFn: ({ groupId, assignmentId }: { groupId: string; assignmentId: string }) =>
      vehicleGroupService.removeConductor(groupId, assignmentId),
    onSuccess: () => {
      toast.success('Conductor removed from group.')
      qc.invalidateQueries({ queryKey: ['group-conductors', liveManageTarget?.id] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to remove conductor.')
    },
  })

  const groupedVehicleIds = new Set(groups.flatMap((g) => g.members.filter((m) => !m.valid_to).map((m) => m.vehicle)))
  const availableVehicles = vehicles.filter((v) => !groupedVehicleIds.has(v.id))
  const assignedDriverUserIds = new Set(groupDrivers.filter((d) => !d.valid_to).map((d) => d.driver_user_id))
  const availableDrivers = drivers.filter((d) => d.user_id && !assignedDriverUserIds.has(d.user_id))
  const assignedConductorUserIds = new Set(groupConductors.filter((c) => !c.valid_to).map((c) => c.conductor_user_id))
  const availableConductors = conductors.filter((c) => c.user_id && !assignedConductorUserIds.has(c.user_id))

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2"><Users2 className="h-6 w-6 text-primary-600" /> Vehicle Groups</h1>
          <p className="page-subtitle">Groups of vehicles that move together -- the unit assigned to a route</p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>Add Group</Button>
      </div>

      {/* ── Balance check panel ─────────────────────────────────────────── */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700"><Gauge className="h-4 w-4 text-primary-600" /> Balance Check</h2>
          <select
            value={dayType} onChange={(e) => setDayType(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs"
          >
            <option value="WEEKDAY">Weekday</option>
            <option value="SATURDAY">Saturday</option>
            <option value="SUNDAY">Sunday</option>
            <option value="HOLIDAY">Holiday</option>
          </select>
        </div>
        {balance && (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-500">Total slots: <strong className="text-gray-800">{balance.total_slots}</strong></span>
              <span className="text-gray-500">Rotating groups: <strong className="text-gray-800">{balance.total_rotating_groups}</strong></span>
              <Badge variant={balance.status === 'Balanced' ? 'success' : 'warning'} dot>{balance.status}</Badge>
            </div>
            {balance.per_requirement.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-gray-100">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Requirement</th>
                      <th className="px-3 py-2 text-left">Slots needing it</th>
                      <th className="px-3 py-2 text-left">Eligible groups</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balance.per_requirement.map((r, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-2">{r.requirement}</td>
                        <td className="px-3 py-2">{r.slots_needing_it}</td>
                        <td className="px-3 py-2">{r.eligible_groups}</td>
                        <td className="px-3 py-2">
                          <Badge variant={r.status === 'Fine' ? 'success' : 'danger'}>{r.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Group cards ──────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="card flex items-center justify-center py-16 text-sm text-gray-400">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="card py-16 text-center text-sm text-gray-400">No groups yet -- add your first one to start assigning vehicles to routes.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <div key={g.id} className="card space-y-3 p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-primary-700">{g.code}</span>
                <Badge variant={kindVariant[g.kind]}>{g.kind}</Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Badge variant="neutral">{g.composition_mode}</Badge>
                <span>{g.members.filter((m) => !m.valid_to).length} vehicles</span>
                {g.capability_all_ac && <Snowflake className="h-3.5 w-3.5 text-blue-500" />}
              </div>
              <p className="text-xs text-gray-400">
                {g.capability_total_seats} total seats · {Object.entries(g.capability_categories).map(([c, n]) => `${c} ×${n}`).join(', ') || 'no members yet'}
              </p>
              <div className="flex gap-2 border-t border-gray-100 pt-3">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => setManageTarget(g)}>Manage</Button>
                <Button size="sm" variant="danger" onClick={() => setDeleteTarget(g)}>{t('common.delete')}</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Create modal ─────────────────────────────────────────────────── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Group" size="sm">
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4 p-6">
          <Input label="Code" placeholder="e.g. G-03" required error={errors.code?.message} {...register('code', { required: 'Required' })} />
          <Controller
            name="kind" control={control} rules={{ required: true }}
            render={({ field }) => (
              <SelectField label="Kind" required {...field}>
                <option value="ROTATING">Rotating</option>
                <option value="FIXED">Fixed</option>
                <option value="RESERVE">Reserve</option>
              </SelectField>
            )}
          />
          <Controller
            name="composition_mode" control={control} rules={{ required: true }}
            render={({ field }) => (
              <SelectField label="Composition Mode" required {...field}>
                <option value="UNIFORM">Uniform -- every member shares one category</option>
                <option value="MIXED">Mixed -- multiple categories allowed</option>
              </SelectField>
            )}
          />
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={createMutation.isPending}>Create & Add Vehicles</Button>
          </div>
        </form>
      </Modal>

      {/* ── Manage members modal ─────────────────────────────────────────── */}
      <Modal open={!!liveManageTarget} onClose={() => setManageTarget(null)} title={liveManageTarget ? `Manage ${liveManageTarget.code}` : ''} size="lg">
        {liveManageTarget && (
          <div className="grid grid-cols-2 gap-6 p-6">
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Add a vehicle</label>
                <div className="flex gap-2">
                  <select
                    value={pickerVehicleId} onChange={(e) => setPickerVehicleId(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">— Select vehicle —</option>
                    {availableVehicles.map((v) => (
                      <option key={v.id} value={v.id}>{v.registration_no} {v.category_code ? `(${v.category_code})` : '(no category)'}</option>
                    ))}
                  </select>
                  <Button
                    size="sm" disabled={!pickerVehicleId} loading={addMemberMutation.isPending}
                    onClick={() => addMemberMutation.mutate({ groupId: liveManageTarget.id, vehicleId: pickerVehicleId })}
                  >
                    Add
                  </Button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Members ({liveManageTarget.members.filter((m) => !m.valid_to).length})
                </label>
                <div className="space-y-1.5">
                  {liveManageTarget.members.filter((m) => !m.valid_to).map((m) => (
                    <div key={m.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
                      <span>{m.vehicle_detail.registration_no} <span className="text-xs text-gray-400">{m.vehicle_detail.category_code ?? 'no category'}</span></span>
                      <button
                        onClick={() => removeMemberMutation.mutate({ groupId: liveManageTarget.id, memberId: m.id })}
                        className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {liveManageTarget.members.filter((m) => !m.valid_to).length === 0 && (
                    <p className="py-4 text-center text-xs text-gray-400">No vehicles yet.</p>
                  )}
                </div>
              </div>

              <div className="rounded-xl bg-gray-50 p-3">
                <p className="mb-1 text-xs font-semibold text-gray-600">Capability profile</p>
                <p className="text-xs text-gray-500">
                  Min seats: {liveManageTarget.capability_min_seats} · Total seats: {liveManageTarget.capability_total_seats} ·{' '}
                  AC: {liveManageTarget.capability_ac_count}/{liveManageTarget.members.filter((m) => !m.valid_to).length}
                  {liveManageTarget.capability_permit_classes.length > 0 && ` · Permit: ${liveManageTarget.capability_permit_classes.join(', ')}`}
                </p>
              </div>

              <DepotLocationForm
                key={liveManageTarget.id}
                group={liveManageTarget}
                saving={saveDepotMutation.isPending}
                onSave={(home_latitude, home_longitude) =>
                  saveDepotMutation.mutate({ groupId: liveManageTarget.id, home_latitude, home_longitude })}
              />

              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <UserCheck className="h-3.5 w-3.5" /> Drivers
                </label>
                <div className="flex gap-2">
                  <select
                    value={pickerDriverUserId} onChange={(e) => setPickerDriverUserId(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">— Select driver —</option>
                    {availableDrivers.map((d) => <option key={d.id} value={d.user_id!}>{d.full_name_en}</option>)}
                  </select>
                  <Button
                    size="sm" disabled={!pickerDriverUserId} loading={addDriverMutation.isPending}
                    onClick={() => addDriverMutation.mutate({ groupId: liveManageTarget.id, driverUserId: pickerDriverUserId })}
                  >
                    Add
                  </Button>
                </div>
                <div className="mt-1.5 space-y-1.5">
                  {groupDrivers.filter((d) => !d.valid_to).map((d) => {
                    const driver = drivers.find((dr) => dr.user_id === d.driver_user_id)
                    return (
                      <div key={d.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
                        <span>{driver?.full_name_en ?? d.driver_user_id}</span>
                        <button
                          onClick={() => removeDriverMutation.mutate({ groupId: liveManageTarget.id, assignmentId: d.id })}
                          className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                  {groupDrivers.filter((d) => !d.valid_to).length === 0 && (
                    <p className="py-2 text-center text-xs text-gray-400">No driver assigned yet.</p>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <UserCheck className="h-3.5 w-3.5" /> Conductors
                </label>
                <div className="flex gap-2">
                  <select
                    value={pickerConductorUserId} onChange={(e) => setPickerConductorUserId(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">— Select conductor —</option>
                    {availableConductors.map((c) => <option key={c.id} value={c.user_id!}>{c.full_name_en}</option>)}
                  </select>
                  <Button
                    size="sm" disabled={!pickerConductorUserId} loading={addConductorMutation.isPending}
                    onClick={() => addConductorMutation.mutate({ groupId: liveManageTarget.id, conductorUserId: pickerConductorUserId })}
                  >
                    Add
                  </Button>
                </div>
                <div className="mt-1.5 space-y-1.5">
                  {groupConductors.filter((c) => !c.valid_to).map((c) => {
                    const conductor = conductors.find((co) => co.user_id === c.conductor_user_id)
                    return (
                      <div key={c.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
                        <span>{conductor?.full_name_en ?? c.conductor_user_id}</span>
                        <button
                          onClick={() => removeConductorMutation.mutate({ groupId: liveManageTarget.id, assignmentId: c.id })}
                          className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                  {groupConductors.filter((c) => !c.valid_to).length === 0 && (
                    <p className="py-2 text-center text-xs text-gray-400">No conductor assigned yet.</p>
                  )}
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Eligible for</label>
              <div className="space-y-1.5">
                {eligibility?.eligible.map((r) => (
                  <div key={r.route_id} className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {r.route_code} — {r.route_name}
                  </div>
                ))}
                {eligibility?.not_eligible.map((r) => (
                  <div key={r.route_id} className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                    <div className="flex items-center gap-2 font-medium"><XCircle className="h-3.5 w-3.5 shrink-0" /> {r.route_code} — {r.route_name}</div>
                    <ul className="ml-5 mt-1 list-disc space-y-0.5 text-red-500">
                      {r.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
                    </ul>
                  </div>
                ))}
                {eligibility && eligibility.eligible.length === 0 && eligibility.not_eligible.length === 0 && (
                  <p className="py-4 text-center text-xs text-gray-400">No approved routes to check against yet.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Delete modal ─────────────────────────────────────────────────── */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Group" size="sm">
        {deleteTarget && (
          <div className="p-5 space-y-4">
            <div className="rounded-xl border border-red-100 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-700 mb-1">This cannot be undone</p>
              <p className="text-sm text-red-600">Group '{deleteTarget.code}' will be permanently removed.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Keep Group</Button>
              <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate(deleteTarget.id)}>Delete Group</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function DepotLocationForm({
  group, saving, onSave,
}: {
  group: VehicleGroup
  saving: boolean
  onSave: (home_latitude: string | null, home_longitude: string | null) => void
}) {
  const [lat, setLat] = useState(group.home_latitude ?? '')
  const [lng, setLng] = useState(group.home_longitude ?? '')

  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
        Depot location <span className="font-normal normal-case text-gray-400">(optional -- feeds the rotation engine's depot-proximity preference)</span>
      </label>
      <div className="flex gap-2">
        <input
          type="number" step="any" placeholder="Latitude" value={lat}
          onChange={(e) => setLat(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          type="number" step="any" placeholder="Longitude" value={lng}
          onChange={(e) => setLng(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <Button size="sm" loading={saving} onClick={() => onSave(lat || null, lng || null)}>
          Save
        </Button>
      </div>
    </div>
  )
}
