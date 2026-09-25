import apiClient, { ApiResponse } from './api'

export interface LoginPayload {
  email: string
  password: string
}

export interface TokenResponse {
  access: string
  refresh: string
  role: string
  tenant_schema: string
  full_name: string
  language: string
  user_id: string
  must_change_password?: boolean
}

export interface TwoFactorPayload {
  otp_token: string
  totp_code: string
}

const authService = {
  login: async (payload: LoginPayload): Promise<TokenResponse> => {
    const { data } = await apiClient.post<ApiResponse<TokenResponse>>(
      '/auth/login/',
      payload
    )
    if (!data.success) throw new Error(data.message)
    return data.data
  },

  verify2FA: async (payload: TwoFactorPayload): Promise<TokenResponse> => {
    const { data } = await apiClient.post<ApiResponse<TokenResponse>>(
      '/auth/2fa/verify/',
      payload
    )
    if (!data.success) throw new Error(data.message)
    return data.data
  },

  refreshToken: async (refresh: string): Promise<{ access: string }> => {
    const { data } = await apiClient.post<{ access: string }>(
      '/auth/token/refresh/',
      { refresh }
    )
    return data
  },

  logout: async (refresh: string): Promise<void> => {
    await apiClient.post('/auth/logout/', { refresh })
  },

  changePassword: async (payload: {
    old_password: string
    new_password: string
    confirm_password: string
  }): Promise<void> => {
    // Backend's ChangePasswordSerializer field is new_password_confirm, not
    // confirm_password -- translated here so every caller can keep using the
    // field name their form already has.
    const { data } = await apiClient.post<ApiResponse<null>>(
      '/auth/change-password/',
      {
        old_password: payload.old_password,
        new_password: payload.new_password,
        new_password_confirm: payload.confirm_password,
      }
    )
    if (!data.success) throw new Error(data.message)
  },
}

export default authService
