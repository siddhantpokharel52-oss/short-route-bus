import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRight, DollarSign } from 'lucide-react'
import { Button } from '@components/shared/Button'
import publicService, { Stop, FareInfo } from '@services/publicService'
import { formatNPR } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'

export default function FaresPage() {
  const { t } = useTranslation('public')
  const { language } = useUiStore()
  const [fromStop, setFromStop] = useState('')
  const [toStop, setToStop] = useState('')
  const [queryEnabled, setQueryEnabled] = useState(false)

  const { data: stops } = useQuery({
    queryKey: ['public-stops-all'],
    queryFn: () => publicService.stops.list(),
  })

  const { data: fare, isLoading: fareLoading } = useQuery({
    queryKey: ['fare', fromStop, toStop],
    queryFn: () => publicService.fares(fromStop, toStop),
    enabled: queryEnabled && !!fromStop && !!toStop,
  })

  const handleCheck = () => {
    setQueryEnabled(true)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">{t('fares.title')}</h1>
      <p className="text-gray-500 mb-8">{t('fares.subtitle')}</p>

      {/* Fare calculator */}
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm mb-8">
        <h2 className="font-semibold text-gray-900 mb-4">{t('fares.checkFare')}</h2>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('fares.fromStop')}</label>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={fromStop}
              onChange={(e) => { setFromStop(e.target.value); setQueryEnabled(false) }}
            >
              <option value="">{t('fares.selectStop')}</option>
              {(stops ?? []).map((stop: Stop) => (
                <option key={stop.id} value={stop.id}>{stop.name_en}</option>
              ))}
            </select>
          </div>
          <div className="hidden sm:flex items-center pb-2">
            <ArrowRight className="h-5 w-5 text-gray-300" />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('fares.toStop')}</label>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={toStop}
              onChange={(e) => { setToStop(e.target.value); setQueryEnabled(false) }}
            >
              <option value="">{t('fares.selectStop')}</option>
              {(stops ?? []).map((stop: Stop) => (
                <option key={stop.id} value={stop.id}>{stop.name_en}</option>
              ))}
            </select>
          </div>
          <Button
            onClick={handleCheck}
            disabled={!fromStop || !toStop}
            loading={fareLoading}
            leftIcon={<DollarSign className="h-4 w-4" />}
          >
            {t('fares.checkFare')}
          </Button>
        </div>

        {/* Fare result */}
        {fare && (
          <div className="mt-6 rounded-xl bg-primary-50 p-5">
            <p className="text-sm text-gray-500 mb-4">
              {t('fares.distanceLabel', { km: fare.distance_km })}
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: t('fares.adult'), amount: fare.adult_fare, highlight: true },
                { label: t('fares.student'), amount: fare.student_fare, discount: true },
                { label: t('fares.senior'), amount: fare.senior_fare, discount: true },
                { label: t('fares.differentlyAbled'), amount: fare.differently_abled_fare, discount: true },
              ].map((item) => (
                <div key={item.label} className={`rounded-xl p-3 text-center ${item.highlight ? 'bg-primary-600 text-white' : 'bg-white text-gray-800'}`}>
                  <p className={`text-xs mb-1 ${item.highlight ? 'text-primary-200' : 'text-gray-400'}`}>{item.label}</p>
                  <p className="text-lg font-bold">{formatNPR(item.amount, language as 'en' | 'ne')}</p>
                </div>
              ))}
            </div>
            {fare.peak_hour_surcharge > 0 && (
              <p className="mt-3 text-sm text-orange-600">
                ⚠️ {t('fares.peakHourSurcharge', { amount: formatNPR(fare.peak_hour_surcharge, language as 'en' | 'ne') })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Fare info table */}
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">{t('fares.policyTitle')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left text-gray-500">{t('fares.passengerType')}</th>
                <th className="py-2 text-right text-gray-500">{t('fares.discount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[
                { type: t('fares.policy.adultType'), discount: t('fares.policy.adultDiscount'), base: true },
                { type: t('fares.policy.studentType'), discount: t('fares.policy.studentDiscount'), base: false },
                { type: t('fares.policy.seniorType'), discount: t('fares.policy.seniorDiscount'), base: false },
                { type: t('fares.policy.disabledType'), discount: t('fares.policy.disabledDiscount'), base: false },
                { type: t('fares.policy.smartCardType'), discount: t('fares.policy.smartCardDiscount'), base: false },
              ].map((row) => (
                <tr key={row.type}>
                  <td className="py-3 text-gray-700">{row.type}</td>
                  <td className="py-3 text-right">
                    <span className={row.base ? 'text-gray-400' : 'font-medium text-green-600'}>
                      {row.discount}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
