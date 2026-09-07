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

export type TenantDocType = 'REGISTRATION' | 'PAN' | 'ROUTE_LICENSE' | 'TAX_CLEARANCE' | 'OTHER'

export interface TenantDocument {
  id: string
  tenant: string
  doc_type: TenantDocType
  file: string
  verified: boolean
  verified_by: string | null
  verified_at: string | null
  uploaded_at: string
  remarks: string
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

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/platform/tenants/${id}/`)
  },

  activate: async (id: string): Promise<Tenant> => {
    const { data } = await apiClient.post<ApiResponse<Tenant>>(
      `/platform/tenants/${id}/activate/`
    )
    if (!data.success) throw new Error(data.message)
    return data.data
  },

  createAdmin: async (
    id: string,
    payload: { admin_email: string; admin_password: string; admin_full_name?: string }
  ): Promise<{ email: string; password: string }> => {
    const { data } = await apiClient.post<ApiResponse<{ admin_credentials: { email: string; password: string } }>>(
      `/platform/tenants/${id}/create-admin/`,
      payload
    )
    if (!data.success) throw new Error(data.message)
    return data.data.admin_credentials
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

    upload: async (tenantId: string, formData: FormData): Promise<TenantDocument> => {
      // Plain ModelViewSet.create() -- no api_response envelope, unlike list().
      const { data } = await apiClient.post<TenantDocument>(
        `/platform/tenants/${tenantId}/documents/`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      return data
    },

    verify: async (tenantId: string, docId: string): Promise<void> => {
      await apiClient.post(`/platform/tenants/${tenantId}/documents/${docId}/verify/`)
    },
  },
}

export default tenantService
