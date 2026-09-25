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
import { CreditCard, Save, ShieldCheck, CheckCircle2, XCircle, PlugZap, Eye, EyeOff } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Badge } from '@components/shared/Badge'
import paymentGatewayService, { NamastePayConfigPayload } from '@services/paymentGatewayService'
import toast from 'react-hot-toast'

interface FormValues {
  api_key: string
  environment: 'TEST' | 'LIVE'
  is_active: boolean
}

export default function PaymentIntegrationPage() {
  const qc = useQueryClient()
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)

  const { data: config, isLoading } = useQuery({
    queryKey: ['namastepay-config'],
    queryFn: () => paymentGatewayService.get(),
  })

  const { register, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: { api_key: '', environment: 'TEST', is_active: false },
  })

  useEffect(() => {
    if (config) {
      reset({
        api_key: '',
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
      environment: d.environment, is_active: d.is_active,
    }
    if (d.api_key) payload.api_key = d.api_key
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
              The API key is encrypted at rest and never shown again after saving -- leave it blank to keep the current one.
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                API Key {config?.api_key_set && <Badge variant="success" className="ml-1">configured</Badge>}
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  placeholder={config?.api_key_set ? 'Leave blank to keep the current key' : 'Enter your NamastePay API key'}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  {...register('api_key')}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowApiKey((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Generate this from the NamastePay merchant portal for your environment. Set your return URL there too, when generating the key -- it isn't configured here.
              </p>
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

            <div className="border-t pt-4">
              <div className="flex gap-2">
                <Button type="submit" leftIcon={<Save className="h-4 w-4" />} loading={saveMutation.isPending}>
                  Save
                </Button>
                <Button
                  type="button" variant="outline" leftIcon={<PlugZap className="h-4 w-4" />}
                  loading={testMutation.isPending}
                  disabled={!config?.api_key_set}
                  title={!config?.api_key_set ? 'Save your API key first' : undefined}
                  onClick={() => testMutation.mutate()}
                >
                  Test Connection
                </Button>
              </div>
              {/* Pokhara QA report: the button's own disabled+title were the
                  only signal this state existed, and the outline variant had
                  no visible disabled styling -- a hover-only tooltip on a
                  button that otherwise looked fully interactive read as a
                  dead control. A persistent line makes the reason obvious
                  without hovering. */}
              {!config?.api_key_set && (
                <p className="mt-2 text-xs text-gray-500">Save your API key above before testing the connection.</p>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
