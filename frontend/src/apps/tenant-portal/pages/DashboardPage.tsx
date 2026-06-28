import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Bus, Users, TrendingUp, Clock, AlertTriangle, CheckCircle } from 'lucide-react'
import { StatCard } from '@components/shared/StatCard'
import { LiveMap } from '@components/domain/LiveMap'
import { TripStatusBadge } from '@components/domain/TripStatusBadge'
import { DateDisplay } from '@components/shared/DateDisplay'
import { useAuthStore } from '@store/authStore'
import { useUiStore } from '@store/uiStore'
import schedulingService, { Trip } from '@services/schedulingService'
import apiClient from '@services/api'
import { formatNPR } from '@utils/nepaliDate'

export default function DashboardPage() {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const { language } = useUiStore()

  const { data: todayTrips } = useQuery({
    queryKey: ['today-trips'],
    queryFn: schedulingService.trips.today,
    refetchInterval: 30 * 1000,
  })

  const { data: stats } = useQuery({
    queryKey: ['tenant-dashboard'],
    queryFn: async () => {
      const { data } = await apiClient.get('/analytics/dashboard/')
      return data.data
    },
    refetchInterval: 60 * 1000,
  })

  const { data: alerts } = useQuery({
    queryKey: ['tenant-alerts'],
    queryFn: async () => {
      const { data } = await apiClient.get('/notifications/alerts/?limit=5&unread=true')
      return data.data ?? []
    },
  })

  const inProgressTrips = todayTrips?.filter((t: Trip) => t.status === 'IN_PROGRESS') ?? []
  const scheduledTrips = todayTrips?.filter((t: Trip) => t.status === 'SCHEDULED') ?? []

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('nav.dashboard')}</h1>
          <p className="page-subtitle">
            {user?.tenantSchema?.replace(/_/g, ' ')} — Operations Center
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-green-50 px-3 py-1.5 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          {inProgressTrips.length} trips live
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Active Vehicles"
          value={stats?.active_vehicles ?? 0}
          icon={<Bus className="h-6 w-6" />}
        />
        <StatCard
          title="Trips Today"
          value={todayTrips?.length ?? 0}
          subtitle={`${inProgressTrips.length} in progress`}
          icon={<Clock className="h-6 w-6" />}
          trend={stats?.trip_growth}
        />
        <StatCard
          title="Revenue Today"
          value={formatNPR(stats?.revenue_today ?? 0, language as 'en' | 'ne')}
          icon={<TrendingUp className="h-6 w-6" />}
          colorClass="text-green-600"
        />
        <StatCard
          title="Passengers Today"
          value={(stats?.passengers_today ?? 0).toLocaleString()}
          icon={<Users className="h-6 w-6" />}
          trend={stats?.passenger_growth}
        />
      </div>

      {/* Live Map */}
      <div className="card">
        <h2 className="mb-4 font-semibold">Live Fleet Map</h2>
        <LiveMap tenantSlug={user?.tenantSchema ?? undefined} height="380px" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Today's trips */}
        <div className="card">
          <h3 className="mb-4 font-semibold">Today's Trips</h3>
          {!todayTrips?.length ? (
            <p className="text-sm text-gray-400">No trips scheduled for today</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {todayTrips.slice(0, 8).map((trip: Trip) => (
                <div key={trip.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">{trip.route_number} — {trip.vehicle_plate}</p>
                    <p className="text-xs text-gray-400">{trip.driver_name}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">
                      {new Date(trip.scheduled_departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <TripStatusBadge status={trip.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Alerts */}
        <div className="card">
          <h3 className="mb-4 font-semibold">
            <AlertTriangle className="mr-2 inline h-4 w-4 text-yellow-500" />
            Alerts & Notifications
          </h3>
          {!alerts?.length ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-400">
              <CheckCircle className="mb-2 h-8 w-8 text-green-400" />
              <p className="text-sm">All clear — no alerts</p>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert: { id: string; notification_type: string; title: string; message: string; created_at: string }) => (
                <div key={alert.id} className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-900/10">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{alert.title}</p>
                  <p className="text-xs text-gray-500">{alert.message}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    <DateDisplay date={alert.created_at} />
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
