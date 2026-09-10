import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type UserRole =
  | 'SUPER_ADMIN'
  | 'TRANSPORT_AUTHORITY_OFFICER'
  | 'REVENUE_AUDITOR'
  | 'COMPLIANCE_OFFICER'
  | 'PLATFORM_SUPPORT'
  | 'COMPANY_ADMIN'
  | 'OPERATIONS_MANAGER'
  | 'DISPATCHER'
  | 'FLEET_MANAGER'
  | 'MAINTENANCE_MANAGER'
  | 'FINANCE_OFFICER'
  | 'HR_OFFICER'
  | 'STATION_MANAGER'
  | 'DRIVER'
  | 'CONDUCTOR'
  | 'INSPECTOR'
  | 'PASSENGER'
  | 'STUDENT'
  | 'TOURIST'

export interface AuthUser {
  id: string
  email: string
  fullName: string
  role: UserRole
  tenantSchema: string | null
  language: 'en' | 'ne'
}

interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  refreshToken: string | null
  tenantSlug: string | null
  isAuthenticated: boolean
  requires2FA: boolean
  pendingOtpToken: string | null

  // Actions
  setAuth: (user: AuthUser, access: string, refresh: string) => void
  setTokens: (access: string, refresh: string) => void
  setPending2FA: (otpToken: string) => void
  setTenantSlug: (slug: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      tenantSlug: null,
      isAuthenticated: false,
      requires2FA: false,
      pendingOtpToken: null,

      setAuth: (user, access, refresh) =>
        set({
          user,
          accessToken: access,
          refreshToken: refresh,
          isAuthenticated: true,
          requires2FA: false,
          pendingOtpToken: null,
          tenantSlug: user.tenantSchema,
        }),

      setTokens: (access, refresh) =>
        set({ accessToken: access, refreshToken: refresh }),

      setPending2FA: (otpToken) =>
        set({ requires2FA: true, pendingOtpToken: otpToken }),

      setTenantSlug: (slug) => set({ tenantSlug: slug }),

      logout: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          tenantSlug: null,
          isAuthenticated: false,
          requires2FA: false,
          pendingOtpToken: null,
        }),
    }),
    {
      name: 'kvbms_auth',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        tenantSlug: state.tenantSlug,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)

// Role-based helpers
export const isSuperAdmin = (role?: UserRole) => role === 'SUPER_ADMIN'
export const isPlatformRole = (role?: UserRole) =>
  ['SUPER_ADMIN', 'TRANSPORT_AUTHORITY_OFFICER', 'REVENUE_AUDITOR',
   'COMPLIANCE_OFFICER', 'PLATFORM_SUPPORT'].includes(role ?? '')
export const isTenantRole = (role?: UserRole) =>
  ['COMPANY_ADMIN', 'OPERATIONS_MANAGER', 'DISPATCHER', 'FLEET_MANAGER',
   'MAINTENANCE_MANAGER', 'FINANCE_OFFICER', 'HR_OFFICER', 'STATION_MANAGER',
   'DRIVER', 'CONDUCTOR', 'INSPECTOR'].includes(role ?? '')
export const isOperationsRole = (role?: UserRole) =>
  ['DISPATCHER', 'DRIVER', 'CONDUCTOR'].includes(role ?? '')
