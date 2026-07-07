import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Search, MapPin, Clock, Ruler, Bus } from 'lucide-react'
import { Input } from '@components/shared/Input'
import publicService, { Route } from '@services/publicService'
import { formatNPR } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'

export default function RoutesPage() {
  const { t } = useTranslation('public')
  const { language } = useUiStore()
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('q') ?? '')

  const { data: routes, isLoading } = useQuery({
    queryKey: ['public-routes', search],
    queryFn: () => publicService.routes.list(search ? { search } : {}),
  })

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">{t('routes.title')}</h1>
      <p className="text-gray-500 mb-6">{t('routes.subtitle')}</p>

      <Input
        placeholder={t('routes.searchPlaceholder')}
        leftAddon={<Search className="h-4 w-4" />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md mb-8"
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1,2,3,4,5,6].map((i) => (
            <div key={i} className="rounded-2xl bg-white p-5 shadow-sm animate-pulse">
              <div className="h-6 w-16 rounded-full bg-gray-200 mb-3" />
              <div className="space-y-2">
                <div className="h-4 w-3/4 rounded bg-gray-200" />
                <div className="h-4 w-2/3 rounded bg-gray-200" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(routes ?? []).map((route: Route) => (
            <div key={route.id} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <span className="inline-flex items-center rounded-full bg-primary-100 px-3 py-1 text-sm font-bold text-primary-700">
                  <Bus className="mr-1 h-3.5 w-3.5" />
                  {route.route_number}
                </span>
                <span className="text-sm font-semibold text-green-600">{formatNPR(route.base_fare, language as 'en' | 'ne')}</span>
              </div>

              {/* Route name */}
              <p className="font-semibold text-gray-900 mb-1">{route.name_en}</p>
              <p className="text-sm text-gray-400 mb-4">{route.name_ne}</p>

              {/* Stops */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <div className="h-2.5 w-2.5 rounded-full bg-green-500 flex-shrink-0" />
                  <span>{route.start_stop?.name_en}</span>
                </div>
                <div className="ml-1 border-l-2 border-dashed border-gray-200 h-3" />
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-500 flex-shrink-0" />
                  <span>{route.end_stop?.name_en}</span>
                </div>
              </div>

              {/* Meta */}
              <div className="flex items-center gap-4 text-xs text-gray-400 border-t pt-3">
                <span className="flex items-center gap-1">
                  <Ruler className="h-3.5 w-3.5" />
                  {route.total_distance_km} km
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  ~{route.estimated_duration_minutes} min
                </span>
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {t('routes.stopsCount', { count: route.stops?.length ?? 0 })}
                </span>
              </div>

              {/* Operators */}
              {route.operated_by?.length > 0 && (
                <p className="mt-2 text-xs text-gray-400">
                  {t('routes.operatedBy')}: {route.operated_by.join(', ')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {routes?.length === 0 && !isLoading && (
        <div className="text-center py-16 text-gray-400">
          <Bus className="mx-auto h-12 w-12 text-gray-300 mb-4" />
          <p className="text-lg">{t('routes.noResults', { search })}</p>
          <p className="text-sm">{t('routes.tryDifferentSearch')}</p>
        </div>
      )}
    </div>
  )
}
