import { act } from '@testing-library/react'
import { useAuthStore } from '../store/authStore'

// Reset Zustand store between tests
beforeEach(() => {
  act(() => {
    useAuthStore.getState().logout()
  })
})

describe('authStore', () => {
  const mockUser = {
    id: 'test-uuid',
    email: 'test@kvbms.com',
    fullName: 'Test User',
    role: 'COMPANY_ADMIN' as const,
    tenantSchema: 'sajha_yatayat',
    language: 'en' as const,
  }

  it('starts with no user', () => {
    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.isAuthenticated).toBe(false)
  })

  it('sets auth correctly', () => {
    act(() => {
      useAuthStore.getState().setAuth(mockUser, 'access-token', 'refresh-token')
    })

    const state = useAuthStore.getState()
    expect(state.user).toEqual(mockUser)
    expect(state.isAuthenticated).toBe(true)
    expect(state.accessToken).toBe('access-token')
    expect(state.refreshToken).toBe('refresh-token')
    expect(state.tenantSlug).toBe('sajha_yatayat')
  })

  it('clears state on logout', () => {
    act(() => {
      useAuthStore.getState().setAuth(mockUser, 'access-token', 'refresh-token')
      useAuthStore.getState().logout()
    })

    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.isAuthenticated).toBe(false)
    expect(state.accessToken).toBeNull()
  })

  it('sets pending 2FA state', () => {
    act(() => {
      useAuthStore.getState().setPending2FA('otp-token-xyz')
    })

    const state = useAuthStore.getState()
    expect(state.requires2FA).toBe(true)
    expect(state.pendingOtpToken).toBe('otp-token-xyz')
  })

  it('updates tokens without changing user', () => {
    act(() => {
      useAuthStore.getState().setAuth(mockUser, 'old-access', 'old-refresh')
      useAuthStore.getState().setTokens('new-access', 'new-refresh')
    })

    const state = useAuthStore.getState()
    expect(state.accessToken).toBe('new-access')
    expect(state.refreshToken).toBe('new-refresh')
    expect(state.user).toEqual(mockUser) // user unchanged
  })
})
