import { useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Save, Building2, Bell, Upload, ImageIcon, X } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { LanguageToggle } from '@components/shared/LanguageToggle'
import { CalendarToggle } from '@components/shared/DateDisplay'
import apiClient from '@services/api'
import authService from '@services/authService'
import toast from 'react-hot-toast'
import { useUiStore } from '@store/uiStore'

// Extract a browser-accessible path from whatever the backend returns.
// Backend DRF ImageField can return either an absolute URL (with Django hostname)
// or a relative path.  We always want just the path so the Vite /media proxy works.
function getMediaPath(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).pathname   // "http://django:8000/media/..." → "/media/..."
  } catch {
    return url.startsWith('/') ? url : `/${url}`
  }
}

interface CompanyForm {
  company_name: string
  contact_email: string
  contact_phone: string
  address: string
  registration_no: string
  tax_pan: string
}

interface PasswordForm {
  old_password: string
  new_password: string
  confirm_password: string
}

export default function TenantSettingsPage() {
  const { t } = useTranslation('tenant')
  const { language, calendarType } = useUiStore()
  const qc = useQueryClient()

  // ── Logo state ──────────────────────────────────────────────────────────────
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [logoFile, setLogoFile]       = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  // ── Company info query ──────────────────────────────────────────────────────
  const { data: companyInfo } = useQuery({
    queryKey: ['company-info'],
    queryFn: async () => {
      const { data } = await apiClient.get('/operator/company/')
      return data.data
    },
  })

  const companyForm = useForm<CompanyForm>({ values: companyInfo })

  // ── Company save ────────────────────────────────────────────────────────────
  const companyMutation = useMutation({
    mutationFn: async (payload: CompanyForm) => {
      let response
      if (logoFile) {
        // Multipart only when there's a logo file to upload
        const fd = new FormData()
        fd.append('company_name',    payload.company_name    ?? '')
        fd.append('contact_email',   payload.contact_email   ?? '')
        fd.append('contact_phone',   payload.contact_phone   ?? '')
        fd.append('address',         payload.address         ?? '')
        fd.append('registration_no', payload.registration_no ?? '')
        fd.append('tax_pan',         payload.tax_pan         ?? '')
        fd.append('logo', logoFile)
        response = await apiClient.patch('/operator/company/', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      } else {
        // Plain JSON for text-only updates — no content-type ambiguity
        response = await apiClient.patch('/operator/company/', {
          company_name:    payload.company_name    ?? '',
          contact_email:   payload.contact_email   ?? '',
          contact_phone:   payload.contact_phone   ?? '',
          address:         payload.address         ?? '',
          registration_no: payload.registration_no ?? '',
          tax_pan:         payload.tax_pan         ?? '',
        })
      }
      return response.data
    },
    onSuccess: () => {
      toast.success(t('settings.toasts.companyUpdated'))
      qc.invalidateQueries({ queryKey: ['company-info'] })
      setLogoFile(null)
    },
    onError: (err: any) => {
      const errors = err?.response?.data?.errors
      if (errors && typeof errors === 'object') {
        const msg = Object.entries(errors)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join(' | ')
        toast.error(msg || t('settings.toasts.companyUpdateFailed'))
      } else {
        toast.error(err.message || t('settings.toasts.companyUpdateFailed'))
      }
    },
  })

  // ── Password change ─────────────────────────────────────────────────────────
  const {
    register: regPass,
    handleSubmit: handlePass,
    reset: resetPass,
    watch,
    formState: { errors },
  } = useForm<PasswordForm>()

  const passwordMutation = useMutation({
    mutationFn: (d: PasswordForm) => authService.changePassword(d),
    onSuccess: () => {
      toast.success(t('settings.toasts.passwordUpdated'))
      resetPass()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // ── Current logo src ────────────────────────────────────────────────────────
  const currentLogoSrc = logoPreview ?? getMediaPath(companyInfo?.logo)

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">{t('settings.title')}</h1>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

        {/* ── Company Information ─────────────────────────────────────────── */}
        <div className="card">
          <h2 className="mb-5 flex items-center gap-2 font-semibold">
            <Building2 className="h-5 w-5 text-primary-600" />
            {t('settings.companyInformation')}
          </h2>

          <form onSubmit={companyForm.handleSubmit((d) => companyMutation.mutate(d))} className="space-y-4">

            {/* Logo upload */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">{t('settings.companyLogo')}</label>
              <div className="flex items-center gap-4">
                {/* Preview / click target */}
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="group relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400"
                >
                  {currentLogoSrc ? (
                    <img
                      src={currentLogoSrc}
                      alt="Company logo"
                      className="h-full w-full object-contain p-1"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-gray-400">
                      <ImageIcon className="h-7 w-7" />
                      <span className="mt-1 text-[10px]">{t('settings.companyLogo')}</span>
                    </div>
                  )}
                  {/* Hover overlay */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/25 group-hover:opacity-100">
                    <Upload className="h-5 w-5 text-white drop-shadow" />
                  </div>
                </button>

                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-600">
                    {currentLogoSrc
                      ? t('settings.logoUploaded')
                      : t('settings.logoUploadPrompt')}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">{t('settings.logoHint')}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="text-xs font-medium text-primary-600 hover:underline"
                    >
                      {currentLogoSrc ? t('settings.changeLogo') : t('settings.uploadLogo')}
                    </button>
                    {logoPreview && (
                      <button
                        type="button"
                        onClick={() => { setLogoPreview(null); setLogoFile(null) }}
                        className="flex items-center gap-0.5 text-xs text-red-500 hover:underline"
                      >
                        <X className="h-3 w-3" /> {t('settings.discard')}
                      </button>
                    )}
                  </div>
                </div>

                {/* Hidden file input */}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    if (file.size > 2 * 1024 * 1024) {
                      toast.error(t('settings.logoTooLarge'))
                      return
                    }
                    setLogoFile(file)
                    setLogoPreview(URL.createObjectURL(file))
                  }}
                />
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4 space-y-4">
              <Input label={t('settings.companyName')} required {...companyForm.register('company_name')} />
              <Input label={t('settings.contactEmail')} type="email" {...companyForm.register('contact_email')} />
              <Input label={t('settings.contactPhone')} type="tel" {...companyForm.register('contact_phone')} />
              <Input label={t('settings.registrationNo')} {...companyForm.register('registration_no')} />
              <Input label={t('settings.panTax')} {...companyForm.register('tax_pan')} />
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('settings.address')}</label>
                <textarea
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  rows={3}
                  {...companyForm.register('address')}
                />
              </div>
            </div>

            <Button type="submit" leftIcon={<Save className="h-4 w-4" />} loading={companyMutation.isPending}>
              {t('settings.save')}
            </Button>
          </form>
        </div>

        {/* ── Display Preferences ─────────────────────────────────────────── */}
        <div className="card space-y-4">
          <h2 className="font-semibold">{t('settings.displayPreferences')}</h2>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">{t('settings.language')}</label>
            <LanguageToggle />
            <p className="mt-1 text-xs text-gray-400">{t('settings.currentLanguage', { language: language === 'en' ? 'English' : 'नेपाली' })}</p>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">{t('settings.calendar')}</label>
            <CalendarToggle />
            <p className="mt-1 text-xs text-gray-400">
              {t('settings.currentCalendar', { calendar: calendarType === 'AD' ? t('settings.gregorian') : t('settings.bikramSambat') })}
            </p>
          </div>
        </div>

        {/* ── Change Password ─────────────────────────────────────────────── */}
        <div className="card">
          <h2 className="mb-4 font-semibold">{t('settings.changePassword')}</h2>
          <form onSubmit={handlePass((d) => passwordMutation.mutate(d))} className="space-y-4">
            <Input
              label={t('settings.currentPassword')} type="password" required
              error={errors.old_password?.message}
              {...regPass('old_password', { required: true })}
            />
            <Input
              label={t('settings.newPassword')} type="password" required
              error={errors.new_password?.message}
              {...regPass('new_password', { required: true, minLength: { value: 8, message: t('settings.validation.minPassword') } })}
            />
            <Input
              label={t('settings.confirmPassword')} type="password" required
              error={errors.confirm_password?.message}
              {...regPass('confirm_password', {
                required: true,
                validate: (v) => v === watch('new_password') || t('settings.validation.passwordsMismatch'),
              })}
            />
            <Button type="submit" loading={passwordMutation.isPending}>{t('settings.updatePassword')}</Button>
          </form>
        </div>

        {/* ── Notifications ───────────────────────────────────────────────── */}
        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 font-semibold">
            <Bell className="h-5 w-5 text-primary-600" />
            {t('settings.notifications')}
          </h2>
          {[
            t('settings.notificationItems.documentExpiry'),
            t('settings.notificationItems.lowStock'),
            t('settings.notificationItems.tripCancellation'),
            t('settings.notificationItems.maintenanceReminders'),
            t('settings.notificationItems.revenueReports'),
          ].map((label) => (
            <label key={label} className="flex items-center justify-between border-b py-2 last:border-0">
              <span className="text-sm text-gray-700">{label}</span>
              <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-gray-300 text-primary-600" />
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
