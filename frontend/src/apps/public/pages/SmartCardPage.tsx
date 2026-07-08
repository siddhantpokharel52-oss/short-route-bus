import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CreditCard, Search, AlertCircle } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Badge } from '@components/shared/Badge'
import { DateDisplay } from '@components/shared/DateDisplay'
import { formatNPR } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'
import axios from 'axios'
import toast from 'react-hot-toast'

interface CardInfo {
  card_number: string
  holder_name: string
  balance: number
  card_type: string
  is_active: boolean
  expiry_date: string
  last_transactions: Array<{
    id: string
    amount: number
    transaction_type: string
    created_at: string
    description: string
  }>
}

export default function SmartCardPage() {
  const { t } = useTranslation('public')
  const { language } = useUiStore()
  const [cardNumber, setCardNumber] = useState('')
  const [cardInfo, setCardInfo] = useState<CardInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleCheck = async () => {
    setIsLoading(true)
    try {
      const { data } = await axios.get(`/public-api/smart-cards/${cardNumber}/`)
      setCardInfo(data)
    } catch {
      toast.error(t('smartCard.notFoundToast'))
      setCardInfo(null)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="text-center mb-8">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-100">
          <CreditCard className="h-8 w-8 text-primary-600" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900">{t('smartCard.title')}</h1>
        <p className="mt-2 text-gray-500">{t('smartCard.tapToPay')}</p>
      </div>

      {/* Card lookup */}
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm mb-6">
        <h2 className="font-semibold text-gray-900 mb-4">{t('smartCard.checkBalance')}</h2>
        <div className="flex gap-3">
          <Input
            placeholder={t('smartCard.enterCardNumber')}
            value={cardNumber}
            onChange={(e) => setCardNumber(e.target.value)}
            leftAddon={<Search className="h-4 w-4" />}
            className="flex-1"
          />
          <Button onClick={handleCheck} loading={isLoading} disabled={!cardNumber}>
            {t('smartCard.check')}
          </Button>
        </div>
      </div>

      {/* Card info */}
      {cardInfo && (
        <div className="space-y-4">
          {/* Card visual */}
          <div className="relative h-48 rounded-2xl bg-gradient-to-br from-primary-600 to-primary-800 p-6 text-white shadow-xl overflow-hidden">
            <div className="absolute top-0 right-0 h-40 w-40 rounded-full bg-white/10 translate-x-10 -translate-y-10" />
            <div className="absolute bottom-0 left-0 h-32 w-32 rounded-full bg-white/5 -translate-x-8 translate-y-8" />
            <div className="relative">
              <p className="text-primary-200 text-xs mb-4">KVBMS Smart Card</p>
              <p className="font-mono text-lg tracking-widest mb-4">
                {cardInfo.card_number.match(/.{1,4}/g)?.join(' ')}
              </p>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-primary-200 text-xs">{t('smartCard.cardHolder')}</p>
                  <p className="font-semibold">{cardInfo.holder_name}</p>
                </div>
                <div className="text-right">
                  <p className="text-primary-200 text-xs">{t('smartCard.balance')}</p>
                  <p className="text-2xl font-bold">
                    {formatNPR(cardInfo.balance, language as 'en' | 'ne')}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Card details */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">{t('smartCard.cardDetails')}</h3>
              <Badge variant={cardInfo.is_active ? 'success' : 'danger'} dot>
                {cardInfo.is_active ? t('common:common.active') : t('common:common.inactive')}
              </Badge>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-gray-400">{t('common:common.type')}</dt>
                <dd className="font-medium">{cardInfo.card_type}</dd>
              </div>
              <div>
                <dt className="text-gray-400">{t('smartCard.expiry')}</dt>
                <dd className="font-medium"><DateDisplay date={cardInfo.expiry_date} /></dd>
              </div>
            </dl>

            {cardInfo.balance < 50 && (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {t('smartCard.lowBalance')}
              </div>
            )}
          </div>

          {/* Transactions */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <h3 className="font-semibold mb-4">{t('smartCard.transactions')}</h3>
            {cardInfo.last_transactions?.length === 0 ? (
              <p className="text-sm text-gray-400">{t('smartCard.noTransactions')}</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {cardInfo.last_transactions?.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between py-3 text-sm">
                    <div>
                      <p className="font-medium text-gray-900">{tx.description}</p>
                      <p className="text-xs text-gray-400">
                        <DateDisplay date={tx.created_at} />
                      </p>
                    </div>
                    <span className={tx.transaction_type === 'DEBIT' ? 'text-red-600 font-semibold' : 'text-green-600 font-semibold'}>
                      {tx.transaction_type === 'DEBIT' ? '-' : '+'}
                      {formatNPR(tx.amount, language as 'en' | 'ne')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recharge note */}
          <div className="rounded-xl bg-primary-50 p-4 text-sm text-primary-700">
            <p className="font-medium mb-1">{t('smartCard.howToRecharge')}</p>
            <ul className="text-primary-600 space-y-1 list-disc list-inside text-xs">
              <li>{t('smartCard.rechargeItems.visitAgent')}</li>
              <li>{t('smartCard.rechargeItems.useApp')}</li>
              <li>{t('smartCard.rechargeItems.limits')}</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
