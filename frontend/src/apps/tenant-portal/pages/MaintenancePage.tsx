import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Wrench, Eye, Car, CalendarDays, MapPin, Phone, Banknote, FileText, Hash, Clock } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { DateDisplay } from '@components/shared/DateDisplay'
import { usePagination } from '@hooks/usePagination'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'

interface MaintenanceRecord {
  id: string
  vehicle_id: string
  vehicle_registration: string
  service_type: string
  due_date: string
  status: string
  notes: string | null
  created_at: string
}

interface VehicleListItem {
  id: string
  registration_no: string
}

interface ScheduleForm {
  vehicle_id: string       // UUID sent to backend
  service_type: string     // PERIODIC | INSPECTION | REPAIR | EMERGENCY
  due_date: string         // backend field name
  service_center_name: string
  service_center_location: string
  service_center_contact: string
  cost: string
  notes: string
}

// Parses the structured notes block written by the Schedule form
// Format: "Service Center: X\nLocation: Y\nContact: Z\nTotal Cost: NPR N\n<free notes>"
// Also handles legacy "Estimated Cost: NPR" prefix for older records.
function parseNotes(raw: string | null) {
  if (!raw) return { serviceCenterName: '', location: '', contact: '', cost: '', freeNotes: '' }
  const lines = raw.split('\n')
  let serviceCenterName = '', location = '', contact = '', cost = ''
  const freeLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('Service Center: '))   { serviceCenterName = line.replace('Service Center: ', '');   continue }
    if (line.startsWith('Location: '))          { location = line.replace('Location: ', '');                  continue }
    if (line.startsWith('Contact: '))           { contact  = line.replace('Contact: ', '');                   continue }
    if (line.startsWith('Total Cost: NPR '))    { cost = line.replace('Total Cost: NPR ', '');                continue }
    if (line.startsWith('Estimated Cost: NPR '))  { cost = line.replace('Estimated Cost: NPR ', '');          continue } // legacy
    freeLines.push(line)
  }
  return { serviceCenterName, location, contact, cost, freeNotes: freeLines.join('\n').trim() }
}

const SERVICE_TYPE_LABELS: Record<string, string> = {
  PERIODIC:   'Routine / Periodic Service',
  REPAIR:     'Repair',
  INSPECTION: 'Inspection',
  EMERGENCY:  'Emergency',
}

