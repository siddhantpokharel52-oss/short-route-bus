import apiClient, { ApiResponse } from './api'

export interface Trip {
  id: string
  route_id: string
  route_number: string
  route_name: string
  vehicle_id: string
  vehicle_plate: string
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

    get: async (id: string): Promise<Trip> => {
      const { data } = await apiClient.get<ApiResponse<Trip>>(`/scheduling/trips/${id}/`)
      return data.data
    },

    create: async (payload: Partial<Trip>): Promise<Trip> => {
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
