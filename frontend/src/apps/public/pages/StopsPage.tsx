import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MapPin, Clock, Search, Bus } from 'lucide-react'
import { Input } from '@components/shared/Input'
import { Badge } from '@components/shared/Badge'
import publicService, { Stop, Arrival } from '@services/publicService'

function StopCard({ stop }: { stop: Stop }) {
  const { t } = useTranslation('public')
  const [showArrivals, setShowArrivals] = useState(false)

  const { data: arrivals, isLoading: arrivalsLoading } = useQuery({
    queryKey: ['arrivals', stop.id],
    queryFn: () => publicService.stops.arrivals(stop.id),
    enabled: showArrivals,
    refetchInterval: showArrivals ? 30 * 1000 : false,
  })

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${stop.is_terminal ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600'}`}>
            <MapPin className="h-4 w-4" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">{stop.name_en}</p>
            <p className="text-sm text-gray-500">{stop.name_ne}</p>
          </div>
        </div>
        {stop.is_terminal && <Badge variant="info">{t('stops.terminal')}</Badge>}
      </div>

      <p className="text-xs text-gray-400 mb-4">{stop.district}{stop.ward_number && `, ${t('stops.ward')} ${stop.ward_number}`}</p>

      <button
        onClick={() => setShowArrivals(!showArrivals)}
        className="flex items-center gap-2 text-sm text-primary-600 hover:underline"
      >
        <Clock className="h-4 w-4" />
        {showArrivals ? t('stops.hide') : t('stops.show')} {t('stops.arrivals')}
      </button>

      {showArrivals && (
        <div className="mt-3 border-t pt-3">
          {arrivalsLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-8 rounded bg-gray-100" />
              <div className="h-8 rounded bg-gray-100" />
            </div>
          ) : arrivals?.length === 0 ? (
            <p className="text-sm text-gray-400">{t('stops.noArrivals')}</p>
          ) : (
            <div className="space-y-2">
              {(arrivals ?? []).slice(0, 5).map((arrival: Arrival) => (
                <div key={`${arrival.vehicle_id}-${arrival.route_number}`} className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Bus className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-green-800">{arrival.route_number}</span>
                    <span className="text-xs text-green-600">{arrival.plate_number}</span>
                  </div>
                  <span className="text-sm font-bold text-green-700">
                    {arrival.eta_minutes} {t('stops.minutes')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function StopsPage() {
  const { t } = useTranslation('public')
  const [search, setSearch] = useState('')

  const { data: stops, isLoading } = useQuery({
    queryKey: ['public-stops', search],
    queryFn: () => publicService.stops.list(search ? { search } : {}),
  })

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">{t('stops.title')}</h1>
      <p className="text-gray-500 mb-6">{t('stops.subtitle')}</p>

      <Input
        placeholder={t('stops.searchPlaceholder')}
        leftAddon={<Search className="h-4 w-4" />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md mb-8"
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1,2,3].map((i) => <div key={i} className="h-32 rounded-2xl bg-white animate-pulse shadow-sm" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(stops ?? []).map((stop: Stop) => (
            <StopCard key={stop.id} stop={stop} />
          ))}
        </div>
      )}
    </div>
  )
}