export default function MaintenancePage() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<MaintenanceRecord | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const pagination = usePagination(totalCount)

  const { data, isLoading } = useQuery({
    queryKey: ['maintenance', pagination.page],
    queryFn: async () => {
      const { data } = await apiClient.get('/maintenance/schedules/', { params: pagination.queryParams })
      setTotalCount(data.meta?.total_count ?? 0)
      return Array.isArray(data.data) ? data.data : []
    },
  })

  // Fetch active vehicles for the registration number dropdown
  const { data: vehicles = [] } = useQuery<VehicleListItem[]>({
    queryKey: ['vehicles-dropdown'],
    queryFn: async () => {
      const { data } = await apiClient.get('/fleet/vehicles/', { params: { page_size: 200, status: 'ACTIVE' } })
      return (Array.isArray(data.data) ? data.data : (data.data?.results ?? [])) as VehicleListItem[]
    },
    staleTime: 5 * 60 * 1000,
  })

  const { register, handleSubmit, reset } = useForm<ScheduleForm>({
    defaultValues: { service_type: 'PERIODIC' },
  })

  const createMutation = useMutation({
    mutationFn: (payload: ScheduleForm) => {
      // Build an enriched notes block so service center info is stored
      const noteLines = [
        payload.service_center_name     && `Service Center: ${payload.service_center_name}`,
        payload.service_center_location && `Location: ${payload.service_center_location}`,
        payload.service_center_contact  && `Contact: ${payload.service_center_contact}`,
        payload.cost                    && `Total Cost: NPR ${payload.cost}`,
        payload.notes,
      ].filter(Boolean).join('\n')

      return apiClient.post('/maintenance/schedules/', {
        vehicle_id: payload.vehicle_id,
        service_type: payload.service_type,
        due_date: payload.due_date,
        notes: noteLines,
      }).then((r) => r.data)
    },
    onSuccess: () => {
      toast.success('Maintenance scheduled!')
      setShowCreate(false)
      reset()
      qc.invalidateQueries({ queryKey: ['maintenance'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const columns: Column<MaintenanceRecord>[] = [
    {
      key: 'vehicle_registration',
      header: 'Vehicle',
      render: (m) => (
        <span className="font-mono font-bold">
          {m.vehicle_registration || m.vehicle_id}
        </span>
      ),
    },
    {
      key: 'service_type',
      header: t('maintenance.maintenanceType'),
      render: (m) => <Badge variant="neutral">{m.service_type}</Badge>,
    },
    {
      key: 'due_date',
      header: 'Repair Date',
      render: (m) => <DateDisplay date={m.due_date} />,
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (m) => m.notes
        ? <span className="max-w-xs truncate text-sm text-gray-600">{m.notes}</span>
        : <span className="text-gray-300">—</span>,
    },
    {
      key: 'id',
      header: '',
      render: (m) => (
        <button
          onClick={() => setSelectedRecord(m)}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium
                     text-primary-600 hover:bg-primary-50 transition-colors"
        >
          <Eye className="h-3.5 w-3.5" />
          View
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('maintenance.title')}</h1>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
          {t('maintenance.scheduleService')}
        </Button>
      </div>

      <div className="card p-0">
        <Table columns={columns} data={data ?? []} keyExtractor={(m) => m.id} loading={isLoading} />
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalCount={totalCount}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
        />
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t('maintenance.scheduleService')} size="md">
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4 p-6">
          {/* Vehicle Registration Number — value is the vehicle UUID */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Vehicle Registration Number <span className="text-red-500">*</span>
            </label>
            <select
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                         focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              {...register('vehicle_id', { required: true })}
            >
              <option value="">— Select vehicle —</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registration_no}
                </option>
              ))}
            </select>
          </div>

          {/* Maintenance Type — values match backend ServiceType choices */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('maintenance.maintenanceType')}</label>
            <select
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                         focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              {...register('service_type')}
            >
              <option value="PERIODIC">Routine / Periodic Service</option>
              <option value="REPAIR">Repair</option>
              <option value="INSPECTION">Inspection</option>
              <option value="EMERGENCY">Emergency</option>
            </select>
          </div>

          {/* Repair Date */}
          <Input label="Repair Date" type="date" required {...register('due_date', { required: true })} />

          {/* Service Center Fields */}
          <Input
            label="Service Center Name"
            placeholder="e.g. Ratna Motors Service Centre"
            {...register('service_center_name')}
          />
          <Input
            label="Service Center Location"
            placeholder="e.g. Kalanki, Kathmandu"
            {...register('service_center_location')}
          />
          <Input
            label="Service Center Contact Number"
            type="tel"
            placeholder="e.g. 01-4XXXXXX"
            {...register('service_center_contact')}
          />

          {/* Total Cost */}
          <Input label="Total Cost (NPR)" type="number" step="0.01" {...register('cost')} />

          {/* Notes */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('maintenance.notes')}</label>
            <textarea
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              rows={3}
              {...register('notes')}
            />
          </div>

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending} leftIcon={<Wrench className="h-4 w-4" />}>
              Schedule
            </Button>
          </div>
        </form>
      </Modal>
      {/* ── Detail View Modal ──────────────────────────────────────────────── */}
      <Modal
        open={!!selectedRecord}
        onClose={() => setSelectedRecord(null)}
        title="Maintenance Details"
        size="md"
      >
        {selectedRecord && (() => {
          const parsed = parseNotes(selectedRecord.notes)
          return (
            <div className="divide-y divide-gray-100">

              {/* Core details */}
              <div className="grid grid-cols-2 gap-0 divide-x divide-gray-100">
                {/* Left column */}
                <div className="space-y-5 p-6">
                  <DetailRow icon={<Car className="h-4 w-4 text-primary-500" />} label="Vehicle">
                    <span className="font-mono font-bold text-gray-900">
                      {selectedRecord.vehicle_registration || selectedRecord.vehicle_id}
                    </span>
                  </DetailRow>

                  <DetailRow icon={<Wrench className="h-4 w-4 text-amber-500" />} label="Maintenance Type">
                    <Badge variant="neutral">
                      {SERVICE_TYPE_LABELS[selectedRecord.service_type] ?? selectedRecord.service_type}
                    </Badge>
                  </DetailRow>

                  <DetailRow icon={<CalendarDays className="h-4 w-4 text-blue-500" />} label="Repair Date">
                    <DateDisplay date={selectedRecord.due_date} />
                  </DetailRow>

                  <DetailRow icon={<Clock className="h-4 w-4 text-gray-400" />} label="Created On">
                    <span className="text-sm text-gray-600">
                      <DateDisplay date={selectedRecord.created_at} />
                    </span>
                  </DetailRow>

                  <DetailRow icon={<Hash className="h-4 w-4 text-gray-400" />} label="Record ID">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                      {selectedRecord.id.slice(0, 8)}…
                    </code>
                  </DetailRow>
                </div>

                {/* Right column — service center info */}
                <div className="space-y-5 p-6">
                  <DetailRow icon={<MapPin className="h-4 w-4 text-green-500" />} label="Service Center">
                    {parsed.serviceCenterName
                      ? <span className="font-medium text-gray-900">{parsed.serviceCenterName}</span>
                      : <span className="text-gray-400 italic">—</span>}
                  </DetailRow>

                  <DetailRow icon={<MapPin className="h-4 w-4 text-gray-400" />} label="Location">
                    {parsed.location
                      ? <span className="text-gray-700">{parsed.location}</span>
                      : <span className="text-gray-400 italic">—</span>}
                  </DetailRow>

                  <DetailRow icon={<Phone className="h-4 w-4 text-indigo-500" />} label="Contact Number">
                    {parsed.contact
                      ? <span className="text-gray-700">{parsed.contact}</span>
                      : <span className="text-gray-400 italic">—</span>}
                  </DetailRow>

                  <DetailRow icon={<Banknote className="h-4 w-4 text-emerald-500" />} label="Total Cost">
                    {parsed.cost
                      ? <span className="font-semibold text-emerald-700">NPR {Number(parsed.cost).toLocaleString()}</span>
                      : <span className="text-gray-400 italic">—</span>}
                  </DetailRow>
                </div>
              </div>

              {/* Notes */}
              {parsed.freeNotes && (
                <div className="px-6 py-4">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    <FileText className="h-3.5 w-3.5" /> Notes
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">
                    {parsed.freeNotes}
                  </p>
                </div>
              )}

              {/* Footer */}
              <div className="flex justify-end px-6 py-4">
                <Button variant="secondary" onClick={() => setSelectedRecord(null)}>Close</Button>
              </div>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}

// ── Small helper for the two-column detail rows ───────────────────────────────
function DetailRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {icon} {label}
      </p>
      <div className="pl-5">{children}</div>
    </div>
  )
}
