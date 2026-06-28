import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CreditCard, Plus, Search, Receipt, History,
  CheckCircle2, Clock, RefreshCw, Ban, Play, Settings2,
  DollarSign, Percent,
} from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { DateDisplay } from '@components/shared/DateDisplay'
import { usePagination } from '@hooks/usePagination'
import billingService, {
  PricingPlan, TenantSubscription, Invoice,
} from '@services/billingService'
import tenantService from '@services/tenantService'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import { cn } from '@utils/cn'

// ─── Tab ─────────────────────────────────────────────────────────────────────
type Tab = 'subscriptions' | 'invoices' | 'plans' | 'audit'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function subStatusVariant(s: string) {
  const m: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
    ACTIVE: 'success', TRIAL: 'info', SUSPENDED: 'warning', EXPIRED: 'danger',
  }
  return m[s] ?? 'neutral'
}

function invoiceStatusVariant(s: string) {
  const m: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
    PAID: 'success', PENDING: 'warning', OVERDUE: 'danger', CANCELLED: 'neutral', WAIVED: 'neutral',
  }
  return m[s] ?? 'neutral'
}

function SelectField({
  label, required, children, error, ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; required?: boolean; error?: string }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <select
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                   focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        {...props}
      >
        {children}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function BillingPage() {
  const [tab, setTab] = useState<Tab>('subscriptions')

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'subscriptions', label: 'Subscriptions', icon: CreditCard },
    { key: 'invoices',      label: 'Invoices',       icon: Receipt },
    { key: 'plans',         label: 'AMC Plans',      icon: Settings2 },
    { key: 'audit',         label: 'Audit Log',      icon: History },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Billing & Subscriptions</h1>
          <p className="page-subtitle">Monthly AMC-based billing for all tenants</p>
        </div>
      </div>

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-2 border-b-2 pb-3 text-sm font-medium transition-colors',
                tab === t.key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'subscriptions' && <SubscriptionsTab />}
      {tab === 'invoices'      && <InvoicesTab />}
      {tab === 'plans'         && <PlansTab />}
      {tab === 'audit'         && <AuditTab />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUBSCRIPTIONS TAB
// ═══════════════════════════════════════════════════════════════════════════════

function SubscriptionsTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [totalCount, setTotalCount] = useState(0)
  const [showCreate, setShowCreate] = useState(false)
  const [showGenInvoice, setShowGenInvoice] = useState<TenantSubscription | null>(null)
  const [showAssignPlan, setShowAssignPlan] = useState<TenantSubscription | null>(null)
  const pagination = usePagination(totalCount)

  const { data: subs = [], isLoading } = useQuery({
    queryKey: ['billing-subscriptions', pagination.page, search],
    queryFn: async () => {
      const res = await billingService.subscriptions.list({
        ...pagination.queryParams,
        ...(search && { search }),
      })
      setTotalCount(res.totalCount)
      return res.subscriptions
    },
  })

  const { data: plans = [] } = useQuery({
    queryKey: ['billing-plans-dropdown'],
    queryFn: async () => (await billingService.plans.list({ page_size: '100' })).plans,
    staleTime: 5 * 60 * 1000,
  })

  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants-dropdown'],
    queryFn: async () => (await tenantService.list({ page_size: 200, status: 'ACTIVE' })).tenants,
    staleTime: 5 * 60 * 1000,
  })

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<Partial<TenantSubscription>>()

  const handleTenantSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const chosen = tenants.find((t) => t.id === e.target.value)
    if (chosen) {
      setValue('tenant_schema', chosen.schema_name)
      setValue('tenant_name', chosen.name)
    } else {
      setValue('tenant_schema', '')
      setValue('tenant_name', '')
    }
  }
  const { register: regInv, handleSubmit: handleInv, reset: resetInv } = useForm<{
    period_start: string; period_end: string; tax_rate: string
  }>()

  const createMutation = useMutation({
    mutationFn: (d: Partial<TenantSubscription>) => billingService.subscriptions.create(d),
    onSuccess: () => { toast.success('Subscription created!'); setShowCreate(false); reset(); qc.invalidateQueries({ queryKey: ['billing-subscriptions'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const suspendMutation = useMutation({
    mutationFn: (s: TenantSubscription) => billingService.subscriptions.suspend(s.id, 'Suspended by admin'),
    onSuccess: () => { toast.success('Suspended'); qc.invalidateQueries({ queryKey: ['billing-subscriptions'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const activateMutation = useMutation({
    mutationFn: (id: string) => billingService.subscriptions.activate(id),
    onSuccess: () => { toast.success('Activated'); qc.invalidateQueries({ queryKey: ['billing-subscriptions'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const renewMutation = useMutation({
    mutationFn: (id: string) => billingService.subscriptions.renew(id),
    onSuccess: () => { toast.success('Renewed!'); qc.invalidateQueries({ queryKey: ['billing-subscriptions'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const genInvoiceMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, string> }) =>
      billingService.subscriptions.generateInvoice(id, payload),
    onSuccess: (inv) => {
      toast.success(`Invoice ${inv.invoice_number} generated!`)
      setShowGenInvoice(null); resetInv()
      qc.invalidateQueries({ queryKey: ['billing-invoices'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const assignPlanMutation = useMutation({
    mutationFn: ({ id, planId }: { id: string; planId: string }) =>
      billingService.subscriptions.assignPlan(id, planId),
    onSuccess: () => { toast.success('AMC plan assigned!'); setShowAssignPlan(null); qc.invalidateQueries({ queryKey: ['billing-subscriptions'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const columns: Column<TenantSubscription>[] = [
    {
      key: 'tenant_name',
      header: 'Tenant',
      render: (s) => (
        <div>
          <p className="font-semibold text-gray-900">{s.tenant_name}</p>
          <code className="text-xs text-gray-400">{s.tenant_schema}</code>
        </div>
      ),
    },
    {
      key: 'plan_name',
      header: 'AMC Plan',
      render: (s) => s.plan_name
        ? <span className="font-medium text-primary-600">{s.plan_name}</span>
        : <span className="italic text-gray-400 text-sm">No plan</span>,
    },
    {
      key: 'billing_frequency',
      header: 'Billing',
      render: () => <Badge variant="info">Monthly</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (s) => (
        <Badge variant={subStatusVariant(s.status)} dot>
          {s.status_display}{s.is_in_grace_period ? ' (Grace)' : ''}
        </Badge>
      ),
    },
    {
      key: 'end_date',
      header: 'Ends',
      render: (s) => (
        <div>
          <DateDisplay date={s.end_date} />
          {s.days_remaining > 0 && s.days_remaining <= 7 && (
            <p className="text-xs text-yellow-600">{s.days_remaining}d left</p>
          )}
        </div>
      ),
    },
    {
      key: 'pending_amount',
      header: 'Outstanding',
      render: (s) => parseFloat(s.pending_amount) > 0
        ? <span className="font-semibold text-red-600">NPR {parseFloat(s.pending_amount).toLocaleString()}</span>
        : <span className="text-gray-300">—</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (s) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" title="Generate Invoice" onClick={() => setShowGenInvoice(s)}>
            <Receipt className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" title="Change AMC Plan" onClick={() => setShowAssignPlan(s)}>
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
          {s.status === 'ACTIVE' && (
            <Button size="sm" variant="ghost" title="Suspend" onClick={() => suspendMutation.mutate(s)}>
              <Ban className="h-3.5 w-3.5 text-yellow-500" />
            </Button>
          )}
          {(s.status === 'SUSPENDED' || s.status === 'EXPIRED') && (
            <Button size="sm" variant="ghost" title="Activate" onClick={() => activateMutation.mutate(s.id)}>
              <Play className="h-3.5 w-3.5 text-green-500" />
            </Button>
          )}
          {s.auto_renew && s.status === 'ACTIVE' && s.days_remaining <= 3 && (
            <Button size="sm" variant="ghost" title="Renew now" onClick={() => renewMutation.mutate(s.id)}>
              <RefreshCw className="h-3.5 w-3.5 text-blue-500" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Input
          placeholder="Search by tenant name or schema..."
          leftAddon={<Search className="h-4 w-4" />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
          New Subscription
        </Button>
      </div>

      <div className="card p-0">
        <Table columns={columns} data={subs} keyExtractor={(s) => s.id} loading={isLoading} />
        <Pagination page={pagination.page} totalPages={pagination.totalPages}
          totalCount={totalCount} pageSize={pagination.pageSize} onPageChange={pagination.setPage} />
      </div>

      {/* ── Create Subscription ────────────────────────────────────────────── */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); reset() }}
        title="New Subscription" size="md">
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4 p-6">
          {/* Hidden fields — populated by the Tenant dropdown below */}
          <input type="hidden" {...register('tenant_schema', { required: true })} />
          <input type="hidden" {...register('tenant_name', { required: true })} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <SelectField
                key={showCreate ? 'open' : 'closed'}
                label="Tenant"
                required
                onChange={handleTenantSelect}
                defaultValue=""
              >
                <option value="" disabled>— Select a tenant —</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.schema_name})
                  </option>
                ))}
              </SelectField>
              {errors.tenant_schema && (
                <p className="mt-1 text-xs text-red-600">Please select a tenant</p>
              )}
            </div>
            <SelectField label="AMC Plan" {...register('plan')}>
              <option value="">— Assign later —</option>
              {(plans as PricingPlan[]).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </SelectField>
            <SelectField label="Status" required {...register('status', { required: true })}>
              <option value="TRIAL">Trial</option>
              <option value="ACTIVE">Active</option>
            </SelectField>
            <Input label="Start Date" type="date" required
              {...register('start_date', { required: true })} />
            <Input label="End Date" type="date" required
              {...register('end_date', { required: true })} />
            <Input label="Grace Period (days)" type="number" min={0}
              placeholder="7" {...register('grace_period_days')} />
            <div className="flex items-center gap-3 pt-6">
              <input type="checkbox" id="auto_renew" {...register('auto_renew')} defaultChecked
                className="h-4 w-4 rounded border-gray-300 text-primary-600" />
              <label htmlFor="auto_renew" className="text-sm text-gray-700">Auto-renew monthly</label>
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" type="button" onClick={() => { setShowCreate(false); reset() }}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending} leftIcon={<Plus className="h-4 w-4" />}>
              Create
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Generate Invoice ───────────────────────────────────────────────── */}
      <Modal open={!!showGenInvoice} onClose={() => { setShowGenInvoice(null); resetInv() }}
        title={`Generate Invoice — ${showGenInvoice?.tenant_name}`} size="sm">
        <form onSubmit={handleInv((d) =>
          genInvoiceMutation.mutate({ id: showGenInvoice!.id, payload: d as Record<string, string> })
        )} className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Period Start" type="date" required {...regInv('period_start', { required: true })} />
            <Input label="Period End" type="date" required {...regInv('period_end', { required: true })} />
          </div>
          <Input label="VAT Rate (%)" type="number" step="0.01" placeholder="13"
            {...regInv('tax_rate')} />
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" type="button" onClick={() => { setShowGenInvoice(null); resetInv() }}>Cancel</Button>
            <Button type="submit" loading={genInvoiceMutation.isPending} leftIcon={<Receipt className="h-4 w-4" />}>
              Generate
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Assign Plan ────────────────────────────────────────────────────── */}
      {showAssignPlan && (
        <AssignPlanModal
          sub={showAssignPlan}
          plans={plans as PricingPlan[]}
          onClose={() => setShowAssignPlan(null)}
          onAssign={(planId) => assignPlanMutation.mutate({ id: showAssignPlan.id, planId })}
          loading={assignPlanMutation.isPending}
        />
      )}
    </div>
  )
}

function AssignPlanModal({ sub, plans, onClose, onAssign, loading }: {
  sub: TenantSubscription
  plans: PricingPlan[]
  onClose: () => void
  onAssign: (planId: string) => void
  loading: boolean
}) {
  const [selected, setSelected] = useState<string>(sub.plan ?? '')

  return (
    <Modal open onClose={onClose} title={`Change AMC Plan — ${sub.tenant_name}`} size="md">
      <div className="space-y-4 p-6">
        <p className="text-sm text-gray-500">
          Current plan: <strong>{sub.plan_name ?? 'None'}</strong>
        </p>
        <div className="space-y-2">
          {(plans as PricingPlan[]).filter((p) => p.is_active).map((p) => {
            const rule = p.commission_rules.find((r) => r.is_active)
            const isPercent = rule?.billing_model === 'PERCENTAGE'
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(p.id)}
                className={cn(
                  'w-full rounded-xl border-2 px-4 py-3 text-left transition-all flex items-center justify-between',
                  selected === p.id
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 hover:border-primary-200'
                )}
              >
                <div>
                  <p className="font-semibold text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Monthly AMC</p>
                </div>
                {rule && (
                  <div className={cn(
                    'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold',
                    isPercent ? 'bg-purple-50 text-purple-700' : 'bg-green-50 text-green-700'
                  )}>
                    {isPercent
                      ? <><Percent className="h-4 w-4" />{rule.rate}%</>
                      : <><DollarSign className="h-4 w-4" />NPR {parseFloat(rule.rate).toLocaleString()}</>
                    }
                  </div>
                )}
              </button>
            )
          })}
          {plans.filter((p) => p.is_active).length === 0 && (
            <p className="text-center text-sm text-gray-400 py-4">
              No AMC plans available. Create one in the Plans tab first.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t pt-4">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button loading={loading} disabled={!selected} onClick={() => selected && onAssign(selected)}>
            Assign Plan
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVOICES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function InvoicesTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [totalCount, setTotalCount] = useState(0)
  const [detail, setDetail] = useState<Invoice | null>(null)
  const pagination = usePagination(totalCount)

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['billing-invoices', pagination.page, search, statusFilter],
    queryFn: async () => {
      const res = await billingService.invoices.list({
        ...pagination.queryParams,
        ...(search && { search }),
        ...(statusFilter && { payment_status: statusFilter }),
      })
      setTotalCount(res.totalCount)
      return res.invoices
    },
  })

  const markPaidMutation = useMutation({
    mutationFn: (id: string) => billingService.invoices.markPaid(id),
    onSuccess: (inv) => { toast.success(`${inv.invoice_number} marked as paid`); qc.invalidateQueries({ queryKey: ['billing-invoices'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const columns: Column<Invoice>[] = [
    {
      key: 'invoice_number',
      header: 'Invoice #',
      render: (inv) => (
        <button className="font-mono text-sm font-bold text-primary-600 hover:underline"
          onClick={() => setDetail(inv)}>
          {inv.invoice_number}
        </button>
      ),
    },
    {
      key: 'tenant_name',
      header: 'Tenant',
      render: (inv) => (
        <div>
          <p className="font-medium text-gray-900">{inv.tenant_name}</p>
          <p className="text-xs text-gray-400">{inv.billing_period_start} → {inv.billing_period_end}</p>
        </div>
      ),
    },
    {
      key: 'total_amount',
      header: 'Amount',
      render: (inv) => (
        <div>
          <p className="font-bold">NPR {parseFloat(inv.total_amount).toLocaleString()}</p>
          {parseFloat(inv.tax_amount) > 0 && (
            <p className="text-xs text-gray-400">incl. VAT {inv.tax_rate}%</p>
          )}
        </div>
      ),
    },
    {
      key: 'payment_status',
      header: 'Status',
      render: (inv) => (
        <div className="flex items-center gap-2">
          <Badge variant={invoiceStatusVariant(inv.payment_status)} dot>
            {inv.payment_status_display}
          </Badge>
          {inv.is_overdue && <span className="text-xs text-red-500">{inv.days_overdue}d late</span>}
        </div>
      ),
    },
    {
      key: 'due_date',
      header: 'Due',
      render: (inv) => <DateDisplay date={inv.due_date} />,
    },
    {
      key: 'actions',
      header: '',
      render: (inv) => (
        (inv.payment_status === 'PENDING' || inv.payment_status === 'OVERDUE') ? (
          <Button size="sm" variant="ghost"
            leftIcon={<CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
            onClick={() => markPaidMutation.mutate(inv.id)}
            loading={markPaidMutation.isPending}>
            Mark Paid
          </Button>
        ) : null
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Search invoice or tenant..." leftAddon={<Search className="h-4 w-4" />}
          value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="PAID">Paid</option>
          <option value="OVERDUE">Overdue</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      <div className="card p-0">
        <Table columns={columns} data={invoices} keyExtractor={(i) => i.id} loading={isLoading} />
        <Pagination page={pagination.page} totalPages={pagination.totalPages}
          totalCount={totalCount} pageSize={pagination.pageSize} onPageChange={pagination.setPage} />
      </div>

      {detail && <InvoiceDetailModal invoice={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

function InvoiceDetailModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`Invoice — ${invoice.invoice_number}`} size="md">
      <div className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm">
          <div><p className="text-xs font-medium uppercase text-gray-400">Tenant</p>
            <p className="font-semibold">{invoice.tenant_name}</p></div>
          <div><p className="text-xs font-medium uppercase text-gray-400">Period</p>
            <p className="font-medium">{invoice.billing_period_start} → {invoice.billing_period_end}</p></div>
          <div><p className="text-xs font-medium uppercase text-gray-400">Due Date</p>
            <DateDisplay date={invoice.due_date} /></div>
          <div><p className="text-xs font-medium uppercase text-gray-400">Status</p>
            <Badge variant={invoiceStatusVariant(invoice.payment_status)} dot>
              {invoice.payment_status_display}
            </Badge></div>
        </div>

        {/* Line items */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2.5 text-left">Description</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoice.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">{item.description}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    NPR {parseFloat(item.amount).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="ml-auto max-w-[220px] space-y-1 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Subtotal</span><span>NPR {parseFloat(invoice.subtotal).toLocaleString()}</span>
          </div>
          {parseFloat(invoice.tax_amount) > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>VAT ({invoice.tax_rate}%)</span>
              <span>NPR {parseFloat(invoice.tax_amount).toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between border-t pt-1 text-base font-bold text-gray-900">
            <span>Total</span><span>NPR {parseFloat(invoice.total_amount).toLocaleString()}</span>
          </div>
        </div>

        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// AMC PLANS TAB — create a plan with billing model + rate in one step
// ═══════════════════════════════════════════════════════════════════════════════

interface PlanForm {
  name: string
  description: string
  billing_model: 'FIXED_AMOUNT' | 'PERCENTAGE'
  rate: string
}

function PlansTab() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const pagination = usePagination(totalCount)

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['billing-plans', pagination.page],
    queryFn: async () => {
      const res = await billingService.plans.list({ ...pagination.queryParams })
      setTotalCount(res.totalCount)
      return res.plans
    },
  })

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<PlanForm>({
    defaultValues: { billing_model: 'FIXED_AMOUNT' },
  })
  const billingModel = watch('billing_model')

  const createMutation = useMutation({
    mutationFn: async (d: PlanForm) => {
      // 1. Create the plan
      const plan = await billingService.plans.create({
        name: d.name,
        description: d.description,
        billing_frequency: 'MONTHLY',
        is_active: true,
      })
      // 2. Auto-attach the AMC rule
      await billingService.plans.addRule(plan.id, {
        name: `${d.name} — AMC`,
        rule_type: 'AMC',
        billing_model: d.billing_model,
        rate: d.rate,
        description: d.description,
        is_active: true,
      } as never)
      return plan
    },
    onSuccess: () => {
      toast.success('AMC plan created!')
      setShowCreate(false)
      reset()
      qc.invalidateQueries({ queryKey: ['billing-plans'] })
      qc.invalidateQueries({ queryKey: ['billing-plans-dropdown'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
          New AMC Plan
        </Button>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {/* Plans grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(plans as PricingPlan[]).map((plan) => {
          const rule = plan.commission_rules.find((r) => r.is_active)
          const isPercent = rule?.billing_model === 'PERCENTAGE'
          return (
            <div key={plan.id} className="card flex flex-col gap-3">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{plan.name}</p>
                  <Badge variant="info" className="mt-1">Monthly AMC</Badge>
                </div>
                {!plan.is_active && <Badge variant="neutral">Inactive</Badge>}
              </div>

              {/* Rate pill */}
              {rule ? (
                <div className={cn(
                  'inline-flex items-center gap-2 rounded-xl px-4 py-3 self-start',
                  isPercent ? 'bg-purple-50' : 'bg-green-50'
                )}>
                  {isPercent
                    ? <Percent className="h-5 w-5 text-purple-600" />
                    : <DollarSign className="h-5 w-5 text-green-600" />}
                  <div>
                    <p className={cn(
                      'text-xl font-bold leading-none',
                      isPercent ? 'text-purple-700' : 'text-green-700'
                    )}>
                      {isPercent ? `${rule.rate}%` : `NPR ${parseFloat(rule.rate).toLocaleString()}`}
                    </p>
                    <p className={cn(
                      'text-xs mt-0.5',
                      isPercent ? 'text-purple-500' : 'text-green-500'
                    )}>
                      {isPercent ? 'of monthly revenue' : 'per month (fixed)'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm italic text-gray-400">No rate configured</p>
              )}

              {plan.description && (
                <p className="text-xs text-gray-500">{plan.description}</p>
              )}
            </div>
          )
        })}

        {!isLoading && plans.length === 0 && (
          <div className="col-span-full rounded-xl border-2 border-dashed border-gray-200 p-10 text-center">
            <CreditCard className="mx-auto mb-3 h-10 w-10 text-gray-300" />
            <p className="text-gray-500">No AMC plans yet.</p>
            <Button className="mt-4" onClick={() => setShowCreate(true)}>Create First Plan</Button>
          </div>
        )}
      </div>

      {/* ── Create AMC Plan Modal — single form ─────────────────────────────── */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); reset() }}
        title="New AMC Plan" size="sm">
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4 p-6">
          <Input
            label="Plan Name"
            required
            placeholder="e.g. Standard AMC, Enterprise AMC"
            error={errors.name?.message}
            {...register('name', { required: 'Required' })}
          />

          {/* Billing Model dropdown — the key selector */}
          <SelectField
            label="Billing Model"
            required
            {...register('billing_model', { required: true })}
          >
            <option value="FIXED_AMOUNT">Fixed Amount (NPR per month)</option>
            <option value="PERCENTAGE">Percentage (% of monthly revenue)</option>
          </SelectField>

          {/* Rate */}
          <Input
            label={billingModel === 'PERCENTAGE' ? 'Percentage Rate (%)' : 'Monthly Amount (NPR)'}
            type="number"
            step="0.01"
            required
            placeholder={billingModel === 'PERCENTAGE' ? 'e.g. 6.5' : 'e.g. 15000'}
            error={errors.rate?.message}
            {...register('rate', { required: 'Required', min: { value: 0.01, message: 'Must be > 0' } })}
          />

          {/* Live preview */}
          {watch('rate') && (
            <div className={cn(
              'rounded-lg px-4 py-3 text-sm',
              billingModel === 'PERCENTAGE' ? 'bg-purple-50 text-purple-700' : 'bg-green-50 text-green-700'
            )}>
              {billingModel === 'PERCENTAGE'
                ? <>Tenant will be charged <strong>{watch('rate')}%</strong> of their monthly ticket revenue</>
                : <>Tenant will be charged <strong>NPR {parseFloat(watch('rate') || '0').toLocaleString()}</strong> per month (fixed)</>
              }
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Description (optional)</label>
            <textarea rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Any notes about this plan..." {...register('description')} />
          </div>

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" type="button" onClick={() => { setShowCreate(false); reset() }}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending} leftIcon={<Plus className="h-4 w-4" />}>
              Create AMC Plan
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT LOG TAB
// ═══════════════════════════════════════════════════════════════════════════════

function AuditTab() {
  const [search, setSearch] = useState('')
  const [totalCount, setTotalCount] = useState(0)
  const pagination = usePagination(totalCount)

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['billing-audit', pagination.page, search],
    queryFn: async () => {
      const res = await billingService.auditLogs.list({ ...pagination.queryParams, ...(search && { search }) })
      setTotalCount(res.totalCount)
      return res.logs
    },
  })

  function actionVariant(action: string) {
    if (action.includes('PAYMENT')) return 'success'
    if (action.includes('SUSPENDED') || action.includes('FAILED')) return 'danger'
    if (action.includes('EXPIRED')) return 'warning'
    if (action.includes('ACTIVATED') || action.includes('RENEWED')) return 'info'
    return 'neutral'
  }

  return (
    <div className="space-y-4">
      <Input placeholder="Search by tenant or email..." leftAddon={<Search className="h-4 w-4" />}
        value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      <div className="card divide-y divide-gray-100 p-0">
        {isLoading && <div className="p-6 text-center text-sm text-gray-400">Loading…</div>}
        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-4 px-5 py-4">
            <History className="mt-0.5 h-4 w-4 shrink-0 text-gray-300" />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={actionVariant(log.action) as 'neutral'}>{log.action_display}</Badge>
                <code className="text-xs text-gray-500">{log.tenant_schema}</code>
                {log.performed_by_email && (
                  <span className="text-xs text-gray-400">by {log.performed_by_email}</span>
                )}
              </div>
              {Object.keys(log.details).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                  {Object.entries(log.details).slice(0, 4).map(([k, v]) => (
                    <span key={k} className="text-xs text-gray-400">
                      <span className="font-medium text-gray-500">{k}:</span> {String(v)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <time className="shrink-0 text-xs text-gray-400">
              {new Date(log.created_at).toLocaleString()}
            </time>
          </div>
        ))}
        {!isLoading && logs.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-400">No audit entries yet.</div>
        )}
        <div className="p-3">
          <Pagination page={pagination.page} totalPages={pagination.totalPages}
            totalCount={totalCount} pageSize={pagination.pageSize} onPageChange={pagination.setPage} />
        </div>
      </div>
    </div>
  )
}
