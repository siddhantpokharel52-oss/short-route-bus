/**
 * Live Tracking Page
 * ──────────────────
 * Interactive Baato/MapLibre map showing real-time bus positions, route polylines,
 * ETA for stops and headway spacing between buses.
 *
 * Data sources:
 *  • HTTP poll (5 s) → Django /api/v1/scheduling/live-positions/
 *  • WebSocket       → FastAPI /api/v1/live/ws/vehicles/{tenantSlug}/
 *  • ETA             → Django /api/v1/scheduling/eta/?route_id=
 *  • Headway         → Django /api/v1/scheduling/headway/?route_id=
 *  • Route polyline  → Django /api/v1/scheduling/routes/{id}/polyline/
 */
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDateFormatter } from '@hooks/useDateFormatter'
import Map, { Marker, Popup, Source, Layer, useMap } from 'react-map-gl/maplibre'
import { BAATO_STYLE_URL } from '@/config/baato'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@store/authStore'
import trackingService, {
  VehiclePosition,
  ETAStop,
  HeadwayData,
  subscribeToLivePositions,
} from '@services/trackingService'
import apiClient, { ApiResponse } from '@services/api'
import toast from 'react-hot-toast'
import {
  RefreshCw,
  AlertTriangle,
  Clock,
  Gauge,
  Bus,
  Activity,
} from 'lucide-react'
import { cn } from '@utils/cn'

// ─── Custom bus icon color by speed ──────────────────────────────────────────
function busColor(speed: number) {
  return speed > 50 ? '#ef4444' : speed > 20 ? '#f59e0b' : '#22c55e'
}

// ─── Route selector ───────────────────────────────────────────────────────────
interface RouteOption {
  id: string
  route_code: string
  name_en: string
}

// ─── Map auto-fit helper ──────────────────────────────────────────────────────
function FitBounds({ positions }: { positions: [number, number][] }) {
  const { current: map } = useMap()
  useEffect(() => {
    if (!map || positions.length === 0) return
    if (positions.length === 1) {
      map.flyTo({ center: [positions[0][1], positions[0][0]], zoom: 14 })
    } else {
      const lngs = positions.map((p) => p[1])
      const lats = positions.map((p) => p[0])
      map.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 40 }
      )
    }
  }, [map, positions])
  return null
}

