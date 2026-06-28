import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Bus } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { LanguageToggle } from '@components/shared/LanguageToggle'
import { useAuth } from '@hooks/useAuth'
import { useAuthStore } from '@store/authStore'
import toast from 'react-hot-toast'

const PLATFORM_ROLES = ['SUPER_ADMIN', 'TRANSPORT_AUTHORITY', 'PLATFORM_ANALYST']
const TENANT_ROLES = [
  'COMPANY_ADMIN', 'COMPANY_MANAGER', 'DISPATCHER', 'DRIVER',
  'CONDUCTOR', 'FINANCE_OFFICER', 'HR_OFFICER', 'MAINTENANCE_OFFICER', 'INVENTORY_OFFICER',
]

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

const totpSchema = z.object({
  code: z.string().length(6, 'Enter 6-digit code'),
})

type LoginForm = z.infer<typeof loginSchema>
type TotpForm = z.infer<typeof totpSchema>

export default function LoginPage() {
  const { t } = useTranslation()
  const { login, verify2FA, requires2FA } = useAuth()
  const { isAuthenticated, user, logout: clearAuth } = useAuthStore()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // On mount: if already authenticated with a valid role, redirect to the right portal.
  // If authenticated but with a stale/invalid role (e.g. old PASSENGER state),
  // clear the auth state so the user can log in fresh.
  useEffect(() => {
    if (!isAuthenticated || !user) return
    const role = user.role
    if (PLATFORM_ROLES.includes(role)) {
      navigate('/super-admin/dashboard', { replace: true })
    } else if (TENANT_ROLES.includes(role)) {
      navigate('/tenant/live-tracking', { replace: true })
    } else {
      // Stale or unknown role — wipe it so the form starts clean
      clearAuth()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  const totpForm = useForm<TotpForm>({
    resolver: zodResolver(totpSchema),
  })

  const onLogin = async (data: LoginForm) => {
    setIsLoading(true)
    try {
      const result = await login(data.email, data.password)
      if (!result.requires2FA) {
        toast.success('Welcome back!')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  const onVerify2FA = async (data: TotpForm) => {
    setIsLoading(true)
    try {
      await verify2FA(data.code)
      toast.success('Authentication successful!')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid code'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-primary-900 via-primary-800 to-primary-600">
      {/* Left panel — branding */}
      <div className="hidden flex-1 flex-col items-center justify-center p-12 text-white lg:flex">
        <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm">
          <Bus className="h-10 w-10 text-white" />
        </div>
        <h1 className="text-5xl font-bold">{t('app.name')}</h1>
        <p className="mt-4 text-xl text-primary-200">{t('app.fullName')}</p>
        <p className="mt-2 text-primary-300">{t('app.tagline')}</p>

        <div className="mt-16 grid grid-cols-2 gap-6 text-center">
          {[
            { label: 'Bus Operators', value: '12+' },
            { label: 'Daily Trips', value: '2,400+' },
            { label: 'Passengers/Day', value: '85,000+' },
            { label: 'Routes', value: '48' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl bg-white/10 p-4 backdrop-blur-sm">
              <p className="text-3xl font-bold text-white">{stat.value}</p>
              <p className="mt-1 text-sm text-primary-200">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex w-full items-center justify-center p-6 lg:w-[480px] lg:bg-white lg:dark:bg-gray-900">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
            <Bus className="h-8 w-8 text-white" />
            <span className="text-2xl font-bold text-white">{t('app.name')}</span>
          </div>

          <div className="rounded-2xl bg-white p-8 shadow-2xl lg:p-0 lg:shadow-none">
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {requires2FA ? t('auth.twoFactorTitle') : t('auth.loginTitle')}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {requires2FA ? t('auth.twoFactorCode') : t('auth.loginSubtitle')}
                </p>
              </div>
              <LanguageToggle />
            </div>

            {!requires2FA ? (
              <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
                <Input
                  label={t('auth.email')}
                  type="email"
                  autoComplete="email"
                  required
                  error={loginForm.formState.errors.email?.message}
                  {...loginForm.register('email')}
                />

                <div>
                  <Input
                    label={t('auth.password')}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    error={loginForm.formState.errors.password?.message}
                    rightAddon={
                      <button
                        type="button"
                        onClick={() => setShowPassword((p) => !p)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    }
                    {...loginForm.register('password')}
                  />
                  <div className="mt-1 flex justify-end">
                    <a
                      href="/forgot-password"
                      className="text-xs text-primary-600 hover:underline"
                    >
                      {t('auth.forgotPassword')}
                    </a>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  loading={isLoading}
                >
                  {t('auth.loginButton')}
                </Button>
              </form>
            ) : (
              <form onSubmit={totpForm.handleSubmit(onVerify2FA)} className="space-y-4">
                <Input
                  label={t('auth.twoFactorCode')}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoFocus
                  required
                  error={totpForm.formState.errors.code?.message}
                  {...totpForm.register('code')}
                />
                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  loading={isLoading}
                >
                  {t('auth.verifyButton')}
                </Button>
              </form>
            )}
          </div>

          <p className="mt-6 text-center text-xs text-primary-200 lg:text-gray-400">
            काठमाडौं उपत्यका सार्वजनिक यातायात व्यवस्थापन प्रणाली
          </p>
        </div>
      </div>
    </div>
  )
}
