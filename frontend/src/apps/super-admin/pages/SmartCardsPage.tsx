import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, CreditCard, RefreshCw } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { usePagination } from '@hooks/usePagination'
import { DateDisplay } from '@components/shared/DateDisplay'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { formatNPR } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'

interface SmartCard {
  id: string
  card_number: string
  holder_name: string
  card_type: string
  balance: number
  is_active: boolean
  expiry_date: string
  last_used: string | null
}

export default function SmartCardsPage() {
  const qc = useQueryClient()
  const { language } = useUiStore()
  const [search, setSearch] = useState('')
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
      return data.data?.results ?? []
    },
  })

  const rechargeMutation = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) =>
      apiClient.post(`/platform/smart-cards/${id}/recharge/`, { amount }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Card recharged!')
      setRechargeTarget(null)
      setRechargeAmount('')
      qc.invalidateQueries({ queryKey: ['smart-cards'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const columns: Column<SmartCard>[] = [
    {
      key: 'card_number',
      header: 'Card Number',
      render: (c) => (
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-primary-500" />
          <code className="font-mono text-sm">{c.card_number}</code>
        </div>
      ),
    },
    { key: 'holder_name', header: 'Holder Name' },
    {
      key: 'card_type',
      header: 'Type',
      render: (c) => <Badge variant="neutral">{c.card_type}</Badge>,
    },
    {
      key: 'balance',
      header: 'Balance',
      render: (c) => (
        <span className={c.balance < 50 ? 'font-bold text-red-600' : 'font-semibold text-green-600'}>
          {formatNPR(c.balance, language as 'en' | 'ne')}
        </span>
      ),
    },
    {
      key: 'expiry_date',
      header: 'Expiry',
      render: (c) => <DateDisplay date={c.expiry_date} />,
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (c) => <Badge variant={c.is_active ? 'success' : 'neutral'} dot>{c.is_active ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (c) => (
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          onClick={() => setRechargeTarget(c)}
        >
          Recharge
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Smart Cards</h1>
          <p className="page-subtitle">NFC transit card management</p>
        </div>
      </div>

      <Input
        placeholder="Search by card number or holder name..."
        leftAddon={<Search className="h-4 w-4" />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="card p-0">
        <Table columns={columns} data={data ?? []} keyExtractor={(c) => c.id} loading={isLoading} />
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalCount={totalCount}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
        />
      </div>

      {/* Recharge modal */}
      <Modal open={!!rechargeTarget} onClose={() => setRechargeTarget(null)} title="Recharge Smart Card" size="sm">
        <div className="space-y-4 p-6">
          <p className="text-sm text-gray-600">
            Card: <strong>{rechargeTarget?.card_number}</strong> ({rechargeTarget?.holder_name})
          </p>
          <p className="text-sm">
            Current Balance: <strong className="text-green-600">
              {formatNPR(rechargeTarget?.balance ?? 0, language as 'en' | 'ne')}
            </strong>
          </p>
          <Input
            label="Recharge Amount (NPR)"
            type="number"
            min="10"
            max="10000"
            value={rechargeAmount}
            onChange={(e) => setRechargeAmount(e.target.value)}
            placeholder="Enter amount..."
          />
          <div className="flex gap-2">
            {[100, 250, 500, 1000].map((amt) => (
              <button
                key={amt}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
                onClick={() => setRechargeAmount(String(amt))}
              >
                Rs. {amt}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" onClick={() => setRechargeTarget(null)}>Cancel</Button>
            <Button
              loading={rechargeMutation.isPending}
              disabled={!rechargeAmount || Number(rechargeAmount) <= 0}
              onClick={() => rechargeTarget && rechargeMutation.mutate({
                id: rechargeTarget.id,
                amount: Number(rechargeAmount),
              })}
            >
              Recharge
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