// ─── Status pill ──────────────────────────────────────────────────────────────
function StatusBadge({ value }: { value: string }) {
  const cls: Record<string, string> = {
    ARRIVED: 'bg-green-100 text-green-700',
    UPCOMING: 'bg-blue-100 text-blue-700',
    UNKNOWN: 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', cls[value] ?? cls.UNKNOWN)}>
      {value}
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function LiveTrackingPage() {
  const { t } = useTranslation('tenant')
  const fmtDate = useDateFormatter()
  const { tenantSlug } = useAuthStore()
  const [positions, setPositions] = useState<Record<string, VehiclePosition>>({})
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'buses' | 'eta' | 'headway'>('buses')
  const [isSimulating, setIsSimulating] = useState(false)

  // ── Fetch routes for selector ─────────────────────────────────────────────
  const { data: routes = [] } = useQuery<RouteOption[]>({
    queryKey: ['routes-for-tracking'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<{ results?: RouteOption[]; count?: number } | RouteOption[]>>('/platform/routes/')
      if (Array.isArray(data.data)) return data.data
      const d = data.data as { results?: RouteOption[] }
      return d.results ?? []
    },
  })

  // ── Route polyline ────────────────────────────────────────────────────────
  const { data: polyline, isError: polylineError, error: polylineErrorObj } = useQuery({
    queryKey: ['route-polyline', selectedRouteId],
    queryFn: () => trackingService.getRoutePolyline(selectedRouteId),
    enabled: !!selectedRouteId,
    retry: 1,
  })

  // ── ETA panel ─────────────────────────────────────────────────────────────
  const { data: etaStops = [], refetch: refetchETA } = useQuery<ETAStop[]>({
    queryKey: ['eta', selectedRouteId],
    queryFn: () => trackingService.getETA(selectedRouteId),
    enabled: !!selectedRouteId && activeTab === 'eta',
    refetchInterval: 10000,
  })

  // ── Headway panel ─────────────────────────────────────────────────────────
  const { data: headwayData, refetch: refetchHeadway } = useQuery<HeadwayData>({
    queryKey: ['headway', selectedRouteId],
    queryFn: () => trackingService.getHeadway(selectedRouteId),
    enabled: !!selectedRouteId && activeTab === 'headway',
    refetchInterval: 10000,
  })

  // ── HTTP polling for live positions (5 s fallback) ────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const list = await trackingService.getLivePositions()
        setPositions((prev) => {
          const next = { ...prev }
          list.forEach((p) => { next[p.vehicle_id] = p })
          return next
        })
      } catch { /* ignore */ }
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [])

  // ── WebSocket for instant updates ─────────────────────────────────────────
  useEffect(() => {
    if (!tenantSlug) return
    const unsub = subscribeToLivePositions(
      tenantSlug,
      (pos) => setPositions((prev) => ({ ...prev, [pos.vehicle_id]: pos })),
      (alert) => {
        const a = alert as { message?: string }
        if (a?.message) toast.error(a.message, { icon: '⚠️' })
      },
    )
    return unsub
  }, [tenantSlug])

  // ── Simulate GPS data ─────────────────────────────────────────────────────
  const handleSimulate = async () => {
    const vehicleIds = Object.keys(positions).slice(0, 5)
    if (!tenantSlug || vehicleIds.length === 0) {
      toast.error('No vehicles to simulate. Ensure vehicles exist in fleet.')
      return
    }
    setIsSimulating(true)
    try {
      const routeCoords = polyline?.coordinates.map((c) => ({ lat: c.latitude, lng: c.longitude }))
      await apiClient.post('/api/v1/live/gps/simulate/', {
        tenant_slug: tenantSlug,
        vehicle_ids: vehicleIds,
        route_coords: routeCoords,
      })
      toast.success('Simulated GPS positions injected!')
    } catch {
      toast.error('Simulation failed (FastAPI must be running)')
    } finally {
      setIsSimulating(false)
    }
  }

  const validCoordinates = (polyline?.coordinates ?? []).filter(
    (c) => c.latitude !== 0 || c.longitude !== 0
  )

  // All positions for FitBounds — [lat, lng][]
  const allPositions: [number, number][] = [
    ...Object.values(positions).map((p): [number, number] => [p.latitude, p.longitude]),
    ...validCoordinates.map((c): [number, number] => [c.latitude, c.longitude]),
  ]

  // GeoJSON for route polyline — [lng, lat][] for MapLibre
  const polylineGeoJSON = validCoordinates.length > 1 ? {
    type: 'Feature' as const,
    geometry: {
      type: 'LineString' as const,
      coordinates: validCoordinates.map((c) => [c.longitude, c.latitude]),
    },
    properties: {},
  } : null

  return (
    <div className="flex h-[calc(100vh-var(--header-height))] overflow-hidden">
      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-3">
            <div className="rounded-lg bg-green-100 p-2">
              <Activity className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900 dark:text-white">{t('liveTracking.title')}</h1>
              <p className="text-xs text-gray-500">{Object.keys(positions).length} {t('liveTracking.busesTracked')}</p>
            </div>
          </div>

          {/* Route selector */}
          <select
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            value={selectedRouteId}
            onChange={(e) => setSelectedRouteId(e.target.value)}
          >
            <option value="">— All routes —</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.route_code}: {r.name_en}
              </option>
            ))}
          </select>

          {selectedRouteId && polyline && polyline.total_stops > 0 && polyline.mapped_stops === 0 && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[10px] font-semibold text-amber-700">⚠ No GPS coordinates set</p>
              <p className="text-[10px] text-amber-600 mt-0.5">
                This route has {polyline.total_stops} stop{polyline.total_stops !== 1 ? 's' : ''} but none have coordinates. Set stop coordinates in Bus Stops management.
              </p>
            </div>
          )}
          {selectedRouteId && polyline && polyline.total_stops === 0 && (
            <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-600">ℹ No stops assigned</p>
              <p className="text-[10px] text-gray-500 mt-0.5">
                Assign stops to this route in Route Management first.
              </p>
            </div>
          )}
          {selectedRouteId && polyline && polyline.mapped_stops > 0 && polyline.mapped_stops < polyline.total_stops && (
            <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
              <p className="text-[10px] text-blue-600">
                Showing {polyline.mapped_stops} of {polyline.total_stops} stops (others missing coordinates)
              </p>
            </div>
          )}
          {selectedRouteId && polylineError && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-[10px] font-semibold text-red-700">⚠ Could not load route</p>
              <p className="text-[10px] text-red-500 mt-0.5">
                {(polylineErrorObj as Error)?.message ?? 'Failed to fetch route data'}
              </p>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {([
            { id: 'buses', label: t('liveTracking.tabs.buses') },
            { id: 'eta', label: t('liveTracking.tabs.arrivals') },
            { id: 'headway', label: t('liveTracking.tabs.spacing') },
          ] as const).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex-1 py-2 text-xs font-medium transition-colors px-1',
                activeTab === id
                  ? 'border-b-2 border-primary-600 text-primary-600'
                  : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {/* BUSES tab */}
          {activeTab === 'buses' && (
            <>
              {Object.values(positions).length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-400">
                  <Bus className="mx-auto mb-2 h-8 w-8 opacity-30" />
                  <p>No buses tracked yet.</p>
                  <button
                    onClick={handleSimulate}
                    disabled={isSimulating}
                    className="mt-3 rounded-lg bg-primary-600 px-3 py-1.5 text-xs text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    {isSimulating ? 'Simulating…' : 'Inject Demo GPS Data'}
                  </button>
                </div>
              ) : (
                Object.values(positions).map((bus) => (
                  <button
                    key={bus.vehicle_id}
                    onClick={() => setSelectedVehicle(
                      selectedVehicle === bus.vehicle_id ? null : bus.vehicle_id
                    )}
                    className={cn(
                      'w-full rounded-xl border p-3 text-left transition-all',
                      selectedVehicle === bus.vehicle_id
                        ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-900/20'
                        : 'border-gray-200 hover:border-gray-300 dark:border-gray-700',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-900 dark:text-white">
                        🚌 {bus.vehicle_id.slice(0, 8)}
                      </span>
                      <span className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                        bus.speed > 50 ? 'bg-red-100 text-red-600' :
                        bus.speed > 20 ? 'bg-yellow-100 text-yellow-600' :
                        'bg-green-100 text-green-600',
                      )}>
                        {bus.speed.toFixed(0)} km/h
                      </span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      <span className="text-[10px] text-gray-500">
                        📍 {bus.latitude.toFixed(4)}, {bus.longitude.toFixed(4)}
                      </span>
                      <span className="text-[10px] text-gray-500">
                        🧭 {bus.heading.toFixed(0)}°
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-gray-400">
                      {t('liveTracking.popup.updated')} {fmtDate(bus.timestamp)}
                    </p>
                  </button>
                ))
              )}
            </>
          )}

          {/* ETA tab */}
          {activeTab === 'eta' && (
            <>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide pb-1">{t('liveTracking.eta')}</p>
              {!selectedRouteId ? (
                <p className="py-8 text-center text-xs text-gray-400">Select a route to view arrival times</p>
              ) : etaStops.length === 0 ? (
                <p className="py-4 text-center text-xs text-gray-400">No arrival data (no buses near this route)</p>
              ) : (
                <div className="space-y-1">
                  {etaStops.map((stop) => (
                    <div
                      key={stop.stop_id}
                      className={cn(
                        'rounded-lg border p-2.5',
                        stop.status === 'ARRIVED' ? 'border-green-200 bg-green-50' :
                        stop.status === 'UPCOMING' ? 'border-blue-200 bg-blue-50' :
                        'border-gray-200',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-800 dark:text-white">
                          {stop.sequence_no}. {stop.stop_name}
                        </span>
                        <StatusBadge value={stop.status} />
                      </div>
                      {stop.eta_minutes !== null && (
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-gray-500">
                          <Clock className="h-3 w-3" />
                          {stop.eta_minutes === 0
                            ? 'Bus is here'
                            : `~${stop.eta_minutes} min away`}
                        </div>
                      )}
                      {stop.distance_m !== null && stop.distance_m > 0 && (
                        <p className="mt-0.5 text-[10px] text-gray-400">
                          {(stop.distance_m / 1000).toFixed(1)} km from nearest bus
                        </p>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => refetchETA()}
                    className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs text-primary-600 hover:bg-primary-50"
                  >
                    <RefreshCw className="h-3 w-3" /> {t('liveTracking.refreshETA')}
                  </button>
                </div>
              )}
            </>
          )}

          {/* HEADWAY tab */}
          {activeTab === 'headway' && (
            <>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide pb-1">Time Spacing Between Vehicles</p>
              {!selectedRouteId ? (
                <p className="py-8 text-center text-xs text-gray-400">Select a route to view bus spacing</p>
              ) : (
                <>
                  {headwayData?.alerts && headwayData.alerts.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 mb-2">
                      <div className="flex items-center gap-1 mb-1">
                        <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                        <span className="text-xs font-semibold text-red-700">Bunching Alerts</span>
                      </div>
                      {headwayData.alerts.map((a, i) => (
                        <p key={i} className="text-[10px] text-red-600 mt-0.5">{a.message}</p>
                      ))}
                    </div>
                  )}

                  {headwayData?.buses?.length === 0 && (
                    <p className="py-4 text-center text-xs text-gray-400">No active buses on this route</p>
                  )}

                  {headwayData?.buses?.map((bus, i) => (
                    <div key={bus.vehicle_id} className="rounded-lg border border-gray-200 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🚌</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-800 truncate">
                            Bus #{i + 1} — {bus.vehicle_id.slice(0, 8)}
                          </p>
                          <div className="flex items-center gap-3 text-[10px] text-gray-500">
                            <span><Gauge className="inline h-3 w-3" /> {bus.speed_kmh.toFixed(0)} km/h</span>
                            <span>📍 {bus.progress_pct.toFixed(0)}% along route</span>
                          </div>
                        </div>
                      </div>
                      {bus.gap_ahead_minutes !== null && (
                        <div className={cn(
                          'mt-1 rounded px-2 py-1 text-[10px]',
                          bus.bunching_alert ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600',
                        )}>
                          {bus.bunching_alert ? '⚠️ ' : ''}
                          {bus.gap_ahead_minutes} min gap to next bus ahead
                          {bus.gap_ahead_km !== null ? ` (~${bus.gap_ahead_km} km)` : ''}
                        </div>
                      )}
                      {i === 0 && (
                        <p className="mt-1 text-[10px] text-purple-600">↑ Leading bus</p>
                      )}
                    </div>
                  ))}

                  <button
                    onClick={() => refetchHeadway()}
                    className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs text-primary-600 hover:bg-primary-50"
                  >
                    <RefreshCw className="h-3 w-3" /> Refresh
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Map ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 relative">
        <Map
          initialViewState={{ latitude: 27.7172, longitude: 85.3240, zoom: 13 }}
          style={{ height: '100%', width: '100%' }}
          mapStyle={BAATO_STYLE_URL}
        >
          {/* Auto-fit bounds when positions are available */}
          {allPositions.length > 0 && <FitBounds positions={allPositions} />}

          {/* Route polyline */}
          {polylineGeoJSON && (
            <Source id="route-polyline" type="geojson" data={polylineGeoJSON}>
              <Layer
                id="route-polyline-line"
                type="line"
                paint={{ 'line-color': '#6366f1', 'line-width': 4, 'line-opacity': 0.7, 'line-dasharray': [2, 1] }}
                layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              />
            </Source>
          )}

          {/* Stop markers along the route */}
          {validCoordinates.map((stop, i) => {
            const isTerminal = i === 0 || i === validCoordinates.length - 1
            return (
              <Marker
                key={stop.stop_id}
                latitude={stop.latitude}
                longitude={stop.longitude}
                anchor="center"
              >
                <div style={{
                  width: 16, height: 16, borderRadius: '50%',
                  background: isTerminal ? '#7c3aed' : '#64748b',
                  border: '2px solid white',
                  boxShadow: '0 1px 3px rgba(0,0,0,.3)',
                }} />
              </Marker>
            )
          })}

          {/* Live bus markers */}
          {Object.values(positions).map((bus) => {
            const isSelected = selectedVehicle === bus.vehicle_id
            const size = isSelected ? 40 : 32
            const color = busColor(bus.speed)
            return (
              <Marker
                key={bus.vehicle_id}
                latitude={bus.latitude}
                longitude={bus.longitude}
                anchor="center"
                onClick={() => setSelectedVehicle(
                  selectedVehicle === bus.vehicle_id ? null : bus.vehicle_id
                )}
              >
                <div style={{
                  width: size, height: size, borderRadius: '50%', background: color,
                  border: '3px solid white', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 18, opacity: isSelected ? 1 : 0.85,
                  boxShadow: '0 2px 6px rgba(0,0,0,.3)', cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}>
                  🚌
                </div>
              </Marker>
            )
          })}

          {/* Popup for selected vehicle */}
          {selectedVehicle && positions[selectedVehicle] && (
            <Popup
              latitude={positions[selectedVehicle].latitude}
              longitude={positions[selectedVehicle].longitude}
              onClose={() => setSelectedVehicle(null)}
              closeButton
            >
              <div className="text-xs min-w-[160px]">
                <p className="font-bold text-sm mb-1">🚌 {t('liveTracking.popup.busDetails')}</p>
                <p><span className="text-gray-500">ID:</span> {positions[selectedVehicle].vehicle_id.slice(0, 12)}…</p>
                <p><span className="text-gray-500">{t('liveTracking.popup.speed')}:</span> {positions[selectedVehicle].speed.toFixed(1)} km/h</p>
                <p><span className="text-gray-500">{t('liveTracking.popup.heading')}:</span> {positions[selectedVehicle].heading.toFixed(0)}°</p>
                <p><span className="text-gray-500">{t('liveTracking.popup.updated')}:</span> {fmtDate(positions[selectedVehicle].timestamp)}</p>
                {positions[selectedVehicle].trip_id && (
                  <p><span className="text-gray-500">{t('liveTracking.popup.trip')}:</span> {positions[selectedVehicle].trip_id!.slice(0, 8)}</p>
                )}
              </div>
            </Popup>
          )}
        </Map>

        {/* Map legend */}
        <div className="absolute bottom-4 right-4 z-[1000] rounded-xl bg-white/90 p-3 shadow-lg backdrop-blur-sm dark:bg-gray-900/90 text-xs space-y-1">
          <p className="font-semibold text-gray-700 dark:text-white mb-1">{t('liveTracking.legend.title')}</p>
          <div className="flex items-center gap-2"><span className="text-green-600">●</span> {t('liveTracking.legend.normal')}</div>
          <div className="flex items-center gap-2"><span className="text-yellow-500">●</span> {t('liveTracking.legend.medium')}</div>
          <div className="flex items-center gap-2"><span className="text-red-500">●</span> {t('liveTracking.legend.high')}</div>
          <div className="flex items-center gap-2"><span className="text-purple-600">●</span> {t('liveTracking.legend.terminal')}</div>
          <div className="flex items-center gap-2 text-indigo-500">— — Route polyline</div>
        </div>

        {/* Top-right: bus count chip */}
        <div className="absolute top-4 right-4 z-[1000] flex items-center gap-2 rounded-full bg-white px-3 py-1.5 shadow-md dark:bg-gray-800">
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs font-semibold text-gray-700 dark:text-white">
            {Object.keys(positions).length} live
          </span>
        </div>
      </div>
    </div>
  )
}
