import apiClient, { ApiResponse } from './api'

export interface Owner {
  id: string
  name: string
  phone: string
  email: string
  user_id: string | null
  temp_password: string
  is_active: boolean
  vehicle_count: number
  created_at: string
}

export type OwnerPayload = Partial<Omit<Owner, 'id' | 'vehicle_count' | 'created_at' | 'temp_password'>>

export interface OwnerDashboardPerBus {
  vehicle_id: string
  bus_number: string
  rides: number
  revenue: number
}

export interface OwnerDashboardSplit {
  label: string
  revenue: number
}

export interface OwnerDashboardRoute {
  route_id: string
  route_code: string
  route_name: string | null
  revenue: number
}

export interface OwnerDashboardPeriod {
  rides: number
  revenue: number
}

export interface OwnerDashboardSummary {
  owner_name: string
  vehicle_count: number
  per_bus: OwnerDashboardPerBus[]
  cash_vs_online: OwnerDashboardSplit[]
  revenue_by_route: OwnerDashboardRoute[]
  today: OwnerDashboardPeriod
  this_week: OwnerDashboardPeriod
  this_month: OwnerDashboardPeriod
  cash_collected: number
  online_collected: number
}

export interface OwnerDashboardTrendPoint {
  date: string
  rides: number
  revenue: number
}

const ownerService = {
  list: async (params?: Record<string, string>): Promise<Owner[]> => {
    const { data } = await apiClient.get<ApiResponse<Owner[]>>('/fleet/owners/', { params })
    return Array.isArray(data.data) ? data.data : []
  },

  create: async (payload: OwnerPayload): Promise<Owner> => {
    const { data } = await apiClient.post('/fleet/owners/', payload)
    return (data as ApiResponse<Owner>).data ?? data
  },

  update: async (id: string, payload: OwnerPayload): Promise<Owner> => {
    const { data } = await apiClient.patch(`/fleet/owners/${id}/`, payload)
    return (data as ApiResponse<Owner>).data ?? data
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/fleet/owners/${id}/`)
  },

  dashboardSummary: async (): Promise<OwnerDashboardSummary> => {
    const { data } = await apiClient.get<ApiResponse<OwnerDashboardSummary>>('/analytics/owner/summary/')
    return data.data
  },

  dashboardTrend: async (days = 30): Promise<OwnerDashboardTrendPoint[]> => {
    const { data } = await apiClient.get<ApiResponse<OwnerDashboardTrendPoint[]>>('/analytics/owner/trend/', {
      params: { days },
    })
    return data.data ?? []
  },
}

export default ownerService
