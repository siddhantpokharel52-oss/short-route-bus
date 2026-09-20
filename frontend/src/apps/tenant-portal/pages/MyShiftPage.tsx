/**
 * MyShiftPage -- CB7: a conductor opens a shift, works it, then closes it by
 * declaring how much cash they physically have. The system independently
 * computes what it saw (cash tickets issued during the shift) and shows the
 * variance immediately, rather than trusting the declared amount blindly.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wallet, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Modal } from '@components/shared/Modal'
import { Table, Column } from '@components/shared/Table'
import conductorShiftService, { ConductorShift } from '@services/conductorShiftService'

function money(v: string | null) {
  if (v === null) return '—'
  return `NPR ${Number(v).toFixed(2)}`
}

export default function MyShiftPage() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()
  const [openingFloat, setOpeningFloat] = useState('0')
  const [showClose, setShowClose] = useState(false)
  const [declaredCash, setDeclaredCash] = useState('')
  const [notes, setNotes] = useState('')

  const { data: current, isLoading } = useQuery({
    queryKey: ['my-shift-current'],
    queryFn: () => conductorShiftService.current(),
  })

  const { data: history = [] } = useQuery({
    queryKey: ['my-shift-history'],
    queryFn: () => conductorShiftService.list(),
  })

  const openMutation = useMutation({
    mutationFn: () => conductorShiftService.open(Number(openingFloat) || 0),
    onSuccess: () => {
      toast.success(t('myShift.opened', { defaultValue: 'Shift opened.' }))
      qc.invalidateQueries({ queryKey: ['my-shift-current'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to open shift.')
    },
  })

  const closeMutation = useMutation({
    mutationFn: () => conductorShiftService.close(current!.id, Number(declaredCash) || 0, notes),
    onSuccess: (closed) => {
      setShowClose(false)
      setDeclaredCash('')
      setNotes('')
      qc.invalidateQueries({ queryKey: ['my-shift-current'] })
      qc.invalidateQueries({ queryKey: ['my-shift-history'] })
      const variance = Number(closed.variance)
      if (variance === 0) {
        toast.success(t('myShift.closedClean', { defaultValue: 'Shift closed -- cash matches exactly.' }))
      } else {
        toast(
          t('myShift.closedVariance', {
            defaultValue: 'Shift closed with a variance of {{amount}}.',
            amount: money(closed.variance),
          }),
          { icon: '⚠️' },
        )
      }
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to close shift.')
    },
  })

  const columns: Column<ConductorShift>[] = [
    { key: 'date', header: t('myShift.date', { defaultValue: 'Date' }), render: (s) => s.date },
    { key: 'declared_cash', header: t('myShift.declared', { defaultValue: 'Declared' }), render: (s) => money(s.declared_cash) },
    { key: 'system_cash_total', header: t('myShift.system', { defaultValue: 'System Total' }), render: (s) => money(s.system_cash_total) },
    {
      key: 'variance',
      header: t('myShift.variance', { defaultValue: 'Variance' }),
      render: (s) => (
        <span className={Number(s.variance) === 0 ? 'text-green-700 font-medium' : 'text-red-600 font-semibold'}>
          {money(s.variance)}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary-600" /> {t('myShift.title', { defaultValue: 'My Shift' })}
          </h1>
          <p className="page-subtitle">{t('myShift.subtitle', { defaultValue: 'Open a shift, work it, then declare your cash to close it' })}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="card flex items-center justify-center py-16 text-sm text-gray-400">Loading…</div>
      ) : !current ? (
        <div className="card space-y-4 p-6">
          <p className="text-sm text-gray-500">{t('myShift.noOpenShift', { defaultValue: 'You have no open shift right now.' })}</p>
          <div className="flex items-end gap-3">
            <Input
              label={t('myShift.openingFloat', { defaultValue: 'Opening Cash Float (NPR)' })}
              type="number"
              min="0"
              step="0.01"
              value={openingFloat}
              onChange={(e) => setOpeningFloat(e.target.value)}
              className="max-w-[200px]"
            />
            <Button onClick={() => openMutation.mutate()} disabled={openMutation.isPending}>
              {t('myShift.openShift', { defaultValue: 'Open Shift' })}
            </Button>
          </div>
        </div>
      ) : (
        <div className="card space-y-4 p-6">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Clock className="h-4 w-4" />
            {t('myShift.openSince', { defaultValue: 'Open since' })} {new Date(current.opened_at).toLocaleTimeString()}
          </div>
          <p className="text-xs text-gray-400">
            {t('myShift.openingFloat', { defaultValue: 'Opening Cash Float (NPR)' })}: {money(current.opening_float)}
          </p>
          <Button onClick={() => setShowClose(true)}>{t('myShift.closeShift', { defaultValue: 'Close Shift' })}</Button>
        </div>
      )}

      {history.length > 0 && (
        <div className="card p-0">
          <div className="border-b border-gray-100 px-5 py-3">
            <p className="text-sm font-semibold text-gray-700">{t('myShift.history', { defaultValue: 'Past Shifts' })}</p>
          </div>
          <Table columns={columns} data={history.filter((s) => s.status === 'CLOSED')} keyExtractor={(s) => s.id} />
        </div>
      )}

      <Modal open={showClose} onClose={() => setShowClose(false)} title={t('myShift.closeShift', { defaultValue: 'Close Shift' })} size="sm">
        <div className="space-y-4 p-1">
          <Input
            label={t('myShift.declaredCash', { defaultValue: 'Cash You Are Declaring (NPR)' })}
            type="number"
            min="0"
            step="0.01"
            value={declaredCash}
            onChange={(e) => setDeclaredCash(e.target.value)}
            autoFocus
          />
          <Input
            label={t('myShift.notes', { defaultValue: 'Notes (optional)' })}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowClose(false)}>
              {t('myShift.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button onClick={() => closeMutation.mutate()} disabled={!declaredCash || closeMutation.isPending}>
              {closeMutation.isPending ? '…' : t('myShift.confirmClose', { defaultValue: 'Confirm Close' })}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
