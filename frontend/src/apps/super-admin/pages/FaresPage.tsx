/**
 * FaresPage (super-admin) — read-only, platform-wide view of every tenant's
 * fares, for oversight. Fares are tenant-managed now (reversed from the
 * earlier "platform-managed only" decision, per direct instruction) -- the
 * real Add/Edit/Delete/Bulk-Import/Generate-from-Formula UI lives on the
 * tenant-portal's own FaresPage.tsx, scoped to that tenant's own routes.
 * The backend (FareMatrixViewSet._can_write_route) rejects a platform-role
 * write outright regardless of what this page could send, so this has no
 * write UI at all, by design, not by omission.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Modal } from '@components/shared/Modal'
import { usePagination } from '@hooks/usePagination'
import apiClient from '@services/api'
import { useTranslation } from 'react-i18next'

interface RouteOption {
  id: string
  route_code: string
  name_en: string
}

interface TicketTypeOption {
  id: string
  code: string
  name_en: string
}

interface FareRow {
  id: string
  route: string | null
  zone_from: string
  zone_to: string
  ticket_type: string
  base_fare: string
  peak_fare: string
  student_fare: string
  senior_citizen_fare: string
  child_fare: string
  created_at: string
}

const selectClass =
  'w-full rounded-lg border px-3 py-2 text-sm bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100 ' +
  'border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent'

export default function FaresPage() {
  const { t } = useTranslation('platform')
  const [routeFilter, setRouteFilter] = useState('')
  const [viewTarget, setViewTarget] = useState<FareRow | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const pagination = usePagination(totalCount)

  const { data: routes } = useQuery({
    queryKey: ['routes-for-fares'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/routes/', { params: { page_size: 100 } })
      return (data.data ?? []) as RouteOption[]
    },
  })

  const { data: ticketTypes } = useQuery({
    queryKey: ['ticket-types-for-fares'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/ticket-types/', { params: { page_size: 100 } })
      return (data.data ?? []) as TicketTypeOption[]
    },
  })

  const routeById = useMemo(
    () => Object.fromEntries((routes ?? []).map((r) => [r.id, r])),
    [routes]
  )
  const ticketTypeById = useMemo(
    () => Object.fromEntries((ticketTypes ?? []).map((tt) => [tt.id, tt])),
    [ticketTypes]
  )

  const { data: fares, isLoading } = useQuery({
    queryKey: ['fare-matrix', pagination.page, routeFilter],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/fare-matrix/', {
        params: { ...pagination.queryParams, ...(routeFilter && { route: routeFilter }) },
      })
      setTotalCount(data.meta?.total_count ?? 0)
      return (data.data ?? []) as FareRow[]
    },
  })

  const columns: Column<FareRow>[] = [
    {
      key: 'route', header: 'Route',
      render: (r) => r.route ? (routeById[r.route]?.route_code ?? r.route) : <span className="text-gray-400">Flat / all routes</span>,
    },
    { key: 'zone_from', header: 'From', render: (r) => r.zone_from || <span className="text-gray-400">—</span> },
    { key: 'zone_to', header: 'To', render: (r) => r.zone_to || <span className="text-gray-400">—</span> },
    { key: 'ticket_type', header: 'Ticket Type', render: (r) => ticketTypeById[r.ticket_type]?.name_en ?? <span className="text-gray-400">—</span> },
    { key: 'base_fare', header: 'Fare', render: (r) => `Rs. ${r.base_fare}` },
    { key: 'peak_fare', header: 'Peak Fare', render: (r) => `Rs. ${r.peak_fare}` },
    {
      key: 'id', header: '',
      render: (r) => (
        <Button variant="ghost" size="sm" onClick={() => setViewTarget(r)} title="View">
          <Eye className="h-4 w-4 text-gray-500" />
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('routes.fareMatrix')}</h1>
          <p className="page-subtitle">Fares across every tenant, for oversight — set and maintained by each tenant themselves, view only</p>
        </div>
      </div>

      <select
        className={`${selectClass} max-w-xs`}
        value={routeFilter}
        onChange={(e) => setRouteFilter(e.target.value)}
      >
        <option value="">All routes</option>
        {(routes ?? []).map((r) => (
          <option key={r.id} value={r.id}>{r.route_code} — {r.name_en}</option>
        ))}
      </select>

      <div className="card p-0">
        <Table
          columns={columns}
          data={fares ?? []}
          keyExtractor={(r) => r.id}
          loading={isLoading}
          emptyMessage="No fares set up yet."
        />
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalCount={totalCount}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
        />
      </div>

      {/* View a fare (read-only) */}
      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title="Fare Details" size="sm">
        {viewTarget && (
          <div className="space-y-3 p-6 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Route</span><span className="font-medium">{viewTarget.route ? (routeById[viewTarget.route]?.route_code ?? viewTarget.route) : 'Flat / all routes'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">From</span><span className="font-medium">{viewTarget.zone_from || '—'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">To</span><span className="font-medium">{viewTarget.zone_to || '—'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Ticket Type</span><span className="font-medium">{ticketTypeById[viewTarget.ticket_type]?.name_en ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Fare</span><span className="font-medium">Rs. {viewTarget.base_fare}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Peak Fare</span><span className="font-medium">Rs. {viewTarget.peak_fare}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Student Fare</span><span className="font-medium">Rs. {viewTarget.student_fare}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Senior Citizen Fare</span><span className="font-medium">Rs. {viewTarget.senior_citizen_fare}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Child Fare</span><span className="font-medium">Rs. {viewTarget.child_fare}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Created</span><span className="font-medium">{new Date(viewTarget.created_at).toLocaleString()}</span></div>
            <div className="flex justify-end border-t pt-4">
              <Button variant="secondary" onClick={() => setViewTarget(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
