import apiClient, { ApiResponse } from './api'

// The real shape TripSerializer returns (backend/apps/scheduling/serializers.py)
// -- deliberately separate from the Trip interface below, whose route_number/
// vehicle_plate/driver_name/conductor_name/passenger_count fields the backend
// never actually sends (pre-existing mismatch, not introduced here).
export interface MyTrip {
  id: string
  trip_code: string
  route_id: string
  route_name: string | null
  vehicle_id: string
  vehicle_registration: string | null
  vehicle_bus_number: string | null
  conductor_id: string | null
  scheduled_departure: string | null
  scheduled_arrival: string | null
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'DELAYED'
}

export interface Trip {
  id: string
  route_id: string
  route_number: string
  route_name: string
  vehicle_id: string
  vehicle_plate: string
  vehicle_registration: string | null
  vehicle_bus_number: string | null
  driver_id: string
  driver_name: string
  conductor_id: string | null
  conductor_name: string | null
  scheduled_departure: string
  scheduled_arrival: string
  actual_departure: string | null
  actual_arrival: string | null
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'DELAYED'
  cancellation_reason: string | null
  passenger_count: number
  created_at: string
}

// Writable fields TripSerializer.create() actually accepts -- trip_code is
// server-generated (see TripSerializer.create() in
// backend/apps/scheduling/serializers.py), and date/scheduled_*_time are the
// real schedule fields (scheduled_departure/scheduled_arrival on Trip above
// are read-only SerializerMethodFields).
export interface CreateTripPayload {
  route_id: string
  vehicle_id: string
  driver_id: string
  conductor_id?: string
  date: string
  scheduled_departure_time: string
  scheduled_arrival_time: string
}

export interface Timetable {
  id: string
  route_id: string
  name: string
  is_active: boolean
  effective_from: string
  effective_until: string | null
  created_at: string
}

const schedulingService = {
  trips: {
    list: async (params?: Record<string, string>): Promise<ApiResponse<{ results: Trip[] }>> => {
      const { data } = await apiClient.get('/scheduling/trips/', { params })
      return data
    },

    today: async (): Promise<Trip[]> => {
      const { data } = await apiClient.get<ApiResponse<Trip[]>>('/scheduling/trips/today/')
      return data.data
    },

    // Conductor's own trip(s) for today -- IsConductor-gated, 403s for any
    // other role. The only way a conductor can discover the trip_id that
    // GET /public-api/v1/trips/{id}/qr/ needs.
    mine: async (): Promise<MyTrip[]> => {
      const { data } = await apiClient.get<ApiResponse<MyTrip[]>>('/scheduling/trips/mine/')
      return data.data
    },

    get: async (id: string): Promise<Trip> => {
      const { data } = await apiClient.get<ApiResponse<Trip>>(`/scheduling/trips/${id}/`)
      return data.data
    },

    create: async (payload: CreateTripPayload): Promise<Trip> => {
      const { data } = await apiClient.post<ApiResponse<Trip>>('/scheduling/trips/', payload)
      if (!data.success) throw new Error(data.message)
      return data.data
    },

    start: async (id: string): Promise<Trip> => {
      const { data } = await apiClient.post<ApiResponse<Trip>>(`/scheduling/trips/${id}/start/`)
      if (!data.success) throw new Error(data.message)
      return data.data
    },

    complete: async (id: string, passengerCount: number): Promise<Trip> => {
      const { data } = await apiClient.post<ApiResponse<Trip>>(
        `/scheduling/trips/${id}/complete/`,
        { passenger_count: passengerCount }
      )
      if (!data.success) throw new Error(data.message)
      return data.data
    },

    cancel: async (id: string, reason: string): Promise<Trip> => {
      const { data } = await apiClient.post<ApiResponse<Trip>>(
        `/scheduling/trips/${id}/cancel/`,
        { reason }
      )
      if (!data.success) throw new Error(data.message)
      return data.data
    },
  },

  timetables: {
    list: async (): Promise<Timetable[]> => {
      const { data } = await apiClient.get('/scheduling/timetables/')
      // StandardResultsPagination wraps as { data: [...] }, not { data: { results: [...] } }
      return Array.isArray(data.data) ? data.data : (data.data?.results ?? [])
    },

    create: async (payload: Partial<Timetable>): Promise<Timetable> => {
      const { data } = await apiClient.post<ApiResponse<Timetable>>(
        '/scheduling/timetables/',
        payload
      )
      if (!data.success) throw new Error(data.message)
      return data.data
    },

    autoSchedule: async (routeId: string, date: string, dispatchTime: string): Promise<{ message: string }> => {
      // Backend fires a Celery task asynchronously — returns { data: null, message: "..." }
      const { data } = await apiClient.post(
        '/scheduling/auto-schedule/',
        { route_id: routeId, date, dispatch_time: dispatchTime }
      )
      if (!data.success) throw new Error(data.message)
      return { message: data.message as string }
    },
  },
}

export default schedulingService
