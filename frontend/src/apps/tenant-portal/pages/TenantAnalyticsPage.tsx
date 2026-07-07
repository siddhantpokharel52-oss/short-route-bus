import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { StatCard } from '@components/shared/StatCard'
import {
  Bus, Users, TrendingUp, Clock, RefreshCw, Activity,
  CheckCircle2, XCircle, Banknote, ShieldAlert,
} from 'lucide-react'
import apiClient from '@services/api'
import { formatNPR } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'

// ── Timezone-safe date formatter (ISO → "M/D") ─────────────────────────────────
function fmtDate(iso: string) {
  const parts = iso.split('-')
  if (parts.length < 3) return iso
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`
}

// ── Pulse skeleton ─────────────────────────────────────────────────────────────
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-gray-100 ${className}`} />
}

// ── Mini summary stat ──────────────────────────────────────────────────────────
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

// ── Empty chart placeholder ────────────────────────────────────────────────────
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

// ── Types ──────────────────────────────────────────────────────────────────────
interface KPIData {
  fleet_utilization: number
  fleet_util_trend: number
  on_time_performance: number
  total_passengers: number
  passenger_trend: number
  avg_revenue_per_trip: number
  total_revenue_today: number
  breakdown_rate: number
  fuel_efficiency: number
  avg_speed: number
  total_distance: number
  trips_total: number
  trips_completed: number
  trips_cancelled: number
  total_vehicles: number
  active_vehicles: number
  top_routes: { route: string; passengers: number }[]
}

