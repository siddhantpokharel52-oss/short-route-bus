/**
 * Axios API client with JWT auth, tenant-aware headers, and envelope unwrapping.
 */
import axios, { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '@store/authStore'
import { getPortalContext } from '@utils/portalContext'
import toast from 'react-hot-toast'

// Standard API envelope from backend
export interface ApiResponse<T = unknown> {
  success: boolean
  data: T
  message: string
  errors: Record<string, string[]> | null
  meta: {
    page?: number
    total_count?: number
    total_pages?: number
    timestamp?: string
    [key: string]: unknown
  }
}

const apiClient: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Accept-Language': localStorage.getItem('kvbms_language') || 'en',
  },
})

// Request interceptor: attach JWT + tenant slug
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().accessToken
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }

    // Derive tenant slug from the current hostname (ground truth).
    // Using the hostname means the login request also carries the slug before
    // the user is authenticated, and cross-subdomain access is naturally blocked
    // by TenantSchemaMiddleware (JWT tenant_schema won't match the hostname slug).
    const { isTenantPortal, tenantSlug: hostnameSlug } = getPortalContext()
    if (isTenantPortal && hostnameSlug && config.url && !config.url.startsWith('/platform')) {
      config.headers['X-Tenant-Slug'] = hostnameSlug
    }

    // Language header
    const lang = localStorage.getItem('kvbms_language') || 'en'
    config.headers['Accept-Language'] = lang

    return config
  },
  (error) => Promise.reject(error)
)

// Shared refresh promise — prevents multiple concurrent requests from each
// independently calling token/refresh/ when the access token expires.
let _refreshPromise: Promise<string> | null = null

function _doRefresh(): Promise<string> {
  if (_refreshPromise) return _refreshPromise
  _refreshPromise = (async () => {
    const refreshToken = useAuthStore.getState().refreshToken
    if (!refreshToken) throw new Error('No refresh token')
    const res = await axios.post('/api/v1/auth/token/refresh/', { refresh: refreshToken })
    const { access } = res.data
    useAuthStore.getState().setTokens(access, refreshToken)
    return access
  })().finally(() => { _refreshPromise = null })
  return _refreshPromise
}

// Response interceptor: handle token refresh and error normalisation
apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true
      try {
        const access = await _doRefresh()
        originalRequest.headers.Authorization = `Bearer ${access}`
        return apiClient(originalRequest)
      } catch {
        useAuthStore.getState().logout()
        window.location.href = '/login'
        return Promise.reject(error)
      }
    }

    if (error.response?.status === 403) {
      toast.error('Access denied. You do not have permission.')
    }

    if (error.response?.status >= 500) {
      toast.error('Server error. Please try again later.')
    }

    return Promise.reject(error)
  }
)

export default apiClient
