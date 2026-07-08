import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Bus, Building2 } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { LanguageToggle } from '@components/shared/LanguageToggle'
import { useAuth } from '@hooks/useAuth'
import { useAuthStore } from '@store/authStore'
import { getPortalContext, getTenantLoginUrl, getMainLoginUrl } from '@utils/portalContext'
import { isPlatformRole, isTenantRole } from '@store/authStore'
import toast from 'react-hot-toast'

type LoginForm = { email: string; password: string }
type TotpForm = { code: string }

export default function LoginPage() {
  const { t } = useTranslation()
  const { login, verify2FA, requires2FA } = useAuth()
  const { isAuthenticated, user, logout: clearAuth } = useAuthStore()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const { isTenantPortal, tenantSlug } = getPortalContext()

  // On mount: redirect already-authenticated users to the correct portal,
  // or to the correct domain if they ended up on the wrong one.
  useEffect(() => {
    if (!isAuthenticated || !user) return
    const role = user.role

    if (isPlatformRole(role)) {
      if (isTenantPortal) {
        // Platform user landed on a tenant subdomain — send them to the main portal.
        window.location.replace(getMainLoginUrl())
      } else {
        navigate('/super-admin/dashboard', { replace: true })
      }
    } else if (isTenantRole(role)) {
      if (!isTenantPortal) {
        // Tenant user landed on the main domain — redirect to their subdomain.
        if (user.tenantSchema) {
          window.location.replace(
            getTenantLoginUrl(user.tenantSchema).replace('/login', '/tenant/live-tracking')
          )
        } else {
          clearAuth()
        }
      } else {
        navigate('/tenant/live-tracking', { replace: true })
      }
    } else {
      // Stale or unknown role — wipe so the form starts clean
      clearAuth()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loginSchema = z.object({
    email: z.string().email(t('errors.invalidEmail')),
    password: z.string().min(8, t('errors.minLength', { min: 8 })),
  })

  const totpSchema = z.object({
    code: z.string().length(6, t('errors.enterCode')),
  })

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
        toast.success(t('auth.welcomeBack'))
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('auth.loginFailed')
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  const onVerify2FA = async (data: TotpForm) => {
    setIsLoading(true)
    try {
      await verify2FA(data.code)
      toast.success(t('auth.twoFactorSuccess'))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('auth.invalidCode')
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  const portalIcon = isTenantPortal ? (
    <Building2 className="h-10 w-10 text-white" />
  ) : (
    <Bus className="h-10 w-10 text-white" />
  )

  const portalTitle = isTenantPortal
    ? (tenantSlug ? tenantSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : t('auth.companyPortal'))
    : t('app.name')

  const portalSubtitle = isTenantPortal
    ? t('auth.companyPortalSubtitle', { defaultValue: 'Company Management Portal' })
    : t('app.fullName')

  const loginSubtitle = isTenantPortal
    ? t('auth.loginSubtitleTenant', { defaultValue: 'Sign in to your company portal' })
    : t('auth.loginSubtitle')

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-primary-900 via-primary-800 to-primary-600">
      {/* Left panel — branding */}
      <div className="hidden flex-1 flex-col items-center justify-center p-12 text-white lg:flex">
        <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm">
          {portalIcon}
        </div>
        <h1 className="text-5xl font-bold">{portalTitle}</h1>
        <p className="mt-4 text-xl text-primary-200">{portalSubtitle}</p>
        {!isTenantPortal && <p className="mt-2 text-primary-300">{t('app.tagline')}</p>}

        {!isTenantPortal && (
          <div className="mt-16 grid grid-cols-2 gap-6 text-center">
            {[
              { label: t('auth.stats.busOperators'), value: '12+' },
              { label: t('auth.stats.dailyTrips'), value: '2,400+' },
              { label: t('auth.stats.passengersPerDay'), value: '85,000+' },
              { label: t('auth.stats.routesCount'), value: '48' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl bg-white/10 p-4 backdrop-blur-sm">
                <p className="text-3xl font-bold text-white">{stat.value}</p>
                <p className="mt-1 text-sm text-primary-200">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        {isTenantPortal && (
          <p className="mt-8 text-sm text-primary-300">
            {t('auth.platformLoginHint', { defaultValue: 'Platform administrators:' })}{' '}
            <a
              href={getMainLoginUrl()}
              className="underline hover:text-white"
            >
              {t('auth.useMainPortal', { defaultValue: 'use the main portal' })}
            </a>
          </p>
        )}
      </div>

      {/* Right panel — login form */}
      <div className="flex w-full items-center justify-center p-6 lg:w-[480px] lg:bg-white lg:dark:bg-gray-900">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
            {isTenantPortal
              ? <Building2 className="h-8 w-8 text-white" />
              : <Bus className="h-8 w-8 text-white" />}
            <span className="text-2xl font-bold text-white">{portalTitle}</span>
          </div>

          <div className="rounded-2xl bg-white p-8 shadow-2xl lg:p-0 lg:shadow-none">
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {requires2FA ? t('auth.twoFactorTitle') : t('auth.loginTitle')}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {requires2FA ? t('auth.twoFactorCode') : loginSubtitle}
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
