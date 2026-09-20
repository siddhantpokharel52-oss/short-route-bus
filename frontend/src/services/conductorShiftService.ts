import apiClient, { ApiResponse } from './api'

export interface ConductorShift {
  id: string
  conductor_user_id: string
  vehicle_id: string | null
  date: string
  opening_float: string
  opened_at: string
  closed_at: string | null
  declared_cash: string | null
  system_cash_total: string | null
  variance: string | null
  closed_by_id: string | null
  notes: string
  status: 'OPEN' | 'CLOSED'
}

const conductorShiftService = {
  current: async (): Promise<ConductorShift | null> => {
    const { data } = await apiClient.get<ApiResponse<ConductorShift | null>>('/operator/shifts/current/')
    return data.data
  },

  open: async (opening_float = 0): Promise<ConductorShift> => {
    const { data } = await apiClient.post<ApiResponse<ConductorShift>>('/operator/shifts/', { opening_float })
    return data.data
  },

  close: async (id: string, declared_cash: number, notes = ''): Promise<ConductorShift> => {
    const { data } = await apiClient.post<ApiResponse<ConductorShift>>(`/operator/shifts/${id}/close/`, {
      declared_cash,
      notes,
    })
    return data.data
  },

  list: async (): Promise<ConductorShift[]> => {
    const { data } = await apiClient.get<ApiResponse<ConductorShift[] | { results: ConductorShift[] }>>('/operator/shifts/')
    const payload = data.data as { results?: ConductorShift[] } | ConductorShift[] | null
    return (Array.isArray(payload) ? payload : payload?.results) ?? []
  },
}

export default conductorShiftService
