import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Save, Key, Bell, Globe } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import authService from '@services/authService'
import toast from 'react-hot-toast'
import { useUiStore } from '@store/uiStore'
import { LanguageToggle } from '@components/shared/LanguageToggle'
import { CalendarToggle } from '@components/shared/DateDisplay'

interface PasswordForm {
  old_password: string
  new_password: string
  confirm_password: string
}

export default function SettingsPage() {
  const { t } = useTranslation(['common', 'platform'])
  const { language, calendarType } = useUiStore()

  const { register, handleSubmit, reset, formState: { errors }, watch } = useForm<PasswordForm>()

  const passwordMutation = useMutation({
    mutationFn: (data: PasswordForm) => authService.changePassword(data),
    onSuccess: () => {
      toast.success(t('platform:settings.toasts.passwordChanged'))
      reset()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">{t('platform:settings.title')}</h1>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Display Preferences */}
        <div className="card space-y-4">
          <h2 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
            <Globe className="h-5 w-5 text-primary-600" />
            {t('platform:settings.displayPreferences')}
          </h2>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('platform:settings.language')}
            </label>
            <LanguageToggle />
            <p className="mt-1 text-xs text-gray-400">
              {t('platform:settings.currentLanguage', { language: language === 'en' ? 'English' : 'नेपाली' })}
            </p>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('platform:settings.calendarSystem')}
            </label>
            <CalendarToggle />
            <p className="mt-1 text-xs text-gray-400">
              {t('platform:settings.currentCalendar', {
                calendar: calendarType === 'AD' ? t('platform:settings.gregorian') : t('platform:settings.bikramSambat'),
              })}
            </p>
          </div>
        </div>

        {/* Change Password */}
        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
            <Key className="h-5 w-5 text-primary-600" />
            {t('platform:settings.changePassword')}
          </h2>
          <form onSubmit={handleSubmit((d) => passwordMutation.mutate(d))} className="space-y-4">
            <Input
              label={t('platform:settings.currentPassword')}
              type="password"
              required
              error={errors.old_password?.message}
              {...register('old_password', { required: t('platform:settings.validation.currentPasswordRequired') })}
            />
            <Input
              label={t('platform:settings.newPassword')}
              type="password"
              required
              error={errors.new_password?.message}
              {...register('new_password', {
                required: t('platform:settings.validation.newPasswordRequired'),
                minLength: { value: 8, message: t('platform:settings.validation.minLength') },
                pattern: {
                  value: /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)/,
                  message: t('platform:settings.validation.passwordComplexity'),
                },
              })}
            />
            <Input
              label={t('platform:settings.confirmNewPassword')}
              type="password"
              required
              error={errors.confirm_password?.message}
              {...register('confirm_password', {
                required: t('platform:settings.validation.confirmRequired'),
                validate: (val) => val === watch('new_password') || t('platform:settings.validation.passwordsMismatch'),
              })}
            />
            <Button type="submit" leftIcon={<Save className="h-4 w-4" />} loading={passwordMutation.isPending}>
              {t('platform:settings.updatePassword')}
            </Button>
          </form>
        </div>

        {/* Notification Settings */}
        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
            <Bell className="h-5 w-5 text-primary-600" />
            {t('platform:settings.notificationPreferences')}
          </h2>
          <div className="space-y-3">
            {[
              { label: t('platform:settings.notifications.tenantRegistration'), key: 'tenant_registration' },
              { label: t('platform:settings.notifications.docExpiry'), key: 'doc_expiry' },
              { label: t('platform:settings.notifications.emergency'), key: 'emergency' },
              { label: t('platform:settings.notifications.revenue'), key: 'revenue' },
              { label: t('platform:settings.notifications.maintenance'), key: 'maintenance' },
            ].map((item) => (
              <label key={item.key} className="flex items-center justify-between">
                <span className="text-sm text-gray-700 dark:text-gray-300">{item.label}</span>
                <input
                  type="checkbox"
                  defaultChecked
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
