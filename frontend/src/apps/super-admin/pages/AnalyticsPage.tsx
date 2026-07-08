import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { StatCard } from '@components/shared/StatCard'
import { TrendingUp, Bus, Users } from 'lucide-react'
import apiClient from '@services/api'
import { formatNPR } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'

const COLORS = ['#2563eb', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6']

export default function AnalyticsPage() {
  const { language } = useUiStore()

  const { data: cityAnalytics } = useQuery({
    queryKey: ['city-analytics'],
    queryFn: async () => {
      const { data } = await apiClient.get('/analytics/city/')
      return data.data
    },
  })

  const { data: revenueData } = useQuery({
    queryKey: ['revenue-chart'],
    queryFn: async () => {
      const { data } = await apiClient.get('/analytics/revenue/monthly/')
      return data.data
    },
  })

  const { data: tenantRevenue } = useQuery({
    queryKey: ['tenant-revenue-chart'],
    queryFn: async () => {
      const { data } = await apiClient.get('/analytics/revenue/by-tenant/')
      return data.data
    },
  })

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Platform Analytics</h1>
          <p className="page-subtitle">City-wide transit performance metrics</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Total Revenue (This Month)"
          value={formatNPR(cityAnalytics?.total_revenue ?? 0, language as 'en' | 'ne')}
          icon={<TrendingUp className="h-6 w-6" />}
          trend={cityAnalytics?.revenue_growth}
          colorClass="text-green-600"
        />
        <StatCard
          title="Total Trips (Today)"
          value={(cityAnalytics?.total_trips_today ?? 0).toLocaleString()}
          icon={<Bus className="h-6 w-6" />}
        />
        <StatCard
          title="Passengers (Today)"
          value={(cityAnalytics?.total_passengers_today ?? 0).toLocaleString()}
          icon={<Users className="h-6 w-6" />}
          trend={cityAnalytics?.passenger_growth}
        />
        <StatCard
          title="Platform Commission"
          value={formatNPR(cityAnalytics?.platform_commission ?? 0, language as 'en' | 'ne')}
          icon={<TrendingUp className="h-6 w-6" />}
          colorClass="text-primary-600"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Monthly revenue */}
        <div className="card">
          <h3 className="mb-4 font-semibold text-gray-900 dark:text-white">Monthly Revenue Trend</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={revenueData ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(val: number) => formatNPR(val, language as 'en' | 'ne')} />
              <Legend />
              <Line type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="commission" stroke="#22c55e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Revenue by tenant */}
        <div className="card">
          <h3 className="mb-4 font-semibold text-gray-900 dark:text-white">Revenue by Operator</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={tenantRevenue ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="tenant_name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(val: number) => formatNPR(val, language as 'en' | 'ne')} />
              <Bar dataKey="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Payment method breakdown */}
        <div className="card">
          <h3 className="mb-4 font-semibold text-gray-900 dark:text-white">Payment Methods</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={cityAnalytics?.payment_breakdown ?? []}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                dataKey="amount"
                nameKey="method"
                label={({ method, percent }) => `${method} (${(percent * 100).toFixed(0)}%)`}
              >
                {(cityAnalytics?.payment_breakdown ?? []).map((_: unknown, i: number) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(val: number) => formatNPR(val, language as 'en' | 'ne')} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Top routes */}
        <div className="card">
          <h3 className="mb-4 font-semibold text-gray-900 dark:text-white">Top Routes by Passengers</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={cityAnalytics?.top_routes ?? []} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="route_number" tick={{ fontSize: 11 }} width={40} />
              <Tooltip />
              <Bar dataKey="passengers" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
