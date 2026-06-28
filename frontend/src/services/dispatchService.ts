/**
 * Dispatcher service — daily allocations, schedule generation, dispatch actions.
 * All calls go to Django /api/v1/dispatch/ and /api/v1/scheduling/.
 */
import apiClient, { ApiResponse } from './api'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DailyAllocation {
  id: string
  date: string
  route_id: string
  route_name: string
  vehicle_id: string
  vehicle_registration: string
  driver_id: string | null
  driver_name: string | null
  conductor_id: string | null
  shift_start: string
  shift_end: string
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  notes: string
  created_at: string
  created_by_id: string | null
}

export interface AllocationCreatePayload {
  date: string
  route_id: string
  vehicle_id: string
  driver_id?: string | null
  conductor_id?: string | null
  shift_start?: string
  shift_end?: string
  notes?: string
}

export interface DispatchLog {
  id: string
  allocation: string | null
  action_type: string
  vehicle_id: string | null
  route_id: string | null
  trip_id: string | null
  performed_by_id: string | null
  notes: string
  timestamp: string
  metadata: Record<string, unknown>
}

export interface GenerateSchedulePayload {
  route_id: string
  date: string
  vehicle_ids: string[]
  operating_start?: string
  operating_end?: string
  headway_minutes?: number
  trip_duration_minutes?: number
  layover_minutes?: number
}

export interface GenerateScheduleResult {
  trips_created: number
  allocations_created: number
  trips: Array<{
    trip_id: string
    trip_code: string
    vehicle_id: string
    scheduled_departure: string
    scheduled_arrival: string
  }>
}

export interface TodayStats {
  date: string
  total_trips: number
  scheduled: number
  in_progress: number
  completed: number
  cancelled: number
  delayed: number
  active_vehicles: number
  active_routes: number
}

export interface TodayDashboard {
  stats: TodayStats
  trips: TodayTrip[]
  alerts: unknown[]
}

export interface TodayTrip {
  id: string
  trip_code: string
  vehicle_id: string
  vehicle_registration: string | null
  vehicle_bus_number: string | null
  route_id: string
  route_name: string | null
  date: string
  scheduled_departure: string | null
  scheduled_arrival: string | null
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'DELAYED'
  actual_departure: string | null
  actual_arrival: string | null
  delay_reason: string | null
  delay_minutes: number | null
}

// ─── Service ──────────────────────────────────────────────────────────────────

const dispatchService = {
  // ── Today's dashboard ───────────────────────────────────────────────────────
  getTodayDashboard: async (): Promise<TodayDashboard> => {
    const { data } = await apiClient.get<ApiResponse<TodayDashboard>>(
      '/scheduling/today-dashboard/'
    )
    return data.data
  },

  // ── Daily allocations ────────────────────────────────────────────────────────
  getAllocations: async (date?: string): Promise<DailyAllocation[]> => {
    const params = date ? `?date=${date}` : ''
    const { data } = await apiClient.get<ApiResponse<{ results?: DailyAllocation[]; count?: number } | DailyAllocation[]>>(
      `/dispatch/allocations/${params}`
    )
    if (Array.isArray(data.data)) return data.data
    const d = data.data as { results?: DailyAllocation[] }
    return d.results ?? []
  },

  getTodayAllocations: async (): Promise<DailyAllocation[]> => {
    const { data } = await apiClient.get<ApiResponse<DailyAllocation[]>>(
      '/dispatch/allocations/today/'
    )
    return Array.isArray(data.data) ? data.data : []
  },

  createAllocation: async (payload: AllocationCreatePayload): Promise<DailyAllocation> => {
    const { data } = await apiClient.post<ApiResponse<DailyAllocation>>(
      '/dispatch/allocations/',
      payload
    )
    if (!data.success) throw new Error(data.message)
    return data.data
  },

  // ── Dispatcher actions ───────────────────────────────────────────────────────
  breakdown: async (allocationId: string, reason: string): Promise<void> => {
    const { data } = await apiClient.post<ApiResponse<null>>(
      `/dispatch/allocations/${allocationId}/breakdown/`,
      { reason }
    )
    if (!data.success) throw new Error(data.message)
  },

  reassign: async (allocationId: string, replacementVehicleId: string, driverId?: string): Promise<DailyAllocation> => {
    const { data } = await apiClient.post<ApiResponse<DailyAllocation>>(
      `/dispatch/allocations/${allocationId}/reassign/`,
      { replacement_vehicle_id: replacementVehicleId, driver_id: driverId }
    )
    if (!data.success) throw new Error(data.message)
    return data.data
  },

  remove: async (allocationId: string, reason?: string): Promise<void> => {
    const { data } = await apiClient.post<ApiResponse<null>>(
      `/dispatch/allocations/${allocationId}/remove/`,
      { reason: reason ?? 'Removed by dispatcher' }
    )
    if (!data.success) throw new Error(data.message)
  },

  // ── Schedule generation ──────────────────────────────────────────────────────
  generateSchedule: async (payload: GenerateSchedulePayload): Promise<GenerateScheduleResult> => {
    const { data } = await apiClient.post<ApiResponse<GenerateScheduleResult>>(
      '/dispatch/generate-schedule/',
      payload
    )
    if (!data.success) throw new Error(data.message)
    return data.data
  },

  // ── Trip actions ─────────────────────────────────────────────────────────────
  startTrip: async (tripId: string): Promise<void> => {
    const { data } = await apiClient.post<ApiResponse<null>>(
      `/scheduling/trips/${tripId}/start/`
    )
    if (!data.success) throw new Error(data.message)
  },

  completeTrip: async (tripId: string): Promise<void> => {
    const { data } = await apiClient.post<ApiResponse<null>>(
      `/scheduling/trips/${tripId}/complete/`
    )
    if (!data.success) throw new Error(data.message)
  },

  cancelTrip: async (tripId: string, reason: string): Promise<void> => {
    const { data } = await apiClient.post<ApiResponse<null>>(
      `/scheduling/trips/${tripId}/cancel/`,
      { reason }
    )
    if (!data.success) throw new Error(data.message)
  },

  // ── Allocation CRUD ──────────────────────────────────────────────────────────
  updateAllocation: async (
    id: string,
    data: Partial<AllocationCreatePayload> & {
      status?: DailyAllocation['status']
      notes?: string
    }
  ): Promise<DailyAllocation> => {
    const { data: res } = await apiClient.patch<ApiResponse<DailyAllocation>>(
      `/dispatch/allocations/${id}/`,
      data
    )
    if (!res.success) throw new Error(res.message)
    return res.data
  },

  deleteAllocation: async (id: string): Promise<void> => {
    await apiClient.delete(`/dispatch/allocations/${id}/`)
  },

  delayTrip: async (tripId: string, reason: string, delayMinutes?: number): Promise<void> => {
    const { data } = await apiClient.post<ApiResponse<null>>(
      `/scheduling/trips/${tripId}/delay/`,
      { reason, delay_minutes: delayMinutes ?? null }
    )
    if (!data.success) throw new Error(data.message)
  },

  // ── Dispatch logs ────────────────────────────────────────────────────────────
  getLogs: async (date?: string): Promise<DispatchLog[]> => {
    const params = date ? `?date=${date}` : ''
    const { data } = await apiClient.get<ApiResponse<DispatchLog[]>>(
      `/dispatch/logs/${params}`
    )
    return Array.isArray(data.data) ? data.data : []
  },
}

export default dispatchService
