/**
 * SetNewPasswordPage — forced gate for a Bus Owner still signed in with the
 * temporary password the tenant admin set for them (OwnersPage's Create
 * Login). TenantApp.tsx redirects here instead of my-earnings whenever
 * user.mustChangePassword is true, and won't let them navigate anywhere
 * else until this succeeds. Reuses the existing change-password endpoint --
 * old_password here is just the temp password the owner already knows.
 * On success, the backend clears Owner.temp_password server-side, so the
 * tenant's Owners page stops being able to see it.
 */
import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import authService from '@services/authService'
import { useAuthStore } from '@store/authStore'
import { isValidPassword, PASSWORD_VALIDATION_MESSAGE } from '@utils/password'
import toast from 'react-hot-toast'

interface FormValues {
  old_password: string
  new_password: string
  confirm_password: string
}

export default function SetNewPasswordPage() {
  const navigate = useNavigate()
  const clearMustChangePassword = useAuthStore((s) => s.clearMustChangePassword)
  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormValues>()

  const mutation = useMutation({
    mutationFn: (d: FormValues) => authService.changePassword(d),
    onSuccess: () => {
      toast.success('Password updated. Welcome!')
      clearMustChangePassword()
      navigate('/tenant/my-earnings', { replace: true })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } }
      toast.error(e?.response?.data?.message || 'Could not update your password.')
    },
  })

  return (
    <div className="mx-auto max-w-md space-y-6 py-8">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-50">
          <ShieldCheck className="h-6 w-6 text-primary-600" />
        </div>
        <h1 className="page-title">Set your password</h1>
        <p className="mt-1 text-sm text-gray-500">
          You're signed in with a temporary password. Set your own to continue to your dashboard.
        </p>
      </div>

      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="card space-y-4">
        <Input
          label="Temporary password" type="password" required
          error={errors.old_password?.message}
          {...register('old_password', { required: 'Enter the temporary password you signed in with' })}
        />
        <Input
          label="New password" type="password" required
          error={errors.new_password?.message}
          {...register('new_password', {
            required: 'Required',
            validate: (v) => isValidPassword(v) || PASSWORD_VALIDATION_MESSAGE,
          })}
        />
        <Input
          label="Confirm new password" type="password" required
          error={errors.confirm_password?.message}
          {...register('confirm_password', {
            required: 'Required',
            validate: (v) => v === watch('new_password') || 'Passwords do not match',
          })}
        />
        <Button type="submit" className="w-full" loading={mutation.isPending} leftIcon={<KeyRound className="h-4 w-4" />}>
          Set password
        </Button>
      </form>
    </div>
  )
}
