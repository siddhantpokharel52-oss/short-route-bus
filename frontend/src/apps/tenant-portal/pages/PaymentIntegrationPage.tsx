/**
 * PaymentIntegrationPage -- lets a tenant enter their own NamastePay
 * merchant credentials. Every tenant hits the same NamastePay API (same
 * base URLs, same request/response shapes); only these credentials
 * differ per tenant. Credentials-and-gateway-plumbing scope only for now
 * -- there's no customer-facing checkout flow yet to wire this into, see
 * the Slice plan for why that's a deliberate, separate follow-up.
 */
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CreditCard, Save, ShieldCheck, CheckCircle2, XCircle, PlugZap } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Badge } from '@components/shared/Badge'
import paymentGatewayService, { NamastePayConfigPayload } from '@services/paymentGatewayService'
import toast from 'react-hot-toast'

interface FormValues {
  client_id: string
  client_secret: string
  environment: 'TEST' | 'LIVE'
  is_active: boolean
}

export default function PaymentIntegrationPage() {
  const qc = useQueryClient()
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const { data: config, isLoading } = useQuery({
    queryKey: ['namastepay-config'],
    queryFn: () => paymentGatewayService.get(),
  })

  const { register, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: { client_id: '', client_secret: '', environment: 'TEST', is_active: false },
  })

  useEffect(() => {
    if (config) {
      reset({
        client_id: config.client_id, client_secret: '',
        environment: config.environment, is_active: config.is_active,
      })
    }
  }, [config, reset])

  const saveMutation = useMutation({
    mutationFn: (payload: NamastePayConfigPayload) => paymentGatewayService.save(payload),
    onSuccess: () => {
      toast.success('Payment gateway settings saved.')
      qc.invalidateQueries({ queryKey: ['namastepay-config'] })
      setTestResult(null)
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to save settings.')
    },
  })

  const testMutation = useMutation({
    mutationFn: () => paymentGatewayService.testConnection(),
    onSuccess: (result) => {
      setTestResult(result)
      if (result.success) toast.success('NamastePay accepted the credentials.')
      else toast.error(result.message)
    },
  })

  const onSubmit = (d: FormValues) => {
    const payload: NamastePayConfigPayload = {
      client_id: d.client_id, environment: d.environment, is_active: d.is_active,
    }
    if (d.client_secret) payload.client_secret = d.client_secret
    saveMutation.mutate(payload)
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2"><CreditCard className="h-6 w-6 text-primary-600" /> Payment Integration</h1>
          <p className="page-subtitle">Connect your own NamastePay merchant account -- every tenant calls the same API, with their own credentials</p>
        </div>
      </div>

      <div className="card max-w-xl p-6">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-gray-400">Loading…</p>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary-600" />
              The client secret is encrypted at rest and never shown again after saving -- leave it blank to keep the current one.
            </div>

            <Input label="Client ID" {...register('client_id')} />

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Client Secret {config?.client_secret_set && <Badge variant="success" className="ml-1">configured</Badge>}
              </label>
              <input
                type="password"
                placeholder={config?.client_secret_set ? 'Leave blank to keep the current secret' : 'Enter your NamastePay client secret'}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                {...register('client_secret')}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Environment</label>
              <select
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                {...register('environment')}
              >
                <option value="TEST">Test</option>
                <option value="LIVE">Live</option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-primary-600" {...register('is_active')} />
              Active -- offer NamastePay as a payment option
            </label>

            {testResult && (
              <div className={`flex items-start gap-2 rounded-lg p-3 text-xs ${testResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {testResult.success ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
                {testResult.message}
              </div>
            )}

            <div className="flex gap-2 border-t pt-4">
              <Button type="submit" leftIcon={<Save className="h-4 w-4" />} loading={saveMutation.isPending}>
                Save
              </Button>
              <Button
                type="button" variant="outline" leftIcon={<PlugZap className="h-4 w-4" />}
                loading={testMutation.isPending}
                disabled={!config?.client_secret_set}
                title={!config?.client_secret_set ? 'Save your credentials first' : undefined}
                onClick={() => testMutation.mutate()}
              >
                Test Connection
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