interface TrendPoint {
  date: string
  trips: number
  passengers: number
  revenue: number
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function TenantAnalyticsPage() {
  const { t } = useTranslation('tenant')
  const { language } = useUiStore()
  const [trendDays, setTrendDays] = useState(30)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  // Force-re-render every 15 s so "X ago" text stays fresh
  const [, setClockTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setClockTick((n) => n + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  // ── Queries ──────────────────────────────────────────────────────────────────
  const {
    data: kpis,
    isLoading: kpiLoading,
    isError: kpiError,
    refetch: refetchKpis,
    dataUpdatedAt,
  } = useQuery<KPIData>({
    queryKey: ['tenant-kpis'],
    queryFn: async () => {
      const { data } = await apiClient.get('/analytics/kpis/')
      return data.data
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  })

  const { data: trend = [], isLoading: trendLoading } = useQuery<TrendPoint[]>({
    queryKey: ['trip-trend', trendDays],
    queryFn: async () => {
      const { data } = await apiClient.get('/analytics/trips/trend/', {
        params: { days: trendDays },
      })
      return data.data ?? []
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (dataUpdatedAt) setLastUpdated(new Date(dataUpdatedAt))
  }, [dataUpdatedAt])

  function timeSince(date: Date) {
    const sec = Math.floor((Date.now() - date.getTime()) / 1000)
    if (sec < 10) return t('analytics.justNow')
    if (sec < 60) return t('analytics.secondsAgo', { n: sec })
    return t('analytics.minutesAgo', { n: Math.floor(sec / 60) })
  }

  const hasTopRoutes = (kpis?.top_routes?.length ?? 0) > 0
  const hasTrend     = trend.some((p) => p.trips > 0 || p.passengers > 0)
  const hasRevenue   = trend.some((p) => p.revenue > 0)

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{t('analytics.title')}</h1>
          {lastUpdated ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400">
              <Activity className="h-3 w-3 text-green-500" />
              {t('analytics.updatedAgo', { time: timeSince(lastUpdated) })}
            </p>
          ) : kpiLoading ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400">
              <RefreshCw className="h-3 w-3 animate-spin" /> {t('analytics.loadingLiveData')}
            </p>
          ) : null}
        </div>
        <button
          onClick={() => refetchKpis()}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t('analytics.refreshNow')}
        </button>
      </div>

      {/* ── Error banner ──────────────────────────────────────────────────── */}
      {kpiError && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <ShieldAlert className="h-4 w-4 flex-shrink-0" />
          {t('analytics.loadError')}
        </div>
      )}

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpiLoading
          ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)
          : (
            <>
              <StatCard
                title={t('analytics.fleetUtilization')}
                value={`${kpis?.fleet_utilization ?? 0}%`}
                icon={<Bus className="h-6 w-6" />}
                trend={kpis?.fleet_util_trend}
                subtitle={t('analytics.activeOfTotalVehicles', { active: kpis?.active_vehicles ?? 0, total: kpis?.total_vehicles ?? 0 })}
              />
              <StatCard
                title={t('analytics.onTimePerformance')}
                value={`${kpis?.on_time_performance ?? 0}%`}
                icon={<Clock className="h-6 w-6" />}
                colorClass="text-green-600"
                subtitle={t('analytics.tripsCompletedToday', { count: kpis?.trips_completed ?? 0 })}
              />
              <StatCard
                title={t('analytics.passengerCount')}
                value={(kpis?.total_passengers ?? 0).toLocaleString()}
                icon={<Users className="h-6 w-6" />}
                trend={kpis?.passenger_trend}
                subtitle={t('analytics.ticketsIssuedToday')}
              />
              <StatCard
                title={t('analytics.revenuePerTrip')}
                value={formatNPR(kpis?.avg_revenue_per_trip ?? 0, language as 'en' | 'ne')}
                icon={<TrendingUp className="h-6 w-6" />}
                subtitle={t('analytics.totalLabel', { amount: formatNPR(kpis?.total_revenue_today ?? 0, language as 'en' | 'ne') })}
              />
            </>
          )}
      </div>

      {/* ── Today's Summary Row ───────────────────────────────────────────── */}
      {kpiLoading
        ? <Skeleton className="h-24" />
        : (
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('analytics.todaysSummary')}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <MiniStat
                icon={<Bus className="h-4 w-4" />}
                label={t('analytics.totalTrips')}
                value={kpis?.trips_total ?? 0}
                color="text-blue-700"
              />
              <MiniStat
                icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
                label={t('analytics.completed')}
                value={kpis?.trips_completed ?? 0}
                color="text-green-700"
              />
              <MiniStat
                icon={<XCircle className="h-4 w-4 text-red-400" />}
                label={t('analytics.cancelled')}
                value={kpis?.trips_cancelled ?? 0}
                color="text-red-500"
              />
              <MiniStat
                icon={<Bus className="h-4 w-4 text-primary-500" />}
                label={t('analytics.activeVehicles')}
                value={`${kpis?.active_vehicles ?? 0} / ${kpis?.total_vehicles ?? 0}`}
                color="text-primary-700"
              />
              <MiniStat
                icon={<ShieldAlert className="h-4 w-4 text-orange-400" />}
                label={t('analytics.breakdownRate')}
                value={`${kpis?.breakdown_rate ?? 0}%`}
                color={Number(kpis?.breakdown_rate) > 10 ? 'text-red-600' : 'text-orange-600'}
              />
              <MiniStat
                icon={<Banknote className="h-4 w-4 text-emerald-500" />}
                label={t('analytics.revenueToday')}
                value={`NPR ${Number(kpis?.total_revenue_today ?? 0).toLocaleString()}`}
                color="text-emerald-700"
              />
            </div>
          </div>
        )}

      {/* ── Charts Row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Trip + Passenger Trend */}
        <div className="card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-gray-800">{t('analytics.dailyTripsPassengers')}</h3>
            <div className="flex gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs">
              {([7, 14, 30] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setTrendDays(d)}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    trendDays === d
                      ? 'bg-white text-primary-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
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
            ? <ChartEmpty height={220} label={t('analytics.noData')} />
            : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gTrips" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#2563eb" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0}    />
                    </linearGradient>
                    <linearGradient id="gPass" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickFormatter={fmtDate}
                    interval={trendDays <= 7 ? 0 : 'preserveStartEnd'}
                  />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    labelFormatter={fmtDate}
                    formatter={(v: number, name: string) => [
                      v.toLocaleString(),
                      name === 'trips' ? t('analytics.trips') : t('analytics.passengers'),
                    ]}
                  />
                  <Legend
                    formatter={(v) => (v === 'trips' ? t('analytics.trips') : t('analytics.passengers'))}
                    iconType="circle"
                    iconSize={8}
                  />
                  <Area
                    type="monotone" dataKey="trips"
                    stroke="#2563eb" strokeWidth={2}
                    fill="url(#gTrips)" dot={false} activeDot={{ r: 4 }}
                  />
                  <Area
                    type="monotone" dataKey="passengers"
                    stroke="#22c55e" strokeWidth={2}
                    fill="url(#gPass)" dot={false} activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
        </div>

        {/* Top Performing Routes */}
        <div className="card">
          <h3 className="mb-4 font-semibold text-gray-800">
            {t('analytics.topRoutes')}
            <span className="ml-1.5 text-xs font-normal text-gray-400">{t('analytics.tripsToday')}</span>
          </h3>
          {kpiLoading
            ? <Skeleton className="h-56" />
            : !hasTopRoutes
            ? <ChartEmpty height={220} label={t('analytics.noData')} />
            : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={kpis!.top_routes}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="route" tick={{ fontSize: 11 }} width={90} />
                  <Tooltip formatter={(v: number) => [v, t('analytics.trips')]} />
                  <Bar dataKey="passengers" name="Trips" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
        </div>
      </div>

      {/* ── Revenue Trend ─────────────────────────────────────────────────── */}
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">{t('analytics.revenueTrend')}</h3>
          <span className="text-xs text-gray-400">{t('analytics.lastNDays', { n: trendDays })}</span>
        </div>
        {trendLoading
          ? <Skeleton className="h-44" />
          : !hasRevenue
          ? <ChartEmpty height={160} label={t('analytics.noData')} />
          : (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={trend} margin={{ top: 4, right: 4, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={fmtDate}
                  interval={trendDays <= 7 ? 0 : 'preserveStartEnd'}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                  }
                />
                <Tooltip
                  labelFormatter={fmtDate}
                  formatter={(v: number) => [`NPR ${v.toLocaleString()}`, 'Revenue']}
                />
                <Area
                  type="monotone" dataKey="revenue"
                  stroke="#10b981" strokeWidth={2}
                  fill="url(#gRev)" dot={false} activeDot={{ r: 4 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
      </div>

      {/* ── Performance Summary ───────────────────────────────────────────── */}
      <div className="card">
        <h3 className="mb-4 font-semibold text-gray-800">Performance Summary</h3>
        {kpiLoading
          ? <Skeleton className="h-16" />
          : (
            <div className="grid grid-cols-2 gap-6 text-center sm:grid-cols-4">
              {[
                { label: t('analytics.fuelEfficiency'), value: `${kpis?.fuel_efficiency ?? 0} km/L` },
                { label: t('analytics.breakdown'),       value: `${kpis?.breakdown_rate ?? 0}%`     },
                { label: t('analytics.averageSpeed'),    value: `${kpis?.avg_speed ?? 0} km/h`      },
                { label: 'Total Distance',               value: `${(kpis?.total_distance ?? 0).toLocaleString()} km` },
              ].map((s) => (
                <div key={s.label}>
                  <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                  <p className="mt-1 text-sm text-gray-500">{s.label}</p>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  )
}
