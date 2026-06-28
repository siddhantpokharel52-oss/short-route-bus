/**
 * Live GPS tracking service.
 * HTTP calls go to Django (scheduling app) which reads Redis.
 * WebSocket connects to FastAPI (/api/v1/live/ws/vehicles/{tenant_slug}/).
 */
import apiClient, { ApiResponse } from './api'
import { useAuthStore } from '@store/authStore'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VehiclePosition {
  vehicle_id: string
  tenant_slug: string
  latitude: number
  longitude: number
  speed: number
  heading: number
  timestamp: string
  trip_id?: string | null
}

export interface RoutePolyline {
  route_id: string
  route_code: string
  name: string
  distance_km: number
  coordinates: RouteStopCoord[]
  total_stops: number
  mapped_stops: number
}

export interface RouteStopCoord {
  sequence_no: number
  stop_id: string
  stop_code: string
  name: string
  latitude: number
  longitude: number
  estimated_time_from_start: number
}

export interface ETAStop {
  stop_id: string
  stop_code: string
  stop_name: string
  sequence_no: number
  latitude: number
  longitude: number
  estimated_time_from_start: number
  eta_minutes: number | null
  status: 'ARRIVED' | 'UPCOMING' | 'UNKNOWN'
  nearest_bus_id: string | null
  distance_m: number | null
}

export interface HeadwayBus {
  vehicle_id: string
  latitude: number
  longitude: number
  speed_kmh: number
  heading: number
  progress_pct: number
  timestamp: string
  gap_ahead_minutes: number | null
  gap_ahead_km: number | null
  bunching_alert: boolean
}

export interface HeadwayData {
  buses: HeadwayBus[]
  alerts: Array<{
    type: string
    vehicle_id: string
    ahead_vehicle_id: string
    gap_minutes: number
    message: string
  }>
  total_buses: number
}

export interface PlaybackData {
  vehicle_id: string
  positions: VehiclePosition[]
  count: number
}

// ─── HTTP endpoints ────────────────────────────────────────────────────────────

const trackingService = {
  /** Snapshot of all tracked vehicle positions (from Redis via Django). */
  getLivePositions: async (): Promise<VehiclePosition[]> => {
    const { data } = await apiClient.get<ApiResponse<VehiclePosition[]>>(
      '/scheduling/live-positions/'
    )
    return Array.isArray(data.data) ? data.data : []
  },

  /** Route polyline (ordered stop coordinates) for map rendering. */
  getRoutePolyline: async (routeId: string): Promise<RoutePolyline> => {
    const { data } = await apiClient.get<ApiResponse<RoutePolyline>>(
      `/scheduling/routes/${routeId}/polyline/`
    )
    return data.data
  },

  /** ETA for all stops on a route based on nearest bus position. */
  getETA: async (routeId: string): Promise<ETAStop[]> => {
    const { data } = await apiClient.get<ApiResponse<ETAStop[]>>(
      `/scheduling/eta/?route_id=${routeId}`
    )
    return Array.isArray(data.data) ? data.data : []
  },

  /** Bus headway (spacing) for a route. */
  getHeadway: async (routeId: string): Promise<HeadwayData> => {
    const { data } = await apiClient.get<ApiResponse<HeadwayData>>(
      `/scheduling/headway/?route_id=${routeId}`
    )
    return data.data
  },

  /** Historical GPS playback for a vehicle (stored in Redis time-series). */
  getPlayback: async (vehicleId: string): Promise<PlaybackData> => {
    const { data } = await apiClient.get<ApiResponse<PlaybackData>>(
      `/scheduling/playback/?vehicle_id=${vehicleId}`
    )
    return data.data
  },

  /**
   * Simulate GPS positions for testing.
   * Useful when no real GPS hardware is available.
   */
  simulate: async (tenantSlug: string, vehicleIds: string[]): Promise<void> => {
    await apiClient.post('/scheduling/live-positions/', { tenant_slug: tenantSlug, vehicle_ids: vehicleIds })
  },
}

// ─── WebSocket helper ──────────────────────────────────────────────────────────

export type WSPositionCallback = (pos: VehiclePosition) => void

/**
 * Opens a WebSocket to the FastAPI GPS server for real-time bus positions.
 * URL: ws://<host>/api/v1/live/ws/vehicles/{tenantSlug}/
 * Returns a cleanup function to close the socket.
 */
export function subscribeToLivePositions(
  tenantSlug: string,
  onPosition: WSPositionCallback,
  onAlert?: (alert: unknown) => void,
): () => void {
  const token = useAuthStore.getState().accessToken
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  const url = `${proto}//${host}/api/v1/live/ws/vehicles/${tenantSlug}/?token=${token}`

  let ws: WebSocket | null = null
  let closed = false
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null

  function connect() {
    if (closed) return
    ws = new WebSocket(url)

    ws.onopen = () => {
      console.log('[LiveTracking] WebSocket connected')
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'alert' && onAlert) {
          onAlert(msg.data)
        } else if (msg.vehicle_id) {
          onPosition(msg as VehiclePosition)
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      if (!closed) {
        // Auto-reconnect after 5 seconds
        reconnectTimeout = setTimeout(connect, 5000)
      }
    }

    ws.onerror = (err) => {
      console.warn('[LiveTracking] WebSocket error, will reconnect', err)
      ws?.close()
    }
  }

  connect()

  return () => {
    closed = true
    if (reconnectTimeout) clearTimeout(reconnectTimeout)
    ws?.close()
  }
}

export default trackingService
