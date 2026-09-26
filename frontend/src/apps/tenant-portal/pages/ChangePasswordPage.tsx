import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { KeyRound } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import authService from '@services/authService'
import toast from 'react-hot-toast'
import { isValidPassword, PASSWORD_VALIDATION_MESSAGE } from '@utils/password'

interface PasswordForm {
  old_password: string
  new_password: string
  confirm_password: string
}

/** "Change Password" in the Profile menu -- split out of the old, single
 * TenantSettingsPage.tsx, unchanged logic. */
export default function ChangePasswordPage() {
  const { t } = useTranslation('tenant')

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<PasswordForm>()

  const passwordMutation = useMutation({
    mutationFn: (d: PasswordForm) => authService.changePassword(d),
    onSuccess: () => {
      toast.success(t('settings.toasts.passwordUpdated'))
      reset()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">{t('profile.changePassword', { defaultValue: 'Change Password' })}</h1>
      </div>

      <div className="card max-w-md">
        <h2 className="mb-4 font-semibold">{t('settings.changePassword')}</h2>
        <form onSubmit={handleSubmit((d) => passwordMutation.mutate(d))} className="space-y-4">
          <Input
            label={t('settings.currentPassword')} type="password" required
            error={errors.old_password?.message}
            {...register('old_password', { required: true })}
          />
          <Input
            label={t('settings.newPassword')} type="password" required
            error={errors.new_password?.message}
            {...register('new_password', {
              required: true,
              validate: (v) => isValidPassword(v) || PASSWORD_VALIDATION_MESSAGE,
            })}
          />
          <Input
            label={t('settings.confirmPassword')} type="password" required
            error={errors.confirm_password?.message}
            {...register('confirm_password', {
              required: true,
              validate: (v) => v === watch('new_password') || t('settings.validation.passwordsMismatch'),
            })}
          />
          <Button type="submit" loading={passwordMutation.isPending} leftIcon={<KeyRound className="h-4 w-4" />}>
            {t('settings.updatePassword')}
          </Button>
        </form>
      </div>
    </div>
  )
}
