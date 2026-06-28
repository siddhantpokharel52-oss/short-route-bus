import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@store/authStore'
import authService from '@services/authService'
import i18n from '@i18n/index'
import toast from 'react-hot-toast'

export function useAuth() {
  const store = useAuthStore()
  const navigate = useNavigate()

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await authService.login({ email, password })

      // Check if 2FA is needed (backend returns otp_token instead of access)
      if ('otp_token' in response && !(response as { access?: string }).access) {
        store.setPending2FA((response as { otp_token: string }).otp_token)
        return { requires2FA: true }
      }

      const tokenResp = response
      store.setAuth(
        {
          id: tokenResp.user_id,
          email,
          fullName: tokenResp.full_name,
          role: tokenResp.role as Parameters<typeof store.setAuth>[0]['role'],
          tenantSchema: tokenResp.tenant_schema || null,
          language: (tokenResp.language as 'en' | 'ne') ?? 'en',
        },
        tokenResp.access,
        tokenResp.refresh
      )

      // Set language preference
      if (tokenResp.language) {
        i18n.changeLanguage(tokenResp.language)
      }

      // Route based on role
      redirectByRole(tokenResp.role, navigate)
      return { requires2FA: false }
    },
    [store, navigate]
  )

  const verify2FA = useCallback(
    async (totpCode: string) => {
      if (!store.pendingOtpToken) throw new Error('No pending OTP session')

      const tokenResp = await authService.verify2FA({
        otp_token: store.pendingOtpToken,
        totp_code: totpCode,
      })

      store.setAuth(
        {
          id: tokenResp.user_id,
          email: '',
          fullName: tokenResp.full_name,
          role: tokenResp.role as Parameters<typeof store.setAuth>[0]['role'],
          tenantSchema: tokenResp.tenant_schema || null,
          language: (tokenResp.language as 'en' | 'ne') ?? 'en',
        },
        tokenResp.access,
        tokenResp.refresh
      )

      redirectByRole(tokenResp.role, navigate)
    },
    [store, navigate]
  )

  const logout = useCallback(async () => {
    try {
      if (store.refreshToken) {
        await authService.logout(store.refreshToken)
      }
    } catch {
      // Ignore errors on logout
    } finally {
      store.logout()
      navigate('/login')
      toast.success('Logged out successfully')
    }
  }, [store, navigate])

  return {
    user: store.user,
    isAuthenticated: store.isAuthenticated,
    requires2FA: store.requires2FA,
    login,
    verify2FA,
    logout,
  }
}

function redirectByRole(role: string, navigate: (path: string) => void) {
  if (['SUPER_ADMIN', 'TRANSPORT_AUTHORITY', 'PLATFORM_ANALYST'].includes(role)) {
    navigate('/super-admin/dashboard')
  } else if (
    ['COMPANY_ADMIN', 'COMPANY_MANAGER', 'DISPATCHER', 'DRIVER',
     'CONDUCTOR', 'FINANCE_OFFICER', 'HR_OFFICER', 'MAINTENANCE_OFFICER',
     'INVENTORY_OFFICER'].includes(role)
  ) {
    navigate('/tenant/live-tracking')
  } else {
    // PUBLIC_USER, PASSENGER, or any unknown role → public home
    navigate('/')
  }
}
