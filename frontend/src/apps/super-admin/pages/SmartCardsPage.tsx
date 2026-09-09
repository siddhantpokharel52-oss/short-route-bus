import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Search, CreditCard, RefreshCw, Plus } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { usePagination } from '@hooks/usePagination'
import { DateDisplay } from '@components/shared/DateDisplay'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import { formatNPR } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'

interface SmartCard {
  id: string
  card_no: string
  passenger_name: string
  passenger_email: string
  balance: number
  status: 'ACTIVE' | 'BLOCKED' | 'LOST' | 'EXPIRED'
  issued_at: string
}

interface IssueCardForm {
  card_no: string
  issue_to_email: string
}

export default function SmartCardsPage() {
  const { t } = useTranslation(['common', 'platform'])
  const qc = useQueryClient()
  const { language } = useUiStore()
  const [search, setSearch] = useState('')
  const [showIssue, setShowIssue] = useState(false)
  const [rechargeTarget, setRechargeTarget] = useState<SmartCard | null>(null)
  const [rechargeAmount, setRechargeAmount] = useState('')
  const [totalCount, setTotalCount] = useState(0)
  const pagination = usePagination(totalCount)

  const { data, isLoading } = useQuery({
    queryKey: ['smart-cards', pagination.page, search],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/smart-cards/', {
        params: { ...pagination.queryParams, ...(search && { search }) },
      })
      setTotalCount(data.meta?.total_count ?? 0)
      // StandardResultsPagination wraps a plain array directly under "data"
      // (not "data.results") -- this always resolved to [] regardless of
      // how many cards actually existed, same bug as the Users page.
      return data.data?.results ?? data.data ?? []
    },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<IssueCardForm>()

  const issueMutation = useMutation({
    mutationFn: (payload: IssueCardForm) =>
      apiClient.post('/platform/smart-cards/', payload).then((r) => r.data),
    onSuccess: () => {
      toast.success(t('platform:smartCards.toasts.issued', { defaultValue: 'Card issued.' }))
      setShowIssue(false)
      reset()
      qc.invalidateQueries({ queryKey: ['smart-cards'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { errors?: Record<string, string[]>; message?: string } } }
      const fieldError = e?.response?.data?.errors?.issue_to_email?.[0]
      toast.error(fieldError || e?.response?.data?.message || (err as Error).message)
    },
  })

  const rechargeMutation = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) =>
      apiClient.post(`/platform/smart-cards/${id}/recharge/`, { amount }).then((r) => r.data),
    onSuccess: () => {
      toast.success(t('platform:smartCards.toasts.recharged'))
      setRechargeTarget(null)
      setRechargeAmount('')
      qc.invalidateQueries({ queryKey: ['smart-cards'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const columns: Column<SmartCard>[] = [
    {
      key: 'card_no',
      header: t('platform:smartCards.cardNumber'),
      render: (c) => (
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-primary-500" />
          <code className="font-mono text-sm">{c.card_no}</code>
        </div>
      ),
    },
    {
      key: 'passenger_name',
      header: t('platform:smartCards.holderName'),
      render: (c) => (
        <div>
          <p className="font-medium text-gray-900">{c.passenger_name}</p>
          <p className="text-xs text-gray-400">{c.passenger_email}</p>
        </div>
      ),
    },
    {
      key: 'balance',
      header: t('platform:smartCards.balance'),
      render: (c) => (
        <span className={c.balance < 50 ? 'font-bold text-red-600' : 'font-semibold text-green-600'}>
          {formatNPR(c.balance, language as 'en' | 'ne')}
        </span>
      ),
    },
    {
      key: 'issued_at',
      header: t('platform:smartCards.issuedAt', { defaultValue: 'Issued' }),
      render: (c) => <DateDisplay date={c.issued_at} />,
    },
    {
      key: 'status',
      header: t('common:common.status'),
      render: (c) => <Badge variant={c.status === 'ACTIVE' ? 'success' : 'neutral'} dot>{c.status}</Badge>,
    },
    {
      key: 'actions',
      header: t('common:common.actions'),
      render: (c) => (
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          onClick={() => setRechargeTarget(c)}
        >
          {t('platform:smartCards.recharge')}
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('platform:smartCards.title')}</h1>
          <p className="page-subtitle">{t('platform:smartCards.subtitle')}</p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowIssue(true)}>
          {t('platform:smartCards.issueCard', { defaultValue: 'Issue Card' })}
        </Button>
      </div>

      <Input
        placeholder={t('platform:smartCards.searchPlaceholder')}
        leftAddon={<Search className="h-4 w-4" />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="card p-0">
        <Table
          columns={columns} data={data ?? []} keyExtractor={(c) => c.id} loading={isLoading}
          emptyIcon={<CreditCard className="h-10 w-10" />}
          emptyMessage={t('platform:smartCards.noCardsYet', { defaultValue: 'No smart cards issued yet.' })}
          emptyAction={<Button size="sm" onClick={() => setShowIssue(true)}>{t('platform:smartCards.issueCard', { defaultValue: 'Issue Card' })}</Button>}
        />
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalCount={totalCount}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
        />
      </div>

      {/* Issue Card modal */}
      <Modal open={showIssue} onClose={() => { setShowIssue(false); reset() }} title={t('platform:smartCards.issueCard', { defaultValue: 'Issue Card' })} size="sm">
        <form onSubmit={handleSubmit((d) => issueMutation.mutate(d))} className="space-y-4 p-6">
          <p className="text-xs text-gray-500">
            {t('platform:smartCards.issueHint', { defaultValue: 'The passenger must already have a registered account -- a card can\'t be issued to someone who hasn\'t signed up yet.' })}
          </p>
          <Input
            label={t('platform:smartCards.cardNumber')}
            required
            placeholder="e.g. SC-2026-00001"
            error={errors.card_no?.message}
            {...register('card_no', { required: t('platform:smartCards.required', { defaultValue: 'Required' }) })}
          />
          <Input
            label={t('platform:smartCards.passengerEmail', { defaultValue: 'Passenger Email' })}
            type="email"
            required
            placeholder="passenger@example.com"
            error={errors.issue_to_email?.message}
            {...register('issue_to_email', { required: t('platform:smartCards.required', { defaultValue: 'Required' }) })}
          />
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" type="button" onClick={() => { setShowIssue(false); reset() }}>{t('common:common.cancel')}</Button>
            <Button type="submit" loading={issueMutation.isPending}>{t('platform:smartCards.issueCard', { defaultValue: 'Issue Card' })}</Button>
          </div>
        </form>
      </Modal>

      {/* Recharge modal */}
      <Modal open={!!rechargeTarget} onClose={() => setRechargeTarget(null)} title={t('platform:smartCards.rechargeModal.title')} size="sm">
        <div className="space-y-4 p-6">
          <p className="text-sm text-gray-600">
            {t('platform:smartCards.rechargeModal.cardLabel')} <strong>{rechargeTarget?.card_no}</strong> ({rechargeTarget?.passenger_name})
          </p>
          <p className="text-sm">
            {t('platform:smartCards.rechargeModal.currentBalance')} <strong className="text-green-600">
              {formatNPR(rechargeTarget?.balance ?? 0, language as 'en' | 'ne')}
            </strong>
          </p>
          <Input
            label={t('platform:smartCards.rechargeAmount')}
            type="number"
            min="10"
            max="10000"
            value={rechargeAmount}
            onChange={(e) => setRechargeAmount(e.target.value)}
            placeholder={t('platform:smartCards.rechargeAmountPlaceholder')}
          />
          <div className="flex gap-2">
            {[100, 250, 500, 1000].map((amt) => (
              <button
                key={amt}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
                onClick={() => setRechargeAmount(String(amt))}
              >
                {formatNPR(amt, language as 'en' | 'ne')}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" onClick={() => setRechargeTarget(null)}>{t('common:common.cancel')}</Button>
            <Button
              loading={rechargeMutation.isPending}
              disabled={!rechargeAmount || Number(rechargeAmount) <= 0}
              onClick={() => rechargeTarget && rechargeMutation.mutate({
                id: rechargeTarget.id,
                amount: Number(rechargeAmount),
              })}
            >
              {t('platform:smartCards.recharge')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
