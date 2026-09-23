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
import { Wallet, Bus, Banknote, CreditCard, TrendingUp } from 'lucide-react'
import ownerService, {
  OwnerDashboardPerBus, OwnerDashboardRoute, OwnerDashboardTrendPoint,
} from '@services/ownerService'
import { formatNPR } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'

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
  const fmtMoney = (v: number) => formatNPR(v, language as 'en' | 'ne')

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['owner-dashboard-summary'],
    queryFn: () => ownerService.dashboardSummary(),
    staleTime: 30_000,
  })

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
    </div>
  )
}
