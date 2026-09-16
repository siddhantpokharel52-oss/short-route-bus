import apiClient, { ApiResponse } from './api'

export interface Duty {
  id: string
  roster_period: string
  service_date: string
  route_id: string
  route_code: string
  route_name: string
  slot_index: number
  group: string | null
  group_code: string | null
  source: 'MANUAL' | 'GENERATED' | 'OVERRIDE' | 'RESERVE_FILL'
  locked: boolean
  overrides: DutyOverride[]
  substitutions: VehicleSubstitution[]
  created_at: string
  updated_at: string
}

export interface DutyOverride {
  id: string
  duty: string
  previous_group: string | null
  new_group: string | null
  reason: string
  actor_id: string | null
  created_at: string
}

export interface VehicleSubstitution {
  id: string
  duty: string
  out_vehicle: string
  in_vehicle: string
  reason: string
  actor_id: string | null
  created_at: string
}

export interface RosterPeriod {
  id: string
  start_date: string
  end_date: string
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED'
  version: number
  created_at: string
  updated_at: string
}

export interface Conflict {
  duty_id: string
  severity: 'hard' | 'soft'
  message: string
}

export interface RotationPolicy {
  id: string
  ring_step: number
  week_pattern: 'KEEP_ROTATING' | 'REPEAT_WEEK' | 'ROTATING_REPEAT'
  week_step: number
  epoch_date: string
  same_weekday_lookback_weeks: number
  route_cooldown_days: number
  created_at: string
  updated_at: string
}

const unwrapList = (data: unknown): unknown[] => {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && 'results' in (data as Record<string, unknown>)) {
    return (data as { results: unknown[] }).results
  }
  return []
}

const rosterService = {
  listPeriods: async (): Promise<RosterPeriod[]> => {
    const { data } = await apiClient.get<ApiResponse<RosterPeriod[]>>('/roster/periods/')
    return unwrapList(data.data) as RosterPeriod[]
  },

  getPeriod: async (id: string): Promise<RosterPeriod> => {
    const { data } = await apiClient.get(`/roster/periods/${id}/`)
    return (data as ApiResponse<RosterPeriod>).data ?? data
  },

  createPeriod: async (payload: { start_date: string; end_date: string }): Promise<RosterPeriod> => {
    const { data } = await apiClient.post('/roster/periods/', payload)
    return (data as ApiResponse<RosterPeriod>).data ?? data
  },

  publishPeriod: async (id: string): Promise<RosterPeriod> => {
    const { data } = await apiClient.post<ApiResponse<RosterPeriod>>(`/roster/periods/${id}/publish/`)
    return data.data
  },

  conflicts: async (periodId: string): Promise<Conflict[]> => {
    const { data } = await apiClient.get<ApiResponse<Conflict[]>>(`/roster/periods/${periodId}/conflicts/`)
    return data.data
  },

  listDuties: async (periodId: string): Promise<Duty[]> => {
    const { data } = await apiClient.get(`/roster/periods/${periodId}/duties/`)
    return unwrapList((data as ApiResponse<Duty[]>).data ?? data) as Duty[]
  },

  assignDuty: async (periodId: string, dutyId: string, group: string | null, reason?: string): Promise<Duty> => {
    const { data } = await apiClient.patch<ApiResponse<Duty>>(
      `/roster/periods/${periodId}/duties/${dutyId}/`,
      { group, reason }
    )
    return data.data
  },

  setDutyLock: async (periodId: string, dutyId: string, locked: boolean): Promise<Duty> => {
    const { data } = await apiClient.patch<ApiResponse<Duty>>(
      `/roster/periods/${periodId}/duties/${dutyId}/`,
      { locked }
    )
    return data.data
  },

  substituteVehicle: async (
    periodId: string, dutyId: string, outVehicle: string, inVehicle: string, reason: string
  ): Promise<Duty> => {
    const { data } = await apiClient.post<ApiResponse<Duty>>(
      `/roster/periods/${periodId}/duties/${dutyId}/substitute-vehicle/`,
      { out_vehicle: outVehicle, in_vehicle: inVehicle, reason }
    )
    return data.data
  },

  surge: async (periodId: string, serviceDate: string, routeId: string): Promise<Duty> => {
    const { data } = await apiClient.post<ApiResponse<Duty>>(
      `/roster/periods/${periodId}/duties/surge/`,
      { service_date: serviceDate, route_id: routeId }
    )
    return data.data
  },

  myDuties: async (): Promise<Duty[]> => {
    const { data } = await apiClient.get<ApiResponse<Duty[]>>('/roster/my-duties/')
    return data.data
  },

  getPolicy: async (): Promise<RotationPolicy> => {
    const { data } = await apiClient.get<ApiResponse<RotationPolicy>>('/roster/policy/')
    return data.data
  },

  savePolicy: async (payload: Partial<RotationPolicy>): Promise<RotationPolicy> => {
    const { data } = await apiClient.put<ApiResponse<RotationPolicy>>('/roster/policy/', payload)
    return data.data
  },

  rotate: async (periodId: string): Promise<{ updated: number; conflicts: Conflict[] }> => {
    const { data } = await apiClient.post<ApiResponse<{ updated: number; conflicts: Conflict[] }>>(
      `/roster/periods/${periodId}/rotate/`
    )
    return data.data
  },
}

export default rosterService
