/**
 * Public API service — no auth required.
 * Calls FastAPI public_api microservice at /public-api/
 */
import axios from 'axios'

const publicClient = axios.create({
  baseURL: '/public-api/v1',
  timeout: 15000,
})

export interface Stop {
  id: string
  name_en: string
  name_ne: string
  latitude: number
  longitude: number
  is_terminal: boolean
  is_active: boolean
  district: string
  ward_number: number | null
  amenities: string[]
}

export interface Route {
  id: string
  route_number: string
  name_en: string
  name_ne: string
  start_stop: Stop
  end_stop: Stop
  total_distance_km: number
  estimated_duration_minutes: number
  stops: Stop[]
  operated_by: string[]
  base_fare: number
}

export interface LiveVehicle {
  vehicle_id: string
  plate_number: string
  route_number: string
  latitude: number
  longitude: number
  speed: number
  heading: number
  passenger_count: number
  last_updated: string
}

export interface Arrival {
  vehicle_id: string
  plate_number: string
  route_number: string
  route_name: string
  eta_minutes: number
  current_lat: number
  current_lng: number
}

export interface FareInfo {
  from_stop: string
  to_stop: string
  distance_km: number
  adult_fare: number
  student_fare: number
  senior_fare: number
  differently_abled_fare: number
  peak_hour_surcharge: number
}

// Mirrors _serialize_fare() in backend/fastapi_services/public_api/router.py --
// the real shape GET /public-api/v1/fares/ actually returns (see fareForStops).
export interface FareMatch {
  id: string
  route_id: string | null
  zone_from: string | null
  zone_to: string | null
  base_fare: number
  peak_fare: number
  student_fare: number
  senior_citizen_fare: number
  ticket_type_id: string
  ticket_type_code: string
  ticket_type_name: string
  distance_km: number | null
  time_minutes: number | null
}

const publicService = {
  routes: {
    list: async (params?: Record<string, string>): Promise<Route[]> => {
      const { data } = await publicClient.get('/routes/', { params })
      // FastAPI returns { success, data: [...] }; DRF returns { results: [...] } or array
      const arr = data?.data ?? data?.results ?? data
      return Array.isArray(arr) ? arr : []
    },

    get: async (routeNumber: string): Promise<Route> => {
      const { data } = await publicClient.get(`/routes/${routeNumber}/`)
      return data?.data ?? data
    },

    stops: async (routeNumber: string): Promise<Stop[]> => {
      const { data } = await publicClient.get(`/routes/${routeNumber}/stops/`)
      const arr = data?.data ?? data?.results ?? data
      return Array.isArray(arr) ? arr : []
    },
  },

  stops: {
    list: async (params?: Record<string, string>): Promise<Stop[]> => {
      const { data } = await publicClient.get('/stops/', { params })
      const arr = data?.data ?? data?.results ?? data
      return Array.isArray(arr) ? arr : []
    },

    arrivals: async (stopId: string): Promise<Arrival[]> => {
      const { data } = await publicClient.get(`/stops/${stopId}/arrivals/`)
      const arr = data?.data?.arrivals ?? data?.data ?? data
      return Array.isArray(arr) ? arr : []
    },
  },

  liveVehicles: async (routeNumber?: string): Promise<LiveVehicle[]> => {
    const params = routeNumber ? { route: routeNumber } : undefined
    // FastAPI serves live vehicles at /vehicles/live/
    const { data } = await publicClient.get('/vehicles/live/', { params })
    const arr = data?.data ?? data
    return Array.isArray(arr) ? arr : []
  },

  fares: async (fromStopId: string, toStopId: string): Promise<FareInfo> => {
    const { data } = await publicClient.get('/fares/', {
      params: { from_stop: fromStopId, to_stop: toStopId },
    })
    return data
  },

  // GET /public-api/v1/fares/ actually takes stop_code (not the stop's UUID
  // id) for from_stop/to_stop, and returns { success, data: FareMatch[] } --
  // one entry per ticket type priced on that route/pair. Matching is already
  // direction-agnostic server-side (A->B and B->A resolve to the same row),
  // so there's no need to try both orders here.
  fareForStops: async (routeId: string, fromStopCode: string, toStopCode: string): Promise<FareMatch[]> => {
    const { data } = await publicClient.get('/fares/', {
      params: { route_id: routeId, from_stop: fromStopCode, to_stop: toStopCode },
    })
    return Array.isArray(data?.data) ? data.data : []
  },

  verifyTicket: async (ticketNumber: string): Promise<{
    is_valid: boolean
    status: string
    passenger_name: string
    route: string
    fare: number
    issued_at: string
  }> => {
    const { data } = await publicClient.get(`/tickets/verify/${ticketNumber}/`)
    return data
  },
}

export default publicService
