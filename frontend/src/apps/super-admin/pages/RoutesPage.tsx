/**
 * RoutesPage (super-admin) — platform-wide oversight of every route and who
 * operates it. Read-only: route creation/geometry drawing stays where it
 * already lives, the tenant-portal's own Routes page. This page just
 * surfaces the route <-> tenant link (RouteAssignment) that nothing else
 * showed together in one place before.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MapPin, Ruler } from 'lucide-react'
import { Input } from '@components/shared/Input'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge, statusVariant } from '@components/shared/Badge'
import { usePagination } from '@hooks/usePagination'
import apiClient from '@services/api'

interface RouteOperator {
  tenant_id: string
  tenant_name: string
  schema_name: string
  status: string
  share_percentage: string
}

interface RouteRow {
  id: string
  route_code: string
  name_en: string
  name_ne: string
  distance_km: string
  route_type: 'EXCLUSIVE' | 'SHARED'
  status: string
  route_stops: unknown[]
  operators: RouteOperator[]
}

interface TenantOption {
  id: string
  name: string
}

const selectClass =
  'w-full rounded-lg border px-3 py-2 text-sm bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100 ' +
  'border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent'

export default function RoutesPage() {
  const [search, setSearch] = useState('')
  const [tenantFilter, setTenantFilter] = useState('')
  const [totalCount, setTotalCount] = useState(0)
  const pagination = usePagination(totalCount)

  const { data: tenants } = useQuery({
    queryKey: ['tenants-for-routes-filter'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/tenants/', { params: { page_size: 100 } })
      return (data.data ?? []) as TenantOption[]
    },
  })

  const { data: routes, isLoading } = useQuery({
    queryKey: ['routes-oversight', pagination.page, search, tenantFilter],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/routes/', {
        params: {
          ...pagination.queryParams,
          ...(search && { search }),
          ...(tenantFilter && { tenant: tenantFilter }),
        },
      })
      const list = Array.isArray(data.data) ? data.data : []
      setTotalCount(data.meta?.total_count ?? list.length)
      return list as RouteRow[]
    },
  })

  const columns: Column<RouteRow>[] = [
    {
      key: 'route_code', header: 'Code',
      render: (r) => <span className="font-mono font-bold text-primary-600">{r.route_code}</span>,
    },
    {
      key: 'name_en', header: 'Route Name',
      render: (r) => (
        <div>
          <p className="font-medium text-gray-900 dark:text-gray-100">{r.name_en}</p>
          {r.name_ne && <p className="text-xs text-gray-400">{r.name_ne}</p>}
        </div>
      ),
    },
    {
      key: 'route_type', header: 'Type',
      render: (r) => <Badge variant={r.route_type === 'SHARED' ? 'info' : 'neutral'}>{r.route_type}</Badge>,
    },
    {
      key: 'operators', header: 'Operator(s)',
      render: (r) => (
        r.operators.length === 0
          ? <span className="text-xs italic text-gray-400">Unassigned</span>
          : (
            <div className="flex flex-wrap gap-1">
              {r.operators.map((op) => (
                <span
                  key={op.tenant_id}
                  className={
                    op.status === 'ACTIVE'
                      ? 'rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                      : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-400 line-through dark:bg-gray-800'
                  }
                  title={`${op.status} · ${op.share_percentage}% share`}
                >
                  {op.tenant_name}
                </span>
              ))}
            </div>
          )
      ),
    },
    {
      key: 'route_stops', header: 'Stops',
      render: (r) => (
        <div className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
          <MapPin className="h-3.5 w-3.5 text-gray-400" />
          {r.route_stops?.length ?? 0}
        </div>
      ),
    },
    {
      key: 'distance_km', header: 'Distance',
      render: (r) => (
        <div className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
          <Ruler className="h-3.5 w-3.5 text-gray-400" />
          {r.distance_km} km
        </div>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: (r) => <Badge variant={statusVariant(r.status)} dot>{r.status}</Badge>,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Routes</h1>
          <p className="page-subtitle">Every route across every operator, and who runs it</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search by route code or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <select
          className={`${selectClass} max-w-xs`}
          value={tenantFilter}
          onChange={(e) => setTenantFilter(e.target.value)}
        >
          <option value="">All operators</option>
          {(tenants ?? []).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div className="card p-0">
        <Table
          columns={columns}
          data={routes ?? []}
          keyExtractor={(r) => r.id}
          loading={isLoading}
          emptyMessage="No routes found."
        />
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalCount={totalCount}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
        />
      </div>
    </div>
  )
}
