import apiClient, { ApiResponse } from './api'

export interface Owner {
  id: string
  name: string
  phone: string
  email: string
  bank_account_no: string
  profile_photo: string | null
  citizenship_photo: string | null
  citizenship_photo_flagged_at: string | null
  user_id: string | null
  temp_password: string
  is_active: boolean
  is_activated: boolean
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

  create: async (payload: OwnerPayload, citizenshipPhotoFile?: File | null): Promise<Owner> => {
    if (!citizenshipPhotoFile) {
      const { data } = await apiClient.post('/fleet/owners/', payload)
      return (data as ApiResponse<Owner>).data ?? data
    }
    const fd = new FormData()
    Object.entries(payload).forEach(([key, value]) => fd.append(key, value == null ? '' : String(value)))
    fd.append('citizenship_photo', citizenshipPhotoFile)
    const { data } = await apiClient.post('/fleet/owners/', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    return (data as ApiResponse<Owner>).data ?? data
  },

  update: async (id: string, payload: OwnerPayload, citizenshipPhotoFile?: File | null): Promise<Owner> => {
    if (!citizenshipPhotoFile) {
      const { data } = await apiClient.patch(`/fleet/owners/${id}/`, payload)
      return (data as ApiResponse<Owner>).data ?? data
    }
    const fd = new FormData()
    Object.entries(payload).forEach(([key, value]) => fd.append(key, value == null ? '' : String(value)))
    fd.append('citizenship_photo', citizenshipPhotoFile)
    const { data } = await apiClient.patch(`/fleet/owners/${id}/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    return (data as ApiResponse<Owner>).data ?? data
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/fleet/owners/${id}/`)
  },

  acknowledgeCitizenship: async (id: string): Promise<Owner> => {
    const { data } = await apiClient.post<ApiResponse<Owner>>(`/fleet/owners/${id}/acknowledge-citizenship/`)
    return data.data
  },

  getMyProfile: async (): Promise<Owner> => {
    const { data } = await apiClient.get<ApiResponse<Owner>>('/fleet/owners/me/')
    return data.data
  },

  updateMyProfile: async (
    payload: Partial<Pick<Owner, 'name' | 'phone' | 'email' | 'bank_account_no'>>,
    photoFile?: File | null,
    citizenshipPhotoFile?: File | null,
  ): Promise<Owner> => {
    if (!photoFile && !citizenshipPhotoFile) {
      const { data } = await apiClient.patch<ApiResponse<Owner>>('/fleet/owners/me/', payload)
      return data.data
    }
    const fd = new FormData()
    Object.entries(payload).forEach(([key, value]) => fd.append(key, value ?? ''))
    if (photoFile) fd.append('profile_photo', photoFile)
    // Presence of this key alone is what the backend reads to flag the
    // change for the tenant admin -- see OwnerViewSet.me().
    if (citizenshipPhotoFile) fd.append('citizenship_photo', citizenshipPhotoFile)
    const { data } = await apiClient.patch<ApiResponse<Owner>>('/fleet/owners/me/', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data.data
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
