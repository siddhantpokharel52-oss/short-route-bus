import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Search, Bus, MapPin, Clock, ChevronRight } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { LiveMap } from '@components/domain/LiveMap'
import publicService, { Route } from '@services/publicService'

export default function HomePage() {
  const { t } = useTranslation('public')
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const { data: routes } = useQuery({
    queryKey: ['public-routes-brief'],
    queryFn: () => publicService.routes.list({ page_size: '6' }),
  })

  const { data: liveVehicles } = useQuery({
    queryKey: ['live-vehicles-home'],
    queryFn: () => publicService.liveVehicles(),
    refetchInterval: 30 * 1000,
  })

  return (
    <div>
      {/* Hero */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary-800 via-primary-700 to-primary-600 py-20 text-white">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-8 left-8 text-9xl">🚌</div>
          <div className="absolute bottom-8 right-8 text-9xl">🏙️</div>
        </div>
        <div className="relative mx-auto max-w-4xl px-4 text-center">
          <h1 className="text-5xl font-extrabold md:text-6xl">{t('home.title')}</h1>
          <p className="mt-4 text-xl text-primary-200">{t('home.subtitle')}</p>

          {/* Search */}
          <div className="mt-10 flex flex-col gap-3 sm:flex-row max-w-2xl mx-auto">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                className="w-full rounded-xl border-0 bg-white py-4 pl-12 pr-4 text-gray-900 placeholder:text-gray-400 shadow-lg focus:outline-none focus:ring-2 focus:ring-white"
                placeholder={t('home.findRoute')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/routes?q=${search}`)}
              />
            </div>
            <Button
              size="lg"
              className="bg-white !text-primary-700 hover:!bg-primary-50 shadow-lg"
              onClick={() => navigate(`/routes?q=${search}`)}
            >
              {t('home.searchButton')}
            </Button>
          </div>

          {/* Stats */}
          <div className="mt-12 flex flex-wrap justify-center gap-8">
            {[
              { icon: <Bus className="h-5 w-5" />, label: `${liveVehicles?.length ?? 0} buses live` },
              { icon: <MapPin className="h-5 w-5" />, label: '48 routes' },
              { icon: <Clock className="h-5 w-5" />, label: '5:30 AM – 10:00 PM' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2 text-primary-100">
                {item.icon}
                <span className="font-medium">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-12 space-y-12">
        {/* Live Map */}
        <section>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">{t('home.liveMap')}</h2>
          <LiveMap height="420px" />
        </section>

        {/* Routes */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Popular Routes</h2>
            <a href="/routes" className="flex items-center gap-1 text-primary-600 text-sm font-medium hover:underline">
              {t('home.viewAll')} <ChevronRight className="h-4 w-4" />
            </a>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(Array.isArray(routes) ? routes : []).slice(0, 6).map((route: Route) => (
              <div
                key={route.id}
                className="group rounded-2xl border border-gray-100 bg-white p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => navigate(`/routes?route=${route.route_number}`)}
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="inline-flex items-center rounded-full bg-primary-100 px-3 py-1 text-sm font-bold text-primary-700">
                    {route.route_number}
                  </span>
                  <span className="text-sm text-gray-400">Rs. {route.base_fare}</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <div className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0" />
                    {route.start_stop?.name_en}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <div className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
                    {route.end_stop?.name_en}
                  </div>
                </div>
                <div className="mt-3 flex gap-3 text-xs text-gray-400">
                  <span>{route.total_distance_km} km</span>
                  <span>·</span>
                  <span>~{route.estimated_duration_minutes} min</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Quick links */}
        <section>
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Quick Access</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { to: '/routes', icon: '🗺️', label: t('routes.title') },
              { to: '/stops', icon: '🚏', label: t('stops.title') },
              { to: '/fares', icon: '💰', label: t('fares.title') },
              { to: '/verify-ticket', icon: '🎫', label: t('tickets.verifyTicket') },
              { to: '/complaints', icon: '📝', label: t('complaints.title') },
              { to: '/smart-card', icon: '💳', label: t('smartCard.title') },
            ].map((item) => (
              <a
                key={item.to}
                href={item.to}
                className="flex flex-col items-center gap-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm hover:shadow-md hover:border-primary-200 transition-all text-center"
              >
                <span className="text-3xl">{item.icon}</span>
                <span className="text-sm font-medium text-gray-700">{item.label}</span>
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
