import apiClient, { ApiResponse } from './api'

export interface Tenant {
  id: string
  name: string
  schema_name: string
  plan_type: 'BASIC' | 'STANDARD' | 'ENTERPRISE'
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE'
  contact_name: string
  contact_email: string
  contact_phone: string
  address: string
  pan_vat_number: string
  commission_rate?: number
  created_at: string
  domains: { id: number; domain: string; is_primary: boolean }[]
}

export interface TenantCreatePayload {
  name: string
  subdomain: string
  plan_type: 'BASIC' | 'STANDARD' | 'ENTERPRISE'
  contact_name?: string
  contact_email: string
  contact_phone?: string
  address?: string
  pan_vat_number?: string
  admin_email?: string
  admin_password?: string
  admin_full_name?: string
}

export interface TenantCreateResult extends Tenant {
  admin_credentials?: { email: string; password: string }
}

export interface TenantDocument {
  id: string
  tenant: string
  document_type: string
  document_name: string
  document_url: string
  is_verified: boolean
  expiry_date: string | null
  uploaded_at: string
}

export interface PaginatedResponse<T> {
  results: T[]
  count: number
  next: string | null
  previous: string | null
}

const tenantService = {
  // Returns { tenants: Tenant[], totalCount: number }
  list: async (params?: Record<string, unknown>): Promise<{ tenants: Tenant[]; totalCount: number }> => {
    const { data } = await apiClient.get<ApiResponse<Tenant[]>>('/platform/tenants/', { params })
    const tenants = Array.isArray(data.data) ? data.data : []
    const totalCount = (data.meta?.total_count as number) ?? tenants.length
    return { tenants, totalCount }
  },

  get: async (id: string): Promise<Tenant> => {
    const { data } = await apiClient.get<ApiResponse<Tenant>>(`/platform/tenants/${id}/`)
    return data.data
  },

  create: async (payload: TenantCreatePayload): Promise<TenantCreateResult> => {
    const { data } = await apiClient.post<ApiResponse<TenantCreateResult>>('/platform/tenants/', payload)
    if (!data.success) throw new Error(data.message)
    return data.data
  },

  update: async (id: string, payload: Partial<Tenant>): Promise<Tenant> => {
    const { data } = await apiClient.patch<ApiResponse<Tenant>>(
      `/platform/tenants/${id}/`,
      payload
    )
    if (!data.success) throw new Error(data.message)
    return data.data
  },

  activate: async (id: string): Promise<Tenant> => {
    const { data } = await apiClient.post<ApiResponse<Tenant>>(
      `/platform/tenants/${id}/activate/`
    )
    if (!data.success) throw new Error(data.message)
    return data.data
  },

  suspend: async (id: string, reason: string): Promise<Tenant> => {
    const { data } = await apiClient.post<ApiResponse<Tenant>>(
      `/platform/tenants/${id}/suspend/`,
      { reason }
    )
    if (!data.success) throw new Error(data.message)
    return data.data
  },

  analytics: async (id: string): Promise<ApiResponse<Record<string, number>>> => {
    const { data } = await apiClient.get<ApiResponse<Record<string, number>>>(
      `/platform/tenants/${id}/analytics/`
    )
    return data
  },

  documents: {
    list: async (tenantId: string): Promise<TenantDocument[]> => {
      const { data } = await apiClient.get<ApiResponse<TenantDocument[]>>(
        `/platform/tenants/${tenantId}/documents/`
      )
      return data.data
    },

    upload: async (_tenantId: string, formData: FormData): Promise<TenantDocument> => {
      const { data } = await apiClient.post<ApiResponse<TenantDocument>>(
        `/platform/tenant-documents/`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      if (!data.success) throw new Error(data.message)
      return data.data
    },

    verify: async (docId: string): Promise<TenantDocument> => {
      const { data } = await apiClient.post<ApiResponse<TenantDocument>>(
        `/platform/tenant-documents/${docId}/verify/`
      )
      if (!data.success) throw new Error(data.message)
      return data.data
    },
  },
}

export default tenantService
