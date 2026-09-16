import apiClient, { ApiResponse } from './api'

export interface VehicleCategory {
  id: string
  code: string
  name_en: string
  name_ne: string
  seating_capacity: number
  body_class: 'MICRO' | 'MINI' | 'STANDARD' | 'DELUXE'
  air_conditioned: boolean
  fuel_type: 'DIESEL' | 'PETROL' | 'CNG' | 'ELECTRIC' | 'HYBRID'
  permit_class: string
  attributes: Record<string, unknown>
  is_active: boolean
  vehicle_count: number
  created_at: string
  updated_at: string
}

export type VehicleCategoryPayload = Partial<Omit<VehicleCategory, 'id' | 'vehicle_count' | 'created_at' | 'updated_at'>>

const vehicleCategoryService = {
  list: async (params?: Record<string, string>): Promise<VehicleCategory[]> => {
    const { data } = await apiClient.get<ApiResponse<VehicleCategory[]>>('/fleet/categories/', { params })
    return Array.isArray(data.data) ? data.data : []
  },

  create: async (payload: VehicleCategoryPayload): Promise<VehicleCategory> => {
    // DRF default create() returns raw serializer data, no success envelope.
    const { data } = await apiClient.post('/fleet/categories/', payload)
    return (data as ApiResponse<VehicleCategory>).data ?? data
  },

  update: async (id: string, payload: VehicleCategoryPayload): Promise<VehicleCategory> => {
    const { data } = await apiClient.patch(`/fleet/categories/${id}/`, payload)
    return (data as ApiResponse<VehicleCategory>).data ?? data
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/fleet/categories/${id}/`)
  },
}

export default vehicleCategoryService
