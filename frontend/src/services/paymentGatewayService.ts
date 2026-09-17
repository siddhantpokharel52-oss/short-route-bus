import apiClient, { ApiResponse } from './api'

export interface NamastePayConfig {
  id: string
  api_key_set: boolean
  environment: 'TEST' | 'LIVE'
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface NamastePayConfigPayload {
  api_key?: string
  environment?: 'TEST' | 'LIVE'
  is_active?: boolean
}

const paymentGatewayService = {
  get: async (): Promise<NamastePayConfig> => {
    const { data } = await apiClient.get<ApiResponse<NamastePayConfig>>('/ticketing/payment-gateway/')
    return data.data
  },

  save: async (payload: NamastePayConfigPayload): Promise<NamastePayConfig> => {
    const { data } = await apiClient.patch<ApiResponse<NamastePayConfig>>('/ticketing/payment-gateway/', payload)
    return data.data
  },

  testConnection: async (): Promise<{ success: boolean; message: string }> => {
    try {
      const { data } = await apiClient.post<ApiResponse<unknown>>('/ticketing/payment-gateway/test/')
      return { success: true, message: data.message }
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } }
      return { success: false, message: e?.response?.data?.message || 'Connection test failed.' }
    }
  },
}

export default paymentGatewayService
