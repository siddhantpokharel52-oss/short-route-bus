/**
 * MyEarningsPage — a bus owner's own dashboard, Team Implementation Guide
 * §3.7. Scoped strictly to the buses this owner holds (enforced server-side
 * by OwnerDashboardSummaryView/OwnerDashboardTrendView, IsOwner-gated) --
 * never another owner's earnings, never the tenant's whole fleet. Matches
 * TenantAnalyticsPage.tsx's exact visual stack (recharts, StatCard, the
 * same local Skeleton/ChartEmpty/MiniStat helpers) rather than inventing a
 * new style for one page.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { StatCard } from '@components/shared/StatCard'
import { Table, Column } from '@components/shared/Table'
import { Badge } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { DateDisplay } from '@components/shared/DateDisplay'
import { Button } from '@components/shared/Button'
import { Wallet, Bus, Banknote, CreditCard, TrendingUp, Eye, Hash, Gauge, Route as RouteIcon, ShieldCheck } from 'lucide-react'
import ownerService, {
  OwnerDashboardPerBus, OwnerDashboardRoute, OwnerDashboardTrendPoint,
} from '@services/ownerService'
import fleetService, { Vehicle } from '@services/fleetService'
import apiClient from '@services/api'
import { formatNPR } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'
import { cn } from '@utils/cn'

function fmtDate(iso: string) {
  const parts = iso.split('-')
  if (parts.length < 3) return iso
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-gray-100 ${className}`} />
}

function ChartEmpty({ height = 220, label }: { height?: number; label: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-400"
      style={{ height }}
    >
      {label}
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

function MiniStat({
  icon, label, value, color = 'text-gray-900',
}: { icon: React.ReactNode; label: string; value: string | number; color?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
      <div className="text-gray-400">{icon}</div>
      <div>
        <p className={`text-lg font-bold leading-none ${color}`}>{value}</p>
        <p className="mt-0.5 text-xs text-gray-500">{label}</p>
      </div>
    </div>
  )
}

export default function MyEarningsPage() {
  const { t } = useTranslation('tenant')
  const { language } = useUiStore()
  const [trendDays, setTrendDays] = useState(30)
  const [viewTarget, setViewTarget] = useState<Vehicle | null>(null)
  const [viewStep, setViewStep] = useState(0)
  const fmtMoney = (v: number) => formatNPR(v, language as 'en' | 'ne')

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['owner-dashboard-summary'],
    queryFn: () => ownerService.dashboardSummary(),
    staleTime: 30_000,
  })

  // Full vehicle records for this owner's own buses -- the earnings summary
  // above only ever carries {vehicle_id, bus_number, rides, revenue}, not
  // the actual vehicle (registration, category, insurance status, ...) an
  // owner would also want to check.
  const { data: myVehicles = [] } = useQuery({
    queryKey: ['owner-my-vehicles'],
    queryFn: () => fleetService.vehicles.myVehicles(),
    staleTime: 30_000,
  })

  const { data: routes = [] } = useQuery({
    queryKey: ['routes-for-owner-vehicle-view'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/routes/?page_size=200')
      return (data.data?.results ?? data.data ?? []) as { id: string; route_code?: string; name_en?: string }[]
    },
    staleTime: 5 * 60 * 1000,
  })

  const openVehicleView = (vehicleId: string) => {
    const vehicle = myVehicles.find((v) => v.id === vehicleId)
    if (!vehicle) return
    setViewTarget(vehicle)
    setViewStep(0)
  }

  const VIEW_STEPS: { label: string; icon: React.ElementType }[] = [
    { label: t('fleet.sections.basicInfo', { defaultValue: 'Basic Information' }), icon: Bus },
    { label: t('fleet.sections.vehicleId', { defaultValue: 'Vehicle Identification' }), icon: Hash },
    { label: t('fleet.sections.capacitySpecs', { defaultValue: 'Capacity & Specifications' }), icon: Gauge },
    { label: t('fleet.sections.operational', { defaultValue: 'Operational Information' }), icon: RouteIcon },
    { label: t('fleet.sections.insurance', { defaultValue: 'Insurance & Compliance' }), icon: ShieldCheck },
  ]

  const { data: trend = [], isLoading: trendLoading } = useQuery({
    queryKey: ['owner-dashboard-trend', trendDays],
    queryFn: () => ownerService.dashboardTrend(trendDays),
    staleTime: 30_000,
  })

  const hasTrend = trend.some((p: OwnerDashboardTrendPoint) => p.revenue > 0 || p.rides > 0)

  const perBusColumns: Column<OwnerDashboardPerBus>[] = [
    { key: 'bus_number', header: t('myEarnings.bus', { defaultValue: 'Bus' }), render: (b) => <span className="font-medium text-gray-900">{b.bus_number}</span> },
    { key: 'rides', header: t('myEarnings.rides', { defaultValue: 'Rides' }), render: (b) => b.rides },
    { key: 'revenue', header: t('myEarnings.revenue', { defaultValue: 'Revenue' }), render: (b) => fmtMoney(b.revenue) },
    {
      key: 'vehicle_id', header: '',
      render: (b) => (
        <button
          onClick={() => openVehicleView(b.vehicle_id)}
          className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
        >
          <Eye className="h-3 w-3" /> {t('common.view', { defaultValue: 'View' })}
        </button>
      ),
    },
  ]

  const routeColumns: Column<OwnerDashboardRoute>[] = [
    {
      key: 'route_code',
      header: t('myEarnings.route', { defaultValue: 'Route' }),
      render: (r) => (
        <span>
          <span className="font-mono font-medium text-gray-900">{r.route_code}</span>
          {r.route_name && <span className="ml-2 text-gray-500">{r.route_name}</span>}
        </span>
      ),
    },
    { key: 'revenue', header: t('myEarnings.revenue', { defaultValue: 'Revenue' }), render: (r) => fmtMoney(r.revenue) },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2"><Wallet className="h-6 w-6 text-primary-600" /> {t('myEarnings.title', { defaultValue: 'My Earnings' })}</h1>
          <p className="page-subtitle">
            {summary ? t('myEarnings.subtitleWithBuses', { defaultValue: '{{count}} bus(es) — {{name}}', count: summary.vehicle_count, name: summary.owner_name }) : t('myEarnings.subtitle', { defaultValue: 'Your buses, your earnings' })}
          </p>
        </div>
      </div>

      {/* ── Stat cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {summaryLoading
          ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)
          : (
            <>
              <StatCard
                title={t('myEarnings.today', { defaultValue: 'Today' })}
                value={fmtMoney(summary?.today.revenue ?? 0)}
                icon={<TrendingUp className="h-6 w-6" />}
                subtitle={t('myEarnings.ridesCount', { defaultValue: '{{count}} rides', count: summary?.today.rides ?? 0 })}
              />
              <StatCard
                title={t('myEarnings.thisWeek', { defaultValue: 'This Week' })}
                value={fmtMoney(summary?.this_week.revenue ?? 0)}
                icon={<TrendingUp className="h-6 w-6" />}
                subtitle={t('myEarnings.ridesCount', { defaultValue: '{{count}} rides', count: summary?.this_week.rides ?? 0 })}
              />
              <StatCard
                title={t('myEarnings.thisMonth', { defaultValue: 'This Month' })}
                value={fmtMoney(summary?.this_month.revenue ?? 0)}
                icon={<TrendingUp className="h-6 w-6" />}
                subtitle={t('myEarnings.ridesCount', { defaultValue: '{{count}} rides', count: summary?.this_month.rides ?? 0 })}
              />
              <StatCard
                title={t('myEarnings.buses', { defaultValue: 'Buses' })}
                value={summary?.vehicle_count ?? 0}
                icon={<Bus className="h-6 w-6" />}
                subtitle={t('myEarnings.inYourFleet', { defaultValue: 'in your fleet' })}
              />
            </>
          )}
      </div>

      {/* ── Cash vs online ────────────────────────────────────────────────── */}
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('myEarnings.cashVsOnline', { defaultValue: 'Cash vs. Online' })}</h3>
        {summaryLoading ? <Skeleton className="h-20" /> : (
          <div className="grid grid-cols-2 gap-3">
            <MiniStat
              icon={<Banknote className="h-5 w-5" />}
              label={t('myEarnings.cashCollected', { defaultValue: 'Cash Collected' })}
              value={fmtMoney(summary?.cash_collected ?? 0)}
              color="text-amber-700"
            />
            <MiniStat
              icon={<CreditCard className="h-5 w-5" />}
              label={t('myEarnings.onlineCollected', { defaultValue: 'Online Collected' })}
              value={fmtMoney(summary?.online_collected ?? 0)}
              color="text-blue-700"
            />
          </div>
        )}
        <p className="mt-3 text-xs text-gray-400">
          {t('myEarnings.settlementNote', { defaultValue: 'These are the amounts collected so far, not a settlement record -- how cash is transferred to you is being finalised separately.' })}
        </p>
      </div>

      {/* ── Trend ─────────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">{t('myEarnings.trend', { defaultValue: 'Rides & Revenue Trend' })}</h3>
          <div className="flex gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs">
            {([7, 14, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => setTrendDays(d)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  trendDays === d ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        {trendLoading
          ? <Skeleton className="h-56" />
          : !hasTrend
          ? <ChartEmpty height={220} label={t('myEarnings.noData', { defaultValue: 'No rides in this window yet' })} />
          : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gRides" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={fmtDate} interval={trendDays <= 7 ? 0 : 'preserveStartEnd'} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  labelFormatter={fmtDate}
                  formatter={(v: number, name: string) => [
                    name === 'revenue' ? fmtMoney(v) : v.toLocaleString(),
                    name === 'revenue' ? t('myEarnings.revenue', { defaultValue: 'Revenue' }) : t('myEarnings.rides', { defaultValue: 'Rides' }),
                  ]}
                />
                <Legend
                  formatter={(v) => (v === 'revenue' ? t('myEarnings.revenue', { defaultValue: 'Revenue' }) : t('myEarnings.rides', { defaultValue: 'Rides' }))}
                  iconType="circle"
                  iconSize={8}
                />
                <Area type="monotone" dataKey="rides" stroke="#2563eb" strokeWidth={2} fill="url(#gRides)" dot={false} activeDot={{ r: 4 }} />
                <Area type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} fill="url(#gRevenue)" dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
      </div>

      {/* ── Per-bus breakdown ─────────────────────────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        <div className="border-b border-gray-100 px-5 py-3">
          <p className="text-sm font-semibold text-gray-700">{t('myEarnings.perBus', { defaultValue: 'Per-Bus Breakdown' })}</p>
        </div>
        <Table columns={perBusColumns} data={summary?.per_bus ?? []} keyExtractor={(b) => b.vehicle_id} loading={summaryLoading} emptyMessage={t('myEarnings.noBuses', { defaultValue: 'No buses assigned to you yet.' })} />
      </div>

      {/* ── Revenue by route ──────────────────────────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        <div className="border-b border-gray-100 px-5 py-3">
          <p className="text-sm font-semibold text-gray-700">{t('myEarnings.revenueByRoute', { defaultValue: 'Revenue by Route' })}</p>
        </div>
        <Table columns={routeColumns} data={summary?.revenue_by_route ?? []} keyExtractor={(r) => r.route_id} loading={summaryLoading} emptyMessage={t('myEarnings.noRouteData', { defaultValue: 'No route data yet.' })} />
      </div>

      {/* ── Vehicle detail (read-only) ───────────────────────────────────── */}
      <Modal
        open={!!viewTarget}
        onClose={() => setViewTarget(null)}
        title={`${t('fleet.vehicleDetails', { defaultValue: 'Vehicle Details' })} — ${viewTarget?.registration_no ?? ''}`}
        size="full"
      >
        {viewTarget && (
          <div className="space-y-6 p-6">
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
                <DetailRow label={t('fleet.labels.registrationNo', { defaultValue: 'Registration No.' })} value={viewTarget.registration_no} />
                <DetailRow label={t('common.columns.busNumber', { defaultValue: 'Bus Number' })} value={viewTarget.bus_number} />
                <DetailRow label={t('fleet.labels.category', { defaultValue: 'Category' })} value={viewTarget.category_name ? `${viewTarget.category_code} — ${viewTarget.category_name}` : undefined} />
                <DetailRow label={t('fleet.columns.type', { defaultValue: 'Type' })} value={t(`fleet.vehicleTypes.${viewTarget.vehicle_type}`, { defaultValue: viewTarget.vehicle_type?.replace('_', ' ') })} />
                <DetailRow label={t('fleet.labels.manufacturer', { defaultValue: 'Manufacturer' })} value={viewTarget.make} />
                <DetailRow label={t('fleet.labels.model', { defaultValue: 'Model' })} value={viewTarget.model} />
                <DetailRow label={t('fleet.labels.yearOfManufacture', { defaultValue: 'Year' })} value={viewTarget.year} />
                <DetailRow label={t('fleet.labels.color', { defaultValue: 'Color' })} value={viewTarget.color} />
              </div>
            )}

            {viewStep === 1 && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <DetailRow label={t('fleet.labels.chassisVin', { defaultValue: 'Chassis No.' })} value={viewTarget.chassis_no} />
                <DetailRow label={t('fleet.labels.engineNumber', { defaultValue: 'Engine No.' })} value={viewTarget.engine_no} />
              </div>
            )}

            {viewStep === 2 && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <DetailRow label={t('fleet.labels.seatingCapacity', { defaultValue: 'Seating Capacity' })} value={viewTarget.capacity_seated} />
                <DetailRow label={t('fleet.labels.standingCapacityOpt', { defaultValue: 'Standing Capacity' })} value={viewTarget.capacity_standing} />
                <DetailRow label={t('fleet.fuelType', { defaultValue: 'Fuel Type' })} value={t(`fleet.fuelTypes.${viewTarget.fuel_type}`, { defaultValue: viewTarget.fuel_type })} />
                <DetailRow label={t('fleet.labels.engineCapacityCc', { defaultValue: 'Engine Capacity (CC)' })} value={viewTarget.engine_capacity_cc} />
              </div>
            )}

            {viewStep === 3 && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{t('common.status', { defaultValue: 'Status' })}</span>
                  <Badge variant={viewTarget.status === 'ACTIVE' || viewTarget.status === 'AVAILABLE' ? 'success' : viewTarget.status === 'ASSIGNED' || viewTarget.status === 'IN_SERVICE' ? 'info' : 'warning'} dot>
                    {t(`fleet.statuses.${viewTarget.status}`, { defaultValue: viewTarget.status?.replace('_', ' ') })}
                  </Badge>
                </div>
                <DetailRow
                  label={t('fleet.labels.routeAssigned', { defaultValue: 'Route Assigned' })}
                  value={(() => {
                    const r = routes.find((r) => r.id === viewTarget.assigned_route_id)
                    return r ? `${r.route_code ? `${r.route_code} — ` : ''}${r.name_en ?? r.id}` : undefined
                  })()}
                />
                <DetailRow label={t('fleet.labels.odometer', { defaultValue: 'Odometer' })} value={viewTarget.odometer_km != null ? `${viewTarget.odometer_km.toLocaleString()} km` : undefined} />
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{t('fleet.labels.availableForTrip', { defaultValue: 'Available for Trip' })}</span>
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
                  <DetailRow label={t('fleet.labels.insurancePolicyNo', { defaultValue: 'Insurance Policy No.' })} value={insDoc?.doc_no} />
                  <DetailRow label={t('fleet.labels.insuranceExpiryDate', { defaultValue: 'Insurance Expiry Date' })} dateValue={insDoc?.expiry_date} />
                  <DetailRow label={t('fleet.labels.fitnessCertNo', { defaultValue: 'Fitness Cert No.' })} value={fitDoc?.doc_no} />
                  <DetailRow label={t('fleet.labels.fitnessExpiryDate', { defaultValue: 'Fitness Expiry Date' })} dateValue={fitDoc?.expiry_date} />
                </div>
              )
            })()}

            <div className="flex justify-end border-t pt-4">
              <Button variant="secondary" onClick={() => setViewTarget(null)}>{t('common.close', { defaultValue: 'Close' })}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
