import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { QrCode, CheckCircle, XCircle, Search } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Badge } from '@components/shared/Badge'
import publicService from '@services/publicService'
import { formatNPR } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'
import toast from 'react-hot-toast'

export default function TicketVerifyPage() {
  const { t } = useTranslation('public')
  const { language } = useUiStore()
  const [ticketNumber, setTicketNumber] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<Awaited<ReturnType<typeof publicService.verifyTicket>> | null>(null)
  const [error, setError] = useState(false)

  const handleVerify = async () => {
    if (!ticketNumber.trim()) return
    setIsLoading(true)
    setResult(null)
    setError(false)
    try {
      const res = await publicService.verifyTicket(ticketNumber.trim())
      setResult(res)
    } catch {
      setError(true)
      toast.error(t('tickets.notFoundToast'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="text-center mb-8">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-100 text-primary-600">
          <QrCode className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900">{t('tickets.verifyTicket')}</h1>
        <p className="mt-2 text-gray-500">{t('tickets.subtitle')}</p>
      </div>

      {/* Search */}
      <div className="flex gap-3 mb-8">
        <Input
          placeholder="TKT-xxxxxxxxxxxxxxxx"
          value={ticketNumber}
          onChange={(e) => setTicketNumber(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
          leftAddon={<Search className="h-4 w-4" />}
          className="flex-1"
        />
        <Button onClick={handleVerify} loading={isLoading}>
          {t('tickets.verify')}
        </Button>
      </div>

      {/* Result */}
      {result && (
        <div className={`rounded-2xl p-6 ${result.is_valid ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <div className="flex items-center gap-3 mb-4">
            {result.is_valid ? (
              <CheckCircle className="h-8 w-8 text-green-600 flex-shrink-0" />
            ) : (
              <XCircle className="h-8 w-8 text-red-600 flex-shrink-0" />
            )}
            <div>
              <p className={`text-xl font-bold ${result.is_valid ? 'text-green-700' : 'text-red-700'}`}>
                {result.is_valid ? t('tickets.valid') : t('tickets.invalid')}
              </p>
              <Badge variant={result.is_valid ? 'success' : 'danger'}>
                {result.status}
              </Badge>
            </div>
          </div>

          {result.is_valid && (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-gray-500">{t('tickets.passengerName')}</dt>
                <dd className="font-semibold text-gray-900">{result.passenger_name}</dd>
              </div>
              <div>
                <dt className="text-gray-500">{t('tickets.route')}</dt>
                <dd className="font-semibold text-gray-900">{result.route}</dd>
              </div>
              <div>
                <dt className="text-gray-500">{t('tickets.fare')}</dt>
                <dd className="font-semibold text-green-600">{formatNPR(result.fare, language as 'en' | 'ne')}</dd>
              </div>
              <div>
                <dt className="text-gray-500">{t('tickets.date')}</dt>
                <dd className="font-semibold text-gray-900">
                  {new Date(result.issued_at).toLocaleDateString()}
                </dd>
              </div>
            </dl>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-2xl bg-red-50 border border-red-200 p-6 text-center">
          <XCircle className="mx-auto h-8 w-8 text-red-500 mb-2" />
          <p className="text-red-700 font-medium">{t('tickets.invalid')}</p>
          <p className="text-sm text-red-500">{t('tickets.notFoundMessage', { number: ticketNumber })}</p>
        </div>
      )}

      {/* Info */}
      <div className="mt-8 rounded-xl bg-gray-50 p-5 text-sm text-gray-600">
        <h3 className="font-semibold text-gray-800 mb-2">{t('tickets.howToVerify')}</h3>
        <ul className="space-y-1 list-disc list-inside text-gray-500">
          <li>{t('tickets.helpItems.enterNumber')}</li>
          <li>{t('tickets.helpItems.startsWith')}</li>
          <li>{t('tickets.helpItems.oneJourney')}</li>
          <li>{t('tickets.helpItems.showCollector')}</li>
        </ul>
      </div>
    </div>
  )
}
