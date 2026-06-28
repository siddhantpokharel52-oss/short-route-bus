/**
 * Live bus tracking map using MapLibre GL via react-map-gl.
 * Receives vehicle positions via WebSocket and renders markers.
 * Supports per-vehicle-type coloured icons and route enrichment.
 */
import { useEffect, useRef, useState } from 'react'
import MapGL, { Marker, Popup } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BAATO_STYLE_URL } from '@/config/baato'
import { ReconnectingWebSocket, fleetWsUrl } from '@utils/websocket'
import { Bus } from 'lucide-react'

// Vehicle type → colour mapping
const TYPE_COLORS: Record<string, { bg: string; label: string; emoji: string }> = {
  BUS:          { bg: '#2563eb', label: 'Bus',          emoji: '🚌' },
  MICROBUS:     { bg: '#ea580c', label: 'Microbus',     emoji: '🚐' },
  MINIBUS:      { bg: '#7c3aed', label: 'Minibus',      emoji: '🚌' },
  TEMPO:        { bg: '#16a34a', label: 'Tempo',        emoji: '🛺' },
  ELECTRIC_BUS: { bg: '#0891b2', label: 'Electric Bus', emoji: '⚡🚌' },
}

export interface TenantVehicle {
  id: string
  registration_no: string
  vehicle_type: string
  status: string
  route_code: string | null
  route_name: string | null
  gps_device_id: string
  make: string
  model: string
  capacity_seated: number
}

interface VehiclePosition {
  vehicle_id: string
  plate_number: string
  route_number: string
  latitude: number
  longitude: number
  speed: number
  heading: number
  last_updated: string
}

interface LiveMapProps {
  tenantSlug?: string
  vehiclesMeta?: TenantVehicle[]
  initialPositions?: VehiclePosition[]
  center?: [number, number]
  zoom?: number
  height?: string
}

// Kathmandu Valley center [lat, lng]
const KATHMANDU_CENTER: [number, number] = [27.7172, 85.3240]

export function LiveMap({
  tenantSlug,
  vehiclesMeta = [],
  initialPositions = [],
  center = KATHMANDU_CENTER,
  zoom = 12,
  height = '400px',
}: LiveMapProps) {
  const [vehicles, setVehicles] = useState<Map<string, VehiclePosition>>(
    new Map(initialPositions.map((v) => [v.vehicle_id, v]))
  )
  const [openVehicleId, setOpenVehicleId] = useState<string | null>(null)
  const wsRef = useRef<ReconnectingWebSocket | null>(null)

  const metaMap = new Map(vehiclesMeta.map((v) => [v.gps_device_id, v]))

  useEffect(() => {
    if (!tenantSlug) return
    wsRef.current = new ReconnectingWebSocket(fleetWsUrl(tenantSlug), {
      onMessage: (data) => {
        const gps = data as VehiclePosition
        if (gps.vehicle_id) {
          setVehicles((prev) => new Map(prev).set(gps.vehicle_id, gps))
        }
      },
    })
    return () => wsRef.current?.close()
  }, [tenantSlug])

  const vehicleList = Array.from(vehicles.values())
  const openVehicle = openVehicleId ? vehicles.get(openVehicleId) : undefined

  return (
    <div className="relative overflow-hidden rounded-xl" style={{ height }}>
      <MapGL
        initialViewState={{ latitude: center[0], longitude: center[1], zoom }}
        style={{ height: '100%', width: '100%' }}
        mapStyle={BAATO_STYLE_URL}
      >
        {vehicleList.map((v) => {
          const meta = metaMap.get(v.vehicle_id)
          const vehicleType = meta?.vehicle_type ?? 'BUS'
          const { bg, emoji } = TYPE_COLORS[vehicleType] ?? TYPE_COLORS.BUS
          return (
            <Marker key={v.vehicle_id} latitude={v.latitude} longitude={v.longitude} anchor="center">
              <div
                onClick={(e) => {
                  e.stopPropagation()
                  setOpenVehicleId(v.vehicle_id === openVehicleId ? null : v.vehicle_id)
                }}
                style={{
                  width: 34, height: 34, borderRadius: '50%', background: bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 2px 6px rgba(0,0,0,.35)', fontSize: 15, lineHeight: 1,
                  cursor: 'pointer',
                }}
              >
                {emoji}
              </div>
            </Marker>
          )
        })}

        {openVehicle && (() => {
          const meta = metaMap.get(openVehicle.vehicle_id)
          const vehicleType = meta?.vehicle_type ?? 'BUS'
          const { label } = TYPE_COLORS[vehicleType] ?? TYPE_COLORS.BUS
          return (
            <Popup
              latitude={openVehicle.latitude}
              longitude={openVehicle.longitude}
              onClose={() => setOpenVehicleId(null)}
              closeButton
            >
              <div className="min-w-[160px] text-sm">
                <p className="font-bold text-gray-900">
                  {meta?.registration_no ?? openVehicle.plate_number}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                <div className="mt-2 space-y-1 text-xs text-gray-700">
                  <p>🛣️ Route: <strong>{meta?.route_code ?? openVehicle.route_number ?? '—'}</strong></p>
                  {meta?.route_name && <p className="text-gray-500">{meta.route_name}</p>}
                  <p>⚡ Speed: <strong>{openVehicle.speed} km/h</strong></p>
                  {meta && <p>💺 Capacity: {meta.capacity_seated} seats</p>}
                  <p className="text-gray-400 text-[10px] mt-1">
                    Updated {new Date(openVehicle.last_updated).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </Popup>
          )
        })()}
      </MapGL>

      {/* Vehicle count overlay */}
      <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2 rounded-lg bg-white/90 px-3 py-2 shadow-md backdrop-blur-sm">
        <Bus className="h-4 w-4 text-primary-600" />
        <span className="text-sm font-medium">{vehicleList.length} vehicles live</span>
      </div>

      {/* Legend */}
      {vehicleList.length > 0 && (
        <div className="absolute bottom-4 right-4 z-10 rounded-lg bg-white/90 px-3 py-2 shadow-md backdrop-blur-sm space-y-1">
          {Object.entries(TYPE_COLORS).map(([type, { bg, label, emoji }]) => {
            const count = vehicleList.filter((v) => {
              const meta = metaMap.get(v.vehicle_id)
              return (meta?.vehicle_type ?? 'BUS') === type
            }).length
            if (count === 0) return null
            return (
              <div key={type} className="flex items-center gap-2 text-xs">
                <span style={{ background: bg }} className="h-3 w-3 rounded-full inline-block" />
                <span>{emoji} {label} ({count})</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
