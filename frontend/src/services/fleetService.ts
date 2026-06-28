import apiClient, { ApiResponse } from './api'

export interface VehicleDoc {
  id: string
  doc_type: string
  doc_no: string
  issued_date: string
  expiry_date: string
  days_to_expiry: number
}

export interface Vehicle {
  id: string
  registration_no: string
  bus_number: string
  vehicle_type: 'BUS' | 'MICROBUS' | 'MINIBUS' | 'TEMPO' | 'ELECTRIC_BUS'
  make: string
  model: string
  year: number
  color: string
  chassis_no: string
  engine_no: string
  capacity_seated: number
  capacity_standing: number
  fuel_type: 'DIESEL' | 'PETROL' | 'CNG' | 'ELECTRIC' | 'HYBRID'
  engine_capacity_cc: number | null
  status: 'ACTIVE' | 'AVAILABLE' | 'ASSIGNED' | 'IN_SERVICE' | 'IN_MAINTENANCE' | 'INACTIVE' | 'RETIRED' | 'BREAKDOWN'
  assigned_route_id: string | null
  odometer_km: number
  is_available_for_trip: boolean
  documents?: VehicleDoc[]
  created_at: string
  updated_at: string
}

export interface VehicleCreatePayload extends Partial<Vehicle> {
  insurance_policy_no?: string
  insurance_expiry_date?: string
  fitness_cert_no?: string
  fitness_expiry_date?: string
}

export type VehicleUpdatePayload = Partial<Vehicle> & {
  insurance_policy_no?: string
  insurance_expiry_date?: string
  fitness_cert_no?: string
  fitness_expiry_date?: string
}

export interface VehicleDocument {
  id: string
  vehicle: string
  document_type: string
  document_name: string
  document_url: string
  issue_date: string
  expiry_date: string
  days_to_expiry: number
  is_expired: boolean
}

export interface VehicleGPS {
  vehicle_id: string
  latitude: number
  longitude: number
  speed: number
  heading: number
  timestamp: string
  trip_id?: string
}

const fleetService = {
  vehicles: {
    list: async (params?: Record<string, string>): Promise<ApiResponse<{ results: Vehicle[] }>> => {
      const { data } = await apiClient.get('/fleet/vehicles/', { params })
      return data
    },

    get: async (id: string): Promise<Vehicle> => {
      const { data } = await apiClient.get<ApiResponse<Vehicle>>(`/fleet/vehicles/${id}/`)
      return data.data
    },

    create: async (payload: VehicleCreatePayload): Promise<Vehicle> => {
      const { data } = await apiClient.post('/fleet/vehicles/', payload)
      // DRF default create returns raw serializer data (no success envelope).
      // Errors are caught by axios (4xx/5xx) before reaching here.
      return (data as ApiResponse<Vehicle>).data ?? data
    },

    update: async (id: string, payload: VehicleUpdatePayload): Promise<Vehicle> => {
      const { data } = await apiClient.patch(`/fleet/vehicles/${id}/`, payload)
      // partial_update() now returns api_response envelope: { success, data, message }
      // Fall back to raw data for backward compatibility
      return (data as ApiResponse<Vehicle>).data ?? data
    },

    delete: async (id: string): Promise<void> => {
      await apiClient.delete(`/fleet/vehicles/${id}/`)
    },

    documents: async (vehicleId: string): Promise<VehicleDocument[]> => {
      const { data } = await apiClient.get<ApiResponse<VehicleDocument[]>>(
        `/fleet/vehicles/${vehicleId}/documents/`
      )
      return data.data
    },

    livePosition: async (vehicleId: string): Promise<VehicleGPS | null> => {
      const { data } = await apiClient.get<ApiResponse<VehicleGPS | null>>(
        `/fleet/vehicles/${vehicleId}/live-position/`
      )
      return data.data
    },

    expiringDocuments: async (): Promise<VehicleDocument[]> => {
      const { data } = await apiClient.get<ApiResponse<VehicleDocument[]>>(
        '/fleet/vehicles/expiring-documents/'
      )
      return data.data
    },
  },

  uploadDocument: async (_vehicleId: string, formData: FormData): Promise<VehicleDocument> => {
    const { data } = await apiClient.post<ApiResponse<VehicleDocument>>(
      '/fleet/vehicle-documents/',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    )
    if (!data.success) throw new Error(data.message)
    return data.data
  },
}

export default fleetService
