/**
 * RosterGridPage -- the P0 manual roster grid (doc section 5.7/15): groups
 * down the side, dates across the top, the route a group runs each day in
 * the cell. No drag-and-drop library is installed, so this is click-to-open
 * a detail modal rather than drag -- consistent with the rest of the app's
 * form-driven interaction style. "The roster grid is the product" per the
 * doc's own closing line, so filled cells, unassigned slots and conflicts
 * are all visible on one screen rather than split across tabs.
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Lock, Unlock, Send, Zap, Wrench, RotateCw, Sliders } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Badge } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import apiClient from '@services/api'
import rosterService, { Duty, RotationPolicy } from '@services/rosterService'
import vehicleGroupService, { VehicleGroup } from '@services/vehicleGroupService'
import { Vehicle } from '@services/fleetService'
import toast from 'react-hot-toast'

interface RouteOption { id: string; route_code: string; name_en: string }

function errMsg(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { message?: string; errors?: unknown } } }
  const errors = e?.response?.data?.errors
  const errText = Array.isArray(errors) ? errors[0] : undefined
  return errText || e?.response?.data?.message || fallback
}

export default function RosterGridPage() {
  const { periodId = '' } = useParams()
  const qc = useQueryClient()
  const [dutyTarget, setDutyTarget] = useState<Duty | null>(null)
  const [surgeDate, setSurgeDate] = useState('')
  const [surgeRoute, setSurgeRoute] = useState('')
  const [showPolicy, setShowPolicy] = useState(false)

  const { data: period } = useQuery({
    queryKey: ['roster-period', periodId],
    queryFn: () => rosterService.getPeriod(periodId),
    enabled: !!periodId,
  })

  const { data: duties = [] } = useQuery({
    queryKey: ['roster-duties', periodId],
    queryFn: () => rosterService.listDuties(periodId),
    enabled: !!periodId,
  })

  const { data: conflicts = [] } = useQuery({
    queryKey: ['roster-conflicts', periodId],
    queryFn: () => rosterService.conflicts(periodId),
    enabled: !!periodId,
  })

  const { data: groups = [] } = useQuery({
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

  const { data: routes = [] } = useQuery<RouteOption[]>({
    queryKey: ['routes-for-roster'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/routes/', { params: { page_size: 200 } })
      return data.data?.results ?? data.data ?? []
    },
  })

  const { data: policy } = useQuery({
    queryKey: ['rotation-policy'],
    queryFn: () => rosterService.getPolicy(),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['roster-duties', periodId] })
    qc.invalidateQueries({ queryKey: ['roster-conflicts', periodId] })
    qc.invalidateQueries({ queryKey: ['roster-period', periodId] })
  }

  const assignMutation = useMutation({
    mutationFn: ({ dutyId, group, reason }: { dutyId: string; group: string | null; reason?: string }) =>
      rosterService.assignDuty(periodId, dutyId, group, reason),
    onSuccess: (duty) => {
      toast.success('Duty updated.')
      invalidate()
      setDutyTarget(duty)
    },
    onError: (err: unknown) => toast.error(errMsg(err, 'Failed to update duty.')),
  })

  const lockMutation = useMutation({
    mutationFn: ({ dutyId, locked }: { dutyId: string; locked: boolean }) =>
      rosterService.setDutyLock(periodId, dutyId, locked),
    onSuccess: (duty) => { toast.success(duty.locked ? 'Duty locked.' : 'Duty unlocked.'); invalidate(); setDutyTarget(duty) },
    onError: (err: unknown) => toast.error(errMsg(err, 'Failed to update lock.')),
  })

  const substituteMutation = useMutation({
    mutationFn: (payload: { dutyId: string; outVehicle: string; inVehicle: string; reason: string }) =>
      rosterService.substituteVehicle(periodId, payload.dutyId, payload.outVehicle, payload.inVehicle, payload.reason),
    onSuccess: (duty) => { toast.success('Vehicle substituted.'); invalidate(); setDutyTarget(duty) },
    onError: (err: unknown) => toast.error(errMsg(err, 'Substitution failed.')),
  })

  const publishMutation = useMutation({
    mutationFn: () => rosterService.publishPeriod(periodId),
    onSuccess: () => { toast.success('Roster period published.'); invalidate() },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string; data?: { conflicts?: { message: string }[] } } } }
      const list = e?.response?.data?.data?.conflicts
      toast.error(list?.length ? `${list.length} conflict(s) remain. First: ${list[0].message}` : errMsg(err, 'Publish failed.'))
    },
  })

  const surgeMutation = useMutation({
    mutationFn: () => rosterService.surge(periodId, surgeDate, surgeRoute),
    onSuccess: () => { toast.success('Surge slot filled.'); invalidate(); setSurgeDate(''); setSurgeRoute('') },
    onError: (err: unknown) => toast.error(errMsg(err, 'No reserve group qualifies.')),
  })

  const rotateMutation = useMutation({
    mutationFn: () => rosterService.rotate(periodId),
    onSuccess: (result) => {
      const hard = result.conflicts.filter((c) => c.severity === 'hard').length
      const parts = [`${result.updated} duty(ies) auto-assigned.`]
      if (result.repaired) parts.push(`${result.repaired} conflict(s) repaired.`)
      if (hard) parts.push(`${hard} conflict(s) need a manual fix.`)
      toast.success(parts.join(' '))
      invalidate()
    },
    onError: (err: unknown) => toast.error(errMsg(err, 'Rotation failed.')),
  })

  const savePolicyMutation = useMutation({
    mutationFn: (payload: Partial<RotationPolicy>) => rosterService.savePolicy(payload),
    onSuccess: () => { toast.success('Rotation policy saved.'); qc.invalidateQueries({ queryKey: ['rotation-policy'] }) },
    onError: (err: unknown) => toast.error(errMsg(err, 'Failed to save policy.')),
  })

  const dates = useMemo(
    () => Array.from(new Set(duties.map((d) => d.service_date))).sort(),
    [duties]
  )
  const rosterGroups = useMemo(
    () => groups.filter((g) => g.kind !== 'RESERVE' && g.status === 'ACTIVE' && g.capability_total_seats > 0),
    [groups],
  )
  const cellMap = useMemo(() => {
    const m = new Map<string, Duty>()
    duties.forEach((d) => { if (d.group) m.set(`${d.group}|${d.service_date}`, d) })
    return m
  }, [duties])
  const unassigned = useMemo(() => duties.filter((d) => !d.group), [duties])

  const hardConflicts = conflicts.filter((c) => c.severity === 'hard')

  const groupById = (id: string | null) => groups.find((g) => g.id === id)
  const currentGroup = dutyTarget?.group ? groupById(dutyTarget.group) : null
  const currentMembers = currentGroup?.members.filter((m) => !m.valid_to) ?? []
  const assignableGroups = groups.filter((g) => g.kind !== 'RESERVE' || dutyTarget?.source === 'RESERVE_FILL')

  if (!period) return <div className="card flex items-center justify-center py-16 text-sm text-gray-400">Loading…</div>

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <Link to="/tenant/roster-periods" className="mb-1 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-3.5 w-3.5" /> All periods
          </Link>
          <h1 className="page-title">
            {new Date(period.start_date).toLocaleDateString()} — {new Date(period.end_date).toLocaleDateString()}
          </h1>
          <p className="page-subtitle flex items-center gap-2">
            <Badge variant={period.status === 'PUBLISHED' ? 'success' : period.status === 'DRAFT' ? 'info' : 'neutral'}>
              {period.status}
            </Badge>
            v{period.version}
          </p>
        </div>
        {period.status !== 'CLOSED' && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" leftIcon={<Sliders className="h-3.5 w-3.5" />} onClick={() => setShowPolicy(true)}>
              Rotation Policy
            </Button>
            <Button
              variant="secondary" leftIcon={<RotateCw className="h-4 w-4" />} loading={rotateMutation.isPending}
              onClick={() => rotateMutation.mutate()}
            >
              Auto-Rotate
            </Button>
            <Button
              leftIcon={<Send className="h-4 w-4" />} loading={publishMutation.isPending}
              disabled={hardConflicts.length > 0}
              onClick={() => publishMutation.mutate()}
            >
              {period.status === 'PUBLISHED' ? 'Republish' : 'Publish'}
            </Button>
          </div>
        )}
      </div>

      {/* Conflict panel */}
      {conflicts.length > 0 && (
        <div className="card p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Conflicts ({hardConflicts.length} blocking)
          </h2>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
            {conflicts.map((c, i) => (
              <li key={i} className={c.severity === 'hard' ? 'text-red-600' : 'text-amber-600'}>
                <Badge variant={c.severity === 'hard' ? 'danger' : 'warning'} className="mr-1.5">{c.severity}</Badge>
                {c.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Unassigned duties */}
      {unassigned.length > 0 && (
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Unassigned duties ({unassigned.length})</h2>
          <div className="flex flex-wrap gap-2">
            {unassigned.map((d) => (
              <button
                key={d.id}
                onClick={() => setDutyTarget(d)}
                className="rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:border-primary-400 hover:text-primary-700"
              >
                {new Date(d.service_date).toLocaleDateString()} · {d.route_code} · slot {d.slot_index}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="card overflow-x-auto p-0">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="sticky left-0 bg-gray-50 px-3 py-2 text-left font-medium text-gray-500">Group</th>
              {dates.map((date) => (
                <th key={date} className="px-3 py-2 text-left font-medium text-gray-500">
                  {new Date(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rosterGroups.map((g) => (
              <tr key={g.id} className="border-t border-gray-100">
                <td className="sticky left-0 bg-white px-3 py-2 font-mono font-medium text-primary-700">{g.code}</td>
                {dates.map((date) => {
                  const duty = cellMap.get(`${g.id}|${date}`)
                  return (
                    <td key={date} className="px-3 py-2">
                      {duty ? (
                        <button
                          onClick={() => setDutyTarget(duty)}
                          className={`flex items-center gap-1 rounded-lg px-2 py-1 ${
                            duty.source === 'OVERRIDE' ? 'bg-violet-50 text-violet-700'
                              : duty.source === 'GENERATED' ? 'bg-sky-50 text-sky-700'
                              : 'bg-emerald-50 text-emerald-700'
                          } hover:opacity-80`}
                        >
                          {duty.locked && <Lock className="h-3 w-3" />}
                          {duty.route_code}
                        </button>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rosterGroups.length === 0 && <p className="py-10 text-center text-xs text-gray-400">No rotating/fixed groups yet.</p>}
      </div>

      {/* Surge */}
      <div className="card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700"><Zap className="h-4 w-4 text-amber-500" /> Surge -- add an extra slot</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Date</label>
            <input
              type="date" value={surgeDate} onChange={(e) => setSurgeDate(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Route</label>
            <select
              value={surgeRoute} onChange={(e) => setSurgeRoute(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— Select route —</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.route_code} — {r.name_en}</option>)}
            </select>
          </div>
          <Button
            size="sm" disabled={!surgeDate || !surgeRoute} loading={surgeMutation.isPending}
            onClick={() => surgeMutation.mutate()}
          >
            Fill from Reserve
          </Button>
        </div>
      </div>

      {/* Duty detail modal */}
      <Modal
        open={!!dutyTarget}
        onClose={() => setDutyTarget(null)}
        title={dutyTarget ? `${dutyTarget.route_code} · ${new Date(dutyTarget.service_date).toLocaleDateString()} · slot ${dutyTarget.slot_index}` : ''}
        size="md"
      >
        {dutyTarget && (
          <DutyDetail
            periodId={periodId}
            duty={dutyTarget}
            groups={assignableGroups}
            members={currentMembers}
            vehicles={vehicles}
            policy={policy}
            published={period.status === 'PUBLISHED'}
            onAssign={(group, reason) => assignMutation.mutate({ dutyId: dutyTarget.id, group, reason })}
            onLock={(locked) => lockMutation.mutate({ dutyId: dutyTarget.id, locked })}
            onSubstitute={(outVehicle, inVehicle, reason) =>
              substituteMutation.mutate({ dutyId: dutyTarget.id, outVehicle, inVehicle, reason })}
            assigning={assignMutation.isPending}
            substituting={substituteMutation.isPending}
          />
        )}
      </Modal>

      {/* Rotation policy settings */}
      <Modal open={showPolicy} onClose={() => setShowPolicy(false)} title="Rotation Policy" size="sm">
        {policy && (
          <RotationPolicyForm
            policy={policy}
            saving={savePolicyMutation.isPending}
            onSave={(payload) => savePolicyMutation.mutate(payload)}
          />
        )}
      </Modal>
    </div>
  )
}

const COST_COMPONENT_LABELS: Record<string, string> = {
  rotation_preference: 'Rotation preference',
  route_cooldown: 'Route cooldown',
  consecutive_days: 'Consecutive days',
  fair_share: 'Fair share',
  depot_proximity: 'Depot proximity',
  crew_hours: 'Crew hours',
}

function explainComponent(key: string, value: number, policy: RotationPolicy | undefined): string {
  if (value === 0) {
    return {
      rotation_preference: 'Matched its predicted rotation slot',
      route_cooldown: 'No recent repeat of this route',
      consecutive_days: 'Not running this route on consecutive days',
      fair_share: 'Balanced share of routes so far',
      depot_proximity: "Starts near this group's depot",
      crew_hours: 'Within crew-hour limits',
    }[key] ?? String(value)
  }
  return {
    rotation_preference: `Off its predicted rotation slot (penalty ${value})`,
    route_cooldown: policy
      ? `Ran this route recently -- within the ${policy.route_cooldown_days}-day cooldown (penalty ${value})`
      : `Ran this route recently (penalty ${value})`,
    consecutive_days: `Running this route multiple days in a row (penalty ${value})`,
    fair_share: `Has had more of this route than other groups (penalty ${value})`,
    depot_proximity: `Starts far from this group's depot (penalty ${value})`,
    crew_hours: `Pushing crew-hour limits (penalty ${value})`,
  }[key] ?? String(value)
}

function DutyDetail({
  periodId, duty, groups, members, vehicles, policy, published, onAssign, onLock, onSubstitute, assigning, substituting,
}: {
  periodId: string
  duty: Duty
  groups: VehicleGroup[]
  members: { vehicle: string; vehicle_detail: { registration_no: string } }[]
  vehicles: Vehicle[]
  policy: RotationPolicy | undefined
  published: boolean
  onAssign: (group: string | null, reason?: string) => void
  onLock: (locked: boolean) => void
  onSubstitute: (outVehicle: string, inVehicle: string, reason: string) => void
  assigning: boolean
  substituting: boolean
}) {
  const [group, setGroup] = useState(duty.group ?? '')
  const [reason, setReason] = useState('')
  const [outVehicle, setOutVehicle] = useState('')
  const [inVehicle, setInVehicle] = useState('')
  const [subReason, setSubReason] = useState('')

  const { data: explanation } = useQuery({
    queryKey: ['duty-explain', periodId, duty.id],
    queryFn: () => rosterService.explainDuty(periodId, duty.id),
    enabled: duty.source === 'GENERATED',
  })

  return (
    <div className="space-y-5 p-6">
      {duty.overrides.length > 0 && (
        <div className="rounded-lg bg-violet-50 p-3 text-xs text-violet-700">
          {duty.overrides.length} override(s) recorded on this duty since it was published.
        </div>
      )}

      {explanation?.generated && explanation.components && (
        <div className="rounded-lg bg-sky-50 p-3 text-xs text-sky-800">
          <p className="mb-1.5 font-semibold">Why this assignment?</p>
          <ul className="space-y-0.5">
            {Object.entries(explanation.components).map(([key, value]) => (
              <li key={key}>
                {COST_COMPONENT_LABELS[key] ?? key}: {explainComponent(key, value as number, policy)}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-sky-600">Total cost: {explanation.total} (lower is preferred; 0 means a perfect fit)</p>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Assigned group</label>
        <div className="flex gap-2">
          <select
            value={group} onChange={(e) => setGroup(e.target.value)} disabled={duty.locked}
            className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-50"
          >
            <option value="">— Unassigned —</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.code} ({g.kind})</option>)}
          </select>
          <Button
            size="sm" disabled={duty.locked} loading={assigning}
            onClick={() => onAssign(group || null, reason || undefined)}
          >
            Save
          </Button>
        </div>
        {published && (
          <input
            value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required to change a published duty)"
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-xs"
          />
        )}
      </div>

      <Button
        size="sm" variant="outline" leftIcon={duty.locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
        onClick={() => onLock(!duty.locked)}
      >
        {duty.locked ? 'Unlock' : 'Lock'} this duty
      </Button>

      {duty.group && (
        <div className="border-t pt-4">
          <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <Wrench className="h-3.5 w-3.5" /> Substitute a vehicle
          </label>
          <div className="grid grid-cols-2 gap-2">
            <select value={outVehicle} onChange={(e) => setOutVehicle(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs">
              <option value="">— Out (current member) —</option>
              {members.map((m) => <option key={m.vehicle} value={m.vehicle}>{m.vehicle_detail.registration_no}</option>)}
            </select>
            <select value={inVehicle} onChange={(e) => setInVehicle(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs">
              <option value="">— In (replacement) —</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration_no}</option>)}
            </select>
          </div>
          <input
            value={subReason} onChange={(e) => setSubReason(e.target.value)}
            placeholder="Reason for substitution"
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-xs"
          />
          <Button
            size="sm" className="mt-2" disabled={!outVehicle || !inVehicle || !subReason} loading={substituting}
            onClick={() => onSubstitute(outVehicle, inVehicle, subReason)}
          >
            Substitute
          </Button>
          {duty.substitutions.length > 0 && (
            <p className="mt-2 text-xs text-gray-400">{duty.substitutions.length} substitution(s) recorded on this duty.</p>
          )}
        </div>
      )}
    </div>
  )
}

function RotationPolicyForm({
  policy, saving, onSave,
}: {
  policy: RotationPolicy
  saving: boolean
  onSave: (payload: Partial<RotationPolicy>) => void
}) {
  const [ringStep, setRingStep] = useState(policy.ring_step)
  const [weekPattern, setWeekPattern] = useState(policy.week_pattern)
  const [weekStep, setWeekStep] = useState(policy.week_step)
  const [lookbackWeeks, setLookbackWeeks] = useState(policy.same_weekday_lookback_weeks)
  const [cooldownDays, setCooldownDays] = useState(policy.route_cooldown_days)
  const [rotationPreferenceWeight, setRotationPreferenceWeight] = useState(policy.rotation_preference_weight)
  const [cooldownWeight, setCooldownWeight] = useState(policy.route_cooldown_weight)
  const [maxConsecutiveDays, setMaxConsecutiveDays] = useState(policy.max_consecutive_days_same_route)
  const [consecutiveWeight, setConsecutiveWeight] = useState(policy.consecutive_weight)
  const [fairShareWeight, setFairShareWeight] = useState(policy.fair_share_weight)
  const [depotProximityWeight, setDepotProximityWeight] = useState(policy.depot_proximity_weight)
  const [crewMaxHours, setCrewMaxHours] = useState(policy.crew_max_hours)
  const [crewHoursWeight, setCrewHoursWeight] = useState(policy.crew_hours_weight)

  useEffect(() => {
    setRingStep(policy.ring_step)
    setWeekPattern(policy.week_pattern)
    setWeekStep(policy.week_step)
    setLookbackWeeks(policy.same_weekday_lookback_weeks)
    setCooldownDays(policy.route_cooldown_days)
    setRotationPreferenceWeight(policy.rotation_preference_weight)
    setCooldownWeight(policy.route_cooldown_weight)
    setMaxConsecutiveDays(policy.max_consecutive_days_same_route)
    setConsecutiveWeight(policy.consecutive_weight)
    setFairShareWeight(policy.fair_share_weight)
    setDepotProximityWeight(policy.depot_proximity_weight)
    setCrewMaxHours(policy.crew_max_hours)
    setCrewHoursWeight(policy.crew_hours_weight)
  }, [policy])

  return (
    <div className="space-y-4 p-6">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">Ring step</label>
        <input
          type="number" min={1} value={ringStep} onChange={(e) => setRingStep(Number(e.target.value))}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-gray-400">How many ring positions every group advances per day. Must be coprime with the day's ring length, or some slots go unreached.</p>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">Week pattern</label>
        <select
          value={weekPattern} onChange={(e) => setWeekPattern(e.target.value as RotationPolicy['week_pattern'])}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="KEEP_ROTATING">Keep rotating -- never repeats</option>
          <option value="REPEAT_WEEK">Repeat the week -- every week identical</option>
          <option value="ROTATING_REPEAT">Rotating repeat -- same shape, nudges forward each week</option>
        </select>
      </div>
      {weekPattern === 'ROTATING_REPEAT' && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Week step</label>
          <input
            type="number" min={1} value={weekStep} onChange={(e) => setWeekStep(Number(e.target.value))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Same-weekday lookback (weeks)</label>
          <input
            type="number" min={1} value={lookbackWeeks} onChange={(e) => setLookbackWeeks(Number(e.target.value))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Route cooldown (days)</label>
          <input
            type="number" min={0} value={cooldownDays} onChange={(e) => setCooldownDays(Number(e.target.value))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="border-t pt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Cost weights -- 0 turns a rule off
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Rotation preference</label>
            <input
              type="number" min={0} value={rotationPreferenceWeight}
              onChange={(e) => setRotationPreferenceWeight(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Cooldown weight</label>
            <input
              type="number" min={0} value={cooldownWeight} onChange={(e) => setCooldownWeight(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Max consecutive days</label>
            <input
              type="number" min={1} value={maxConsecutiveDays} onChange={(e) => setMaxConsecutiveDays(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Consecutive weight</label>
            <input
              type="number" min={0} value={consecutiveWeight} onChange={(e) => setConsecutiveWeight(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Fair-share weight</label>
            <input
              type="number" min={0} value={fairShareWeight} onChange={(e) => setFairShareWeight(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Depot proximity weight</label>
            <input
              type="number" min={0} value={depotProximityWeight}
              onChange={(e) => setDepotProximityWeight(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Crew max hours/day</label>
            <input
              type="number" min={1} value={crewMaxHours}
              onChange={(e) => setCrewMaxHours(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Crew hours weight</label>
            <input
              type="number" min={0} value={crewHoursWeight}
              onChange={(e) => setCrewHoursWeight(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>
      <div className="flex justify-end border-t pt-4">
        <Button
          loading={saving}
          onClick={() => onSave({
            ring_step: ringStep, week_pattern: weekPattern, week_step: weekStep,
            same_weekday_lookback_weeks: lookbackWeeks, route_cooldown_days: cooldownDays,
            rotation_preference_weight: rotationPreferenceWeight, route_cooldown_weight: cooldownWeight,
            max_consecutive_days_same_route: maxConsecutiveDays, consecutive_weight: consecutiveWeight,
            fair_share_weight: fairShareWeight,
            depot_proximity_weight: depotProximityWeight,
            crew_max_hours: crewMaxHours,
            crew_hours_weight: crewHoursWeight,
          })}
        >
          Save Policy
        </Button>
      </div>
    </div>
  )
}
