import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Building2, Bus, TrendingUp, Search, X, ChevronDown } from 'lucide-react'
import { StatCard } from '@components/shared/StatCard'
import { LiveMap, TenantVehicle } from '@components/domain/LiveMap'
import { Badge } from '@components/shared/Badge'
import apiClient from '@services/api'
import tenantService, { Tenant } from '@services/tenantService'
import { formatNPR } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'
import { cn } from '@utils/cn'

interface PlatformStats {
  total_tenants: number
  active_tenants: number
  total_trips_today: number
}

interface BillingSummary {
  monthly_revenue: string
  total_pending_amc: string
}

const VEHICLE_TYPE_COLORS: Record<string, string> = {
  BUS:          'bg-blue-100 text-blue-700',
  MICROBUS:     'bg-orange-100 text-orange-700',
  MINIBUS:      'bg-purple-100 text-purple-700',
  TEMPO:        'bg-green-100 text-green-700',
  ELECTRIC_BUS: 'bg-cyan-100 text-cyan-700',
}

const VEHICLE_TYPE_EMOJI: Record<string, string> = {
  BUS: '🚌', MICROBUS: '🚐', MINIBUS: '🚌', TEMPO: '🛺', ELECTRIC_BUS: '⚡',
}

export default function DashboardPage() {
  const { t } = useTranslation()
  const { language } = useUiStore()

  // Tenant search state
  const [tenantSearch, setTenantSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const { data: stats, isLoading } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: async () => {
      try {
        const { data } = await apiClient.get<{ data: PlatformStats }>('/platform/analytics/summary/')
        return data.data
      } catch {
        return null
      }
    },
    refetchInterval: 60 * 1000,
  })

  const { data: billingSummary } = useQuery({
    queryKey: ['billing-summary'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: BillingSummary }>('/billing/invoices/summary/')
      return data.data
    },
    refetchInterval: 5 * 60 * 1000,
  })

  // All tenants for search dropdown
  const { data: allTenants = [] } = useQuery({
    queryKey: ['tenants-search-dropdown'],
    queryFn: async () => (await tenantService.list({ page_size: 200, status: 'ACTIVE' })).tenants,
    staleTime: 5 * 60 * 1000,
  })

  // Fleet for selected tenant
  const { data: tenantFleet = [], isFetching: fleetLoading } = useQuery({
    queryKey: ['tenant-fleet', selectedTenant?.schema_name],
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: TenantVehicle[] }>(
        `/platform/tenants/${selectedTenant!.schema_name}/fleet/`
      )
      return data.data ?? []
    },
    enabled: !!selectedTenant,
  })

  const filteredTenants = allTenants.filter((t) =>
    t.name.toLowerCase().includes(tenantSearch.toLowerCase()) ||
    t.schema_name.toLowerCase().includes(tenantSearch.toLowerCase())
  )

  const handleSelectTenant = (tenant: Tenant) => {
    setSelectedTenant(tenant)
    setTenantSearch('')
    setDropdownOpen(false)
  }

  const clearTenant = () => {
    setSelectedTenant(null)
    setTenantSearch('')
  }

  // Group fleet by vehicle type
  const fleetByType = tenantFleet.reduce<Record<string, TenantVehicle[]>>((acc, v) => {
    const key = v.vehicle_type
    if (!acc[key]) acc[key] = []
    acc[key].push(v)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('nav.dashboard')}</h1>
          <p className="page-subtitle">Platform overview — Kathmandu Valley Bus Network</p>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Operators"
          value={isLoading ? '—' : `${stats?.active_tenants ?? 0}/${stats?.total_tenants ?? 0}`}
          icon={<Building2 className="h-6 w-6" />}
          trend={2}
        />
        <StatCard
          title="Today's Trips"
          value={isLoading ? '—' : (stats?.total_trips_today ?? 0).toLocaleString()}
          icon={<Bus className="h-6 w-6" />}
          trend={5}
        />
        <StatCard
          title="This Month's Revenue"
          value={billingSummary
            ? formatNPR(parseFloat(billingSummary.monthly_revenue), language as 'en' | 'ne')
            : '—'}
          icon={<TrendingUp className="h-6 w-6" />}
          colorClass="text-green-600"
        />
        <StatCard
          title="Total Pending AMC"
          value={billingSummary
            ? formatNPR(parseFloat(billingSummary.total_pending_amc), language as 'en' | 'ne')
            : '—'}
          icon={<TrendingUp className="h-6 w-6" />}
          colorClass="text-primary-600"
        />
      </div>

      {/* Live Fleet Map */}
      <div className="card">
        {/* Map header with tenant search */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Live Fleet Map — Kathmandu Valley
          </h2>

          {/* Tenant search combobox */}
          <div ref={searchRef} className="relative w-72">
            {selectedTenant ? (
              /* Selected state */
              <div className="flex items-center gap-2 rounded-xl border border-primary-300 bg-primary-50 px-3 py-2">
                <Building2 className="h-4 w-4 shrink-0 text-primary-600" />
                <span className="flex-1 text-sm font-medium text-primary-800 truncate">
                  {selectedTenant.name}
                </span>
                <button
                  onClick={clearTenant}
                  className="shrink-0 rounded-full p-0.5 text-primary-400 hover:bg-primary-100 hover:text-primary-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              /* Search input */
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search tenant to view fleet..."
                  value={tenantSearch}
                  onChange={(e) => { setTenantSearch(e.target.value); setDropdownOpen(true) }}
                  onFocus={() => setDropdownOpen(true)}
                  className="w-full rounded-xl border border-gray-300 bg-white py-2 pl-9 pr-4 text-sm
                             focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
                <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            )}

            {/* Dropdown */}
            {dropdownOpen && !selectedTenant && (
              <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-xl">
                {filteredTenants.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-gray-400">No tenants found</p>
                ) : (
                  <ul className="max-h-52 overflow-y-auto divide-y divide-gray-50 py-1">
                    {filteredTenants.map((tenant) => (
                      <li key={tenant.id}>
                        <button
                          type="button"
                          className="w-full px-4 py-2.5 text-left hover:bg-primary-50 transition-colors"
                          onClick={() => handleSelectTenant(tenant)}
                        >
                          <p className="text-sm font-medium text-gray-900">{tenant.name}</p>
                          <p className="text-xs text-gray-400">{tenant.schema_name}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Map */}
        <LiveMap
          height="460px"
          tenantSlug={selectedTenant?.schema_name}
          vehiclesMeta={tenantFleet}
        />

        {/* Fleet panel — shown when a tenant is selected */}
        {selectedTenant && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            {fleetLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-400 border-t-transparent" />
                Loading fleet for {selectedTenant.name}…
              </div>
            ) : tenantFleet.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No vehicles registered for this tenant.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-700">
                    {selectedTenant.name} — {tenantFleet.length} Vehicles
                  </p>
                  <div className="flex gap-2">
                    {Object.keys(fleetByType).map((type) => (
                      <span key={type} className={cn('rounded-full px-2 py-0.5 text-xs font-medium', VEHICLE_TYPE_COLORS[type] ?? 'bg-gray-100 text-gray-600')}>
                        {VEHICLE_TYPE_EMOJI[type]} {type.replace('_', ' ')} ({fleetByType[type].length})
                      </span>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {tenantFleet.map((vehicle) => (
                    <div
                      key={vehicle.id}
                      className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5"
                    >
                      <span className="text-xl leading-none mt-0.5">
                        {VEHICLE_TYPE_EMOJI[vehicle.vehicle_type] ?? '🚌'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {vehicle.registration_no}
                        </p>
                        {vehicle.route_code ? (
                          <p className="text-xs text-primary-600 font-medium">
                            Route {vehicle.route_code}
                          </p>
                        ) : (
                          <p className="text-xs text-gray-400 italic">No route assigned</p>
                        )}
                        <Badge
                          variant={vehicle.status === 'ACTIVE' ? 'success' : vehicle.status === 'IN_MAINTENANCE' ? 'warning' : 'neutral'}
                          className="mt-1"
                        >
                          {vehicle.status.replace('_', ' ')}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
