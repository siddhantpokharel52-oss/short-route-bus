import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen, ChevronDown, Plus, FileText,
  TrendingUp, TrendingDown, BarChart3, CheckCircle, RotateCcw,
  Wallet, Users, Fuel, Wrench, ArrowUpDown, AlertCircle, Ticket,
  Calendar, Search, X, Printer, Activity, CreditCard, Building2,
  Receipt, BadgeCheck, Clock,
} from 'lucide-react'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import ChartOfAccountsPanel from './ChartOfAccountsPanel'

// ─── Types ──────────────────────────────────────────────────────────────────

type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'

interface COA {
  id: string; code: string; name: string; account_type: AccountType
  parent: string | null; balance: string; is_system: boolean
  is_active: boolean; is_group: boolean; is_posting_allowed: boolean
  children_count: number; children?: COA[]
}
interface JELine {
  id?: string; account: string; account_code?: string; account_name?: string
  description: string; debit: string; credit: string
}
interface JournalEntry {
  id: string; entry_no: string; date: string; description: string
  status: 'DRAFT' | 'POSTED' | 'REVERSED'; source_type: string
  reference_no: string; total_debit: string; total_credit: string
  lines: JELine[]; created_at: string
}
interface SalaryPayment {
  id: string; employee_id: string; employee_name: string
  employee_type: 'DRIVER' | 'CONDUCTOR' | 'STAFF'
  period_from: string; period_to: string; payment_date: string
  basic_salary: string; total_allowances: string; deductions: string
  net_pay: string; payment_method: string; status: 'DRAFT' | 'PAID'
  journal_entry_no: string | null; notes: string
}
interface DashboardKPIs {
  month: string; revenue_mtd: string; expenses_mtd: string
  net_profit_mtd: string; cash_balance: string
  accounts_receivable: string; accounts_payable: string
}

// ─── Constants & Helpers ─────────────────────────────────────────────────────

const TYPE_META: Record<AccountType, { label: string; dot: string; badge: string }> = {
  ASSET:     { label: 'Asset',     dot: 'bg-blue-500',   badge: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-800' },
  LIABILITY: { label: 'Liability', dot: 'bg-red-500',    badge: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800' },
  EQUITY:    { label: 'Equity',    dot: 'bg-purple-500', badge: 'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:ring-purple-800' },
  INCOME:    { label: 'Income',    dot: 'bg-emerald-500',badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800' },
  EXPENSE:   { label: 'Expense',   dot: 'bg-orange-500', badge: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:ring-orange-800' },
}

const STATUS_META: Record<string, { badge: string; icon: React.ElementType }> = {
  DRAFT:    { badge: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-800', icon: Clock },
  POSTED:   { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-800', icon: BadgeCheck },
  REVERSED: { badge: 'bg-gray-100 text-gray-500 ring-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:ring-gray-600', icon: RotateCcw },
  PAID:     { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-800', icon: BadgeCheck },
}

const fmt = (n: string | number) =>
  `NPR ${parseFloat(String(n)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`

const tabs = ['Overview', 'Chart of Accounts', 'Journal Entries', 'Salary Payments', 'Reports'] as const
type Tab = typeof tabs[number]

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon: Icon, sub }: {
  label: string; value: string; icon: React.ElementType; sub?: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 flex items-center gap-4">
      <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-primary-600 flex items-center justify-center shadow-md shadow-primary-600/25">
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{label}</p>
        <p className="mt-0.5 text-xl font-bold text-gray-900 dark:text-white truncate">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// CoaRow removed — replaced by ChartOfAccountsPanel

// ─── New Journal Entry Modal ──────────────────────────────────────────────────

function flattenTree(nodes: any[]): any[] {
  const result: any[] = []
  function walk(n: any) { result.push(n); (n.children ?? []).forEach(walk) }
  nodes.forEach(walk)
  return result
}

function NewJournalEntryModal({ onClose, onSuccess }: {
  onClose: () => void; onSuccess: () => void
}) {
  // Fetch inside modal — React Query deduplicates: serves from cache if already loaded,
  // otherwise fires one request. This avoids the prop-timing race where accounts=[]
  // when the modal first renders and the native <select> doesn't repaint on update.
  const { data: treeData = [] } = useQuery<any[]>({
    queryKey: ['coa-tree'],
    queryFn: () => apiClient.get('/accounting/accounts/tree/').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })
  const leafAccounts = flattenTree(treeData).filter(
    a => a.is_posting_allowed !== false && !a.is_group
  )

  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [description, setDescription] = useState('')
  const [postNow, setPostNow] = useState(false)
  const [lines, setLines] = useState<JELine[]>([
    { account: '', description: '', debit: '', credit: '' },
    { account: '', description: '', debit: '', credit: '' },
  ])
  const totalDr = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0)
  const totalCr = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0)
  const diff = Math.abs(totalDr - totalCr)
  const balanced = diff < 0.01 && totalDr > 0

  const mutation = useMutation({
    mutationFn: (payload: object) => apiClient.post('/accounting/journal-entries/', payload).then(r => r.data),
    onSuccess: () => { toast.success('Journal entry created'); onSuccess(); onClose() },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Failed to create entry'),
  })

  const submit = () => {
    if (!description.trim()) return toast.error('Description is required')
    if (!balanced) return toast.error('Debits must equal credits')
    const filtered = lines.filter(l => l.account && (parseFloat(l.debit) || parseFloat(l.credit)))
    mutation.mutate({
      date, description, status: postNow ? 'POSTED' : 'DRAFT', source_type: 'MANUAL',
      lines: filtered.map(l => ({
        account: l.account, description: l.description,
        debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0,
      })),
    })
  }

  const updateLine = (i: number, field: keyof JELine, val: string) => {
    const next = lines.map((l, j) => {
      if (j !== i) return l
      const updated = { ...l, [field]: val }
      if (field === 'debit' && val) updated.credit = ''
      if (field === 'credit' && val) updated.debit = ''
      return updated
    })
    setLines(next)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backdropFilter: 'blur(4px)', backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-3xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-primary-600 to-primary-700 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/20 p-2">
              <Receipt className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">New Journal Entry</h2>
              <p className="text-xs text-primary-200">Double-entry — debits must equal credits</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-white/60 hover:text-white hover:bg-white/10 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Date + Description */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                <Calendar className="h-3 w-3 inline mr-1" />Date
              </label>
              <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Description
              </label>
              <input className="input" placeholder="e.g. Monthly pass revenue adjustment…" value={description} onChange={e => setDescription(e.target.value)} />
            </div>
          </div>

          {/* Lines table */}
          <div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="grid grid-cols-[2fr_1.8fr_1fr_1fr_40px] gap-0 bg-gray-50 dark:bg-gray-800 px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <span>Account</span>
                <span>Memo</span>
                <span className="text-right">Debit (NPR)</span>
                <span className="text-right">Credit (NPR)</span>
                <span />
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
                {lines.map((line, i) => (
                  <div key={i} className="grid grid-cols-[2fr_1.8fr_1fr_1fr_40px] gap-0 items-center px-4 py-2.5 hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors">
                    <div className="pr-3">
                      <select
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-2.5 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        value={line.account}
                        onChange={e => updateLine(i, 'account', e.target.value)}
                      >
                        <option value="">Select account…</option>
                        {leafAccounts.map(a => (
                          <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="pr-3">
                      <input
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-2.5 py-1.5 text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        placeholder="Line description"
                        value={line.description}
                        onChange={e => updateLine(i, 'description', e.target.value)}
                      />
                    </div>
                    <div className="pr-3">
                      <input
                        type="number" min="0" step="0.01"
                        className={`w-full rounded-lg border text-sm px-2.5 py-1.5 text-right font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent ${parseFloat(line.debit) > 0 ? 'border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-700 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'}`}
                        placeholder="0.00"
                        value={line.debit}
                        onChange={e => updateLine(i, 'debit', e.target.value)}
                      />
                    </div>
                    <div className="pr-2">
                      <input
                        type="number" min="0" step="0.01"
                        className={`w-full rounded-lg border text-sm px-2.5 py-1.5 text-right font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent ${parseFloat(line.credit) > 0 ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300' : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'}`}
                        placeholder="0.00"
                        value={line.credit}
                        onChange={e => updateLine(i, 'credit', e.target.value)}
                      />
                    </div>
                    <button
                      onClick={() => lines.length > 2 && setLines(lines.filter((_, j) => j !== i))}
                      className="flex items-center justify-center w-7 h-7 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2.5 border-t border-dashed border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setLines([...lines, { account: '', description: '', debit: '', credit: '' }])}
                  className="flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 font-medium hover:text-primary-700 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Line
                </button>
              </div>
            </div>
          </div>

          {/* Balance indicator */}
          <div className={`flex items-center justify-between rounded-xl p-4 ${balanced ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800' : 'bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700'}`}>
            <div className="flex gap-8 text-sm">
              <span className="text-gray-500 dark:text-gray-400">
                Total Debit: <strong className="font-mono text-blue-700 dark:text-blue-300 ml-1">{fmt(totalDr)}</strong>
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                Total Credit: <strong className="font-mono text-emerald-700 dark:text-emerald-300 ml-1">{fmt(totalCr)}</strong>
              </span>
            </div>
            {totalDr > 0 && (
              balanced
                ? <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle className="h-4 w-4" />Balanced</span>
                : <span className="flex items-center gap-1.5 text-sm font-semibold text-red-500"><AlertCircle className="h-4 w-4" />Difference: {fmt(diff)}</span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <div
              onClick={() => setPostNow(!postNow)}
              className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${postNow ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${postNow ? 'translate-x-4' : ''}`} />
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Post immediately</span>
          </label>
          <div className="flex gap-3">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button
              onClick={submit}
              disabled={mutation.isPending || !balanced}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mutation.isPending ? (
                <><span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</>
              ) : (
                <><CheckCircle className="h-4 w-4" />{postNow ? 'Create & Post' : 'Save as Draft'}</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── New Salary Modal ─────────────────────────────────────────────────────────

function NewSalaryModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    employee_id: '', employee_name: '', employee_type: 'DRIVER',
    period_from: '', period_to: '', payment_date: new Date().toISOString().split('T')[0],
    basic_salary: '', total_allowances: '', deductions: '', net_pay: '',
    payment_method: 'BANK_TRANSFER', notes: '',
  })

  const set = (k: string, v: string) => {
    const u = { ...form, [k]: v }
    const net = (parseFloat(u.basic_salary) || 0) + (parseFloat(u.total_allowances) || 0) - (parseFloat(u.deductions) || 0)
    u.net_pay = net > 0 ? String(net.toFixed(2)) : ''
    setForm(u)
  }

  const changeRole = (role: string) => {
    setForm(f => ({
      ...f,
      employee_type: role, employee_id: '', employee_name: '',
      basic_salary: '', total_allowances: '', net_pay: '',
    }))
    setAllowanceItems([])
  }

  const [allowanceItems, setAllowanceItems] = useState<{ title: string; amount: number }[]>([])

  const selectEmployee = (emp: EmployeeOption | null) => {
    if (!emp) {
      setForm(f => ({ ...f, employee_id: '', employee_name: '', basic_salary: '', total_allowances: '', net_pay: '' }))
      setAllowanceItems([])
      return
    }
    const basicStr = emp.basic_salary != null ? String(emp.basic_salary) : ''
    const items: { title: string; amount: number }[] = Array.isArray(emp.allowances) ? emp.allowances : []
    const totalAllow = items.reduce((s, a) => s + (Number(a.amount) || 0), 0)
    const totalAllowStr = totalAllow > 0 ? String(totalAllow.toFixed(2)) : ''
    const deduct = parseFloat(form.deductions) || 0
    const net = (parseFloat(basicStr) || 0) + totalAllow - deduct
    setAllowanceItems(items)
    setForm(f => ({
      ...f,
      employee_id: emp.id,
      employee_name: emp.full_name_en,
      basic_salary: basicStr,
      total_allowances: totalAllowStr,
      net_pay: net > 0 ? String(net.toFixed(2)) : '',
    }))
  }

  const { data: driverData } = useQuery({
    queryKey: ['salary-drivers'],
    queryFn: () => apiClient.get('/operator/drivers/?page_size=200').then(r => r.data),
    enabled: form.employee_type === 'DRIVER',
    staleTime: 2 * 60 * 1000,
  })
  const { data: conductorData } = useQuery({
    queryKey: ['salary-conductors'],
    queryFn: () => apiClient.get('/operator/conductors/?page_size=200').then(r => r.data),
    enabled: form.employee_type === 'CONDUCTOR',
    staleTime: 2 * 60 * 1000,
  })

  type EmployeeOption = { id: string; employee_id: string; full_name_en: string; basic_salary: number | null; allowances: { title: string; amount: number }[] }

  const employeeList: EmployeeOption[] =
    form.employee_type === 'DRIVER'
      ? (driverData?.data ?? driverData?.results ?? driverData ?? [])
      : form.employee_type === 'CONDUCTOR'
      ? (conductorData?.data ?? conductorData?.results ?? conductorData ?? [])
      : []

  const mutation = useMutation({
    mutationFn: (data: object) => apiClient.post('/accounting/salary-payments/', data).then(r => r.data),
    onSuccess: () => { toast.success('Salary record created'); onSuccess(); onClose() },
    onError: (e: any) => {
      const data = e?.response?.data
      if (data && typeof data === 'object') {
        const first = Object.entries(data)[0]
        if (first) { toast.error(`${first[0]}: ${first[1]}`); return }
      }
      toast.error(data?.detail || 'Failed to create record')
    },
  })

  const submitSalary = () => {
    if (!form.employee_name) return toast.error('Select an employee')
    if (form.employee_type !== 'STAFF' && !form.employee_id) return toast.error('Select an employee from the dropdown')
    if (!form.period_from) return toast.error('Period From date is required')
    if (!form.period_to) return toast.error('Period To date is required')
    if (!form.basic_salary) return toast.error('Basic Salary is required')
    if (form.period_from > form.period_to) return toast.error('Period From must be before Period To')
    mutation.mutate(form)
  }

  const netPay = parseFloat(form.net_pay) || 0
  const canSubmit = !!(form.employee_name && form.period_from && form.period_to && form.basic_salary)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backdropFilter: 'blur(4px)', backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-primary-600 to-primary-700 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/20 p-2"><Users className="h-5 w-5 text-white" /></div>
            <div>
              <h2 className="text-base font-bold text-white">Add Salary Payment</h2>
              <p className="text-xs text-primary-200">Auto-generates journal entry when paid</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-white/60 hover:text-white hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">

          {/* Step 1 — Role */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary-600 text-white text-[10px] font-bold mr-1.5">1</span>
              Role
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'DRIVER',    label: 'Driver' },
                { value: 'CONDUCTOR', label: 'Collector' },
                { value: 'STAFF',     label: 'Other Staff' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => changeRole(opt.value)}
                  className={`rounded-xl border-2 py-2.5 text-sm font-semibold transition-all ${
                    form.employee_type === opt.value
                      ? 'border-primary-600 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-500'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2 — Employee */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary-600 text-white text-[10px] font-bold mr-1.5">2</span>
              Employee Name
            </label>
            {form.employee_type === 'STAFF' ? (
              <input
                className="input"
                placeholder="Full name"
                value={form.employee_name}
                onChange={e => setForm(f => ({ ...f, employee_name: e.target.value }))}
              />
            ) : (
              <select
                className="input"
                value={form.employee_id}
                onChange={e => {
                  const emp = employeeList.find(x => x.id === e.target.value)
                  selectEmployee(emp ?? null)
                }}
              >
                <option value="">
                  {employeeList.length === 0
                    ? `No ${form.employee_type === 'DRIVER' ? 'drivers' : 'conductors'} found`
                    : `Select ${form.employee_type === 'DRIVER' ? 'driver' : 'conductor'}…`}
                </option>
                {employeeList.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name_en} ({emp.employee_id})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5 text-gray-500 dark:text-gray-400">
                Period From <span className="text-red-400">*</span>
              </label>
              <input
                type="date" value={form.period_from}
                onChange={e => set('period_from', e.target.value)}
                className={`input ${!form.period_from ? 'border-red-200 dark:border-red-800 focus:ring-red-400' : ''}`}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5 text-gray-500 dark:text-gray-400">
                Period To <span className="text-red-400">*</span>
              </label>
              <input
                type="date" value={form.period_to}
                onChange={e => set('period_to', e.target.value)}
                className={`input ${!form.period_to ? 'border-red-200 dark:border-red-800 focus:ring-red-400' : ''}`}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Payment Date</label>
              <input type="date" className="input" value={form.payment_date} onChange={e => set('payment_date', e.target.value)} />
            </div>
          </div>

          {/* Salary breakdown box */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center justify-between">
              <span>Salary Breakdown</span>
              {form.employee_id && <span className="text-primary-500 font-medium normal-case">Auto-filled from employee record</span>}
            </div>
            <div className="p-4 grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Basic Salary</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-xs text-gray-400">NPR</span>
                  <input type="number" className="input pl-10 font-mono" placeholder="0.00" value={form.basic_salary} onChange={e => set('basic_salary', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-1.5">+ Allowances</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-xs text-gray-400">NPR</span>
                  <input type="number" className="input pl-10 font-mono border-emerald-200 dark:border-emerald-800" placeholder="0.00" value={form.total_allowances} onChange={e => set('total_allowances', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-red-500 dark:text-red-400 mb-1.5">− Deductions</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-xs text-gray-400">NPR</span>
                  <input type="number" className="input pl-10 font-mono border-red-200 dark:border-red-800" placeholder="0.00" value={form.deductions} onChange={e => set('deductions', e.target.value)} />
                </div>
              </div>
            </div>

            {/* Allowances breakdown from employee record */}
            {allowanceItems.length > 0 && (
              <div className="mx-4 mb-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-100 dark:border-emerald-800 px-3 py-2">
                <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1.5">Allowance Details</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {allowanceItems.map((a, i) => (
                    <span key={i} className="text-xs text-emerald-700 dark:text-emerald-300">
                      {a.title}: <span className="font-mono font-semibold">NPR {Number(a.amount).toLocaleString('en-IN')}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Net pay summary */}
            <div className="mx-4 mb-4 rounded-xl bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 p-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-primary-700 dark:text-primary-300">Net Pay</span>
              <span className="font-mono text-lg font-bold text-primary-700 dark:text-primary-300">{netPay > 0 ? fmt(netPay) : '—'}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Payment Method</label>
            <select className="input" value={form.payment_method} onChange={e => set('payment_method', e.target.value)}>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="CASH">Cash</option>
              <option value="CHEQUE">Cheque</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Notes (optional)</label>
            <textarea className="input resize-none" rows={2} placeholder="Any remarks…" value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={submitSalary} disabled={mutation.isPending || !canSubmit}
            className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {mutation.isPending
              ? <><span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</>
              : <><CheckCircle className="h-4 w-4" />Create Record</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Reports ─────────────────────────────────────────────────────────────────

type ReportType = 'profit-loss' | 'balance-sheet' | 'trial-balance' | 'cash-flow' | 'expense-analysis' | 'general-ledger'

const REPORT_TYPES: { id: ReportType; label: string; icon: React.ElementType; desc: string }[] = [
  { id: 'profit-loss',      label: 'Profit & Loss',   icon: TrendingUp,  desc: 'Revenue vs expenses summary' },
  { id: 'balance-sheet',    label: 'Balance Sheet',   icon: Building2,   desc: 'Assets, liabilities & equity' },
  { id: 'trial-balance',    label: 'Trial Balance',   icon: ArrowUpDown, desc: 'All accounts Dr/Cr totals' },
  { id: 'cash-flow',        label: 'Cash Flow',       icon: Activity,    desc: 'Cash inflows & outflows' },
  { id: 'expense-analysis', label: 'Expense Analysis',icon: BarChart3,   desc: 'Expense breakdown by account' },
  { id: 'general-ledger',   label: 'General Ledger',  icon: FileText,    desc: 'Transaction-level detail' },
]

function ReportsPanel({ accounts }: { accounts: COA[] }) {
  const [reportType, setReportType] = useState<ReportType>('profit-loss')
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0] })
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [glAccount, setGlAccount] = useState('')
  const [fetched, setFetched] = useState(false)

  const needsRange = ['profit-loss', 'cash-flow', 'expense-analysis', 'general-ledger'].includes(reportType)
  const leafAccounts = accounts.filter(a => a.is_posting_allowed !== false && !a.is_group)

  const queryUrl = (() => {
    const p = new URLSearchParams()
    if (needsRange) { p.set('date_from', dateFrom); p.set('date_to', dateTo) }
    else p.set('date', dateTo)
    if (reportType === 'general-ledger' && glAccount) p.set('account_id', glAccount)
    return `/accounting/reports/${reportType}/?${p}`
  })()

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['report', reportType, dateFrom, dateTo, glAccount],
    queryFn: () => apiClient.get(queryUrl).then(r => r.data),
    enabled: fetched,
  })

  const run = () => { setFetched(true); setTimeout(refetch, 0) }

  const current = REPORT_TYPES.find(r => r.id === reportType)!

  return (
    <div className="space-y-5">
      {/* Report type selector cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {REPORT_TYPES.map(r => {
          const Icon = r.icon
          const active = r.id === reportType
          return (
            <button
              key={r.id}
              onClick={() => { setReportType(r.id); setFetched(false) }}
              className={`rounded-xl p-3 text-left border transition-all ${active
                ? 'bg-primary-600 border-primary-600 shadow-md shadow-primary-600/20'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-700'
              }`}
            >
              <Icon className={`h-5 w-5 mb-2 ${active ? 'text-white' : 'text-gray-400 dark:text-gray-500'}`} />
              <p className={`text-xs font-bold leading-tight ${active ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>{r.label}</p>
              <p className={`text-xs mt-0.5 leading-tight ${active ? 'text-primary-200' : 'text-gray-400 dark:text-gray-500'}`}>{r.desc}</p>
            </button>
          )
        })}
      </div>

      {/* Parameters bar */}
      <div className="flex flex-wrap items-end gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        {needsRange ? (
          <>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">From</label>
              <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">To</label>
              <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
          </>
        ) : (
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">As of Date</label>
            <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
        )}
        {reportType === 'general-ledger' && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Account</label>
            <select className="input w-52" value={glAccount} onChange={e => setGlAccount(e.target.value)}>
              <option value="">All accounts</option>
              {leafAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex gap-2 ml-auto">
          {data && (
            <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2">
              <Printer className="h-4 w-4" /> Print
            </button>
          )}
          <button
            onClick={run}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors disabled:opacity-60"
          >
            {isLoading
              ? <><span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Generating…</>
              : <><BarChart3 className="h-4 w-4" />Generate Report</>}
          </button>
        </div>
      </div>

      {/* Report output */}
      {!fetched && !data && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="rounded-2xl bg-gray-100 dark:bg-gray-800 p-5 mb-4">
            <current.icon className="h-8 w-8 text-gray-400" />
          </div>
          <p className="text-base font-semibold text-gray-700 dark:text-gray-300">{current.label}</p>
          <p className="text-sm text-gray-400 mt-1">{current.desc}</p>
          <p className="text-xs text-gray-300 dark:text-gray-600 mt-3">Set your date range and click Generate Report</p>
        </div>
      )}

      {data && !isLoading && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden print:shadow-none">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white">{current.label}</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {needsRange ? `${dateFrom} to ${dateTo}` : `As of ${dateTo}`}
              </p>
            </div>
            <span className="text-xs text-gray-400">Shangrila City Bus</span>
          </div>
          <div className="p-6 overflow-x-auto">
            {reportType === 'profit-loss'      && <PLReport data={data} />}
            {reportType === 'balance-sheet'    && <BSReport data={data} />}
            {reportType === 'trial-balance'    && <TBReport data={data} />}
            {reportType === 'cash-flow'        && <CFReport data={data} />}
            {reportType === 'expense-analysis' && <ExpenseReport data={data} />}
            {reportType === 'general-ledger'   && <GLReport data={data} />}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Report Sub-components ───────────────────────────────────────────────────

const RRow = ({ code, name, amount, color = '' }: { code: string; name: string; amount: string; color?: string }) => (
  <tr className="border-b border-gray-100 dark:border-gray-700/60 hover:bg-gray-50 dark:hover:bg-gray-800/30">
    <td className="py-2 font-mono text-xs text-gray-400 w-14">{code}</td>
    <td className="py-2 text-sm text-gray-700 dark:text-gray-300">{name}</td>
    <td className={`py-2 text-right font-mono text-sm font-semibold ${color}`}>{fmt(amount)}</td>
  </tr>
)

function PLReport({ data }: { data: any }) {
  const profit = parseFloat(data.net_profit)
  return (
    <div className="grid grid-cols-2 gap-8">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <h4 className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Revenue</h4>
        </div>
        <table className="w-full">
          <tbody>
            {data.income.filter((r: any) => r.amount !== '0.00').map((r: any) => (
              <RRow key={r.code} {...r} color="text-emerald-600 dark:text-emerald-400" />
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
              <td colSpan={2} className="py-2.5 px-1 text-sm font-bold text-emerald-700 dark:text-emerald-300 rounded-l-lg">Total Revenue</td>
              <td className="py-2.5 px-1 text-right font-mono font-bold text-emerald-700 dark:text-emerald-300 rounded-r-lg">{fmt(data.total_income)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          <h4 className="text-sm font-bold text-red-600 dark:text-red-400">Expenses</h4>
        </div>
        <table className="w-full">
          <tbody>
            {data.expenses.filter((r: any) => r.amount !== '0.00').map((r: any) => (
              <RRow key={r.code} {...r} color="text-red-600 dark:text-red-400" />
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-red-50 dark:bg-red-900/20">
              <td colSpan={2} className="py-2.5 px-1 text-sm font-bold text-red-600 dark:text-red-400">Total Expenses</td>
              <td className="py-2.5 px-1 text-right font-mono font-bold text-red-600 dark:text-red-400">{fmt(data.total_expenses)}</td>
            </tr>
          </tfoot>
        </table>
        <div className={`mt-4 rounded-xl p-4 flex items-center justify-between ${profit >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'}`}>
          <span className={`font-bold text-sm ${profit >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>
            Net {profit >= 0 ? 'Profit' : 'Loss'}
          </span>
          <span className={`font-mono text-xl font-bold ${profit >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>
            {fmt(Math.abs(profit))}
          </span>
        </div>
      </div>
    </div>
  )
}

function BSReport({ data }: { data: any }) {
  const Section = ({ title, rows, total, colorClass }: any) => (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${colorClass.dot}`} />
        <h4 className={`text-sm font-bold ${colorClass.text}`}>{title}</h4>
      </div>
      <table className="w-full">
        <tbody>{rows.filter((r: any) => r.balance !== '0.00').map((r: any) => (
          <RRow key={r.code} code={r.code} name={r.name} amount={r.balance} />
        ))}</tbody>
        <tfoot>
          <tr className={colorClass.bg}>
            <td colSpan={2} className={`py-2.5 px-1 text-sm font-bold ${colorClass.text}`}>Total {title}</td>
            <td className={`py-2.5 px-1 text-right font-mono font-bold ${colorClass.text}`}>{fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
  return (
    <div>
      <div className="grid grid-cols-2 gap-8">
        <Section title="Assets" rows={data.assets.rows} total={data.assets.total} colorClass={{ dot: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' }} />
        <div>
          <Section title="Liabilities" rows={data.liabilities.rows} total={data.liabilities.total} colorClass={{ dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20' }} />
          <Section
            title="Equity"
            rows={[...data.equity.rows, { code: '—', name: 'Current Year Earnings', balance: data.equity.current_year_earnings }]}
            total={data.equity.total}
            colorClass={{ dot: 'bg-purple-500', text: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20' }}
          />
        </div>
      </div>
      <div className="mt-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 flex justify-between text-sm font-bold">
        <span>Total Assets: <span className="font-mono">{fmt(data.assets.total)}</span></span>
        <span>Total Liabilities + Equity: <span className="font-mono">{fmt(data.total_liabilities_equity)}</span></span>
      </div>
    </div>
  )
}

function TBReport({ data }: { data: any }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {data.balanced
          ? <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1 rounded-full"><CheckCircle className="h-3.5 w-3.5" />Balanced</span>
          : <span className="flex items-center gap-1.5 text-sm font-semibold text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-1 rounded-full"><AlertCircle className="h-3.5 w-3.5" />Unbalanced</span>
        }
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 uppercase tracking-wide">
            <th className="py-2.5 px-3 text-left rounded-l-lg">Code</th>
            <th className="py-2.5 px-3 text-left">Account Name</th>
            <th className="py-2.5 px-3 text-left">Type</th>
            <th className="py-2.5 px-3 text-right">Debit</th>
            <th className="py-2.5 px-3 text-right rounded-r-lg">Credit</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r: any) => (
            <tr key={r.code} className="border-b border-gray-100 dark:border-gray-700/60 hover:bg-gray-50 dark:hover:bg-gray-800/30">
              <td className="py-2 px-3 font-mono text-xs text-gray-400">{r.code}</td>
              <td className="py-2 px-3 text-gray-700 dark:text-gray-300">{r.name}</td>
              <td className="py-2 px-3">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TYPE_META[r.account_type as AccountType]?.badge ?? ''}`}>
                  {r.account_type}
                </span>
              </td>
              <td className="py-2 px-3 text-right font-mono text-blue-600 dark:text-blue-400">{parseFloat(r.debit) ? fmt(r.debit) : <span className="text-gray-300">—</span>}</td>
              <td className="py-2 px-3 text-right font-mono text-emerald-600 dark:text-emerald-400">{parseFloat(r.credit) ? fmt(r.credit) : <span className="text-gray-300">—</span>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-gray-100 dark:bg-gray-700 font-bold text-sm">
            <td colSpan={3} className="py-2.5 px-3 rounded-l-lg">Totals</td>
            <td className="py-2.5 px-3 text-right font-mono text-blue-700 dark:text-blue-300">{fmt(data.total_debit)}</td>
            <td className="py-2.5 px-3 text-right font-mono text-emerald-700 dark:text-emerald-300 rounded-r-lg">{fmt(data.total_credit)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function CFReport({ data }: { data: any }) {
  const op = data.operating
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2.5 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Operating Activities
        </div>
        <table className="w-full text-sm">
          <tbody>
            {[
              { label: 'Ticket collections',    val: op.ticket_collections,    pos: true },
              { label: 'Fuel payments',          val: op.fuel_payments,          pos: false },
              { label: 'Maintenance payments',   val: op.maintenance_payments,   pos: false },
              { label: 'Salary payments',        val: op.salary_payments,        pos: false },
            ].map(row => (
              <tr key={row.label} className="border-b border-gray-100 dark:border-gray-700/60">
                <td className="py-2.5 px-4 text-gray-600 dark:text-gray-400">{row.label}</td>
                <td className={`py-2.5 px-4 text-right font-mono font-semibold ${row.pos ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                  {row.pos ? '+ ' : '− '}{fmt(row.val)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-4 text-center">
          <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-1">Total Inflow</p>
          <p className="font-mono text-lg font-bold text-emerald-700 dark:text-emerald-300">{fmt(data.total_cash_inflow)}</p>
        </div>
        <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-center">
          <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-1">Total Outflow</p>
          <p className="font-mono text-lg font-bold text-red-600 dark:text-red-400">{fmt(data.total_cash_outflow)}</p>
        </div>
        <div className={`rounded-xl p-4 text-center border ${parseFloat(data.net_cash_flow) >= 0 ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' : 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'}`}>
          <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-1">Net Cash Flow</p>
          <p className="font-mono text-lg font-bold text-blue-700 dark:text-blue-300">{fmt(data.net_cash_flow)}</p>
        </div>
      </div>
    </div>
  )
}

function ExpenseReport({ data }: { data: any }) {
  const total = parseFloat(data.total) || 1
  const rows = data.expenses.filter((r: any) => parseFloat(r.amount) > 0)
  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 uppercase tracking-wide">
            <th className="py-2.5 px-3 text-left rounded-l-lg">Code</th>
            <th className="py-2.5 px-3 text-left">Expense Account</th>
            <th className="py-2.5 px-3 text-right">Amount</th>
            <th className="py-2.5 px-3 text-right w-32">% Share</th>
            <th className="py-2.5 px-3 w-32 rounded-r-lg" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => {
            const pct = (parseFloat(r.amount) / total) * 100
            return (
              <tr key={r.code} className="border-b border-gray-100 dark:border-gray-700/60 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                <td className="py-2.5 px-3 font-mono text-xs text-gray-400">{r.code}</td>
                <td className="py-2.5 px-3 text-gray-700 dark:text-gray-300">{r.name}</td>
                <td className="py-2.5 px-3 text-right font-mono font-semibold text-orange-600 dark:text-orange-400">{fmt(r.amount)}</td>
                <td className="py-2.5 px-3 text-right text-gray-500 font-mono text-xs">{pct.toFixed(1)}%</td>
                <td className="py-2.5 px-3">
                  <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                    <div className="bg-orange-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="bg-orange-50 dark:bg-orange-900/20 font-bold">
            <td colSpan={2} className="py-2.5 px-3 text-orange-700 dark:text-orange-300 rounded-l-lg">Total Expenses</td>
            <td className="py-2.5 px-3 text-right font-mono text-orange-700 dark:text-orange-300">{fmt(data.total)}</td>
            <td className="py-2.5 px-3 text-right font-mono text-orange-700 dark:text-orange-300">100%</td>
            <td className="rounded-r-lg" />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function GLReport({ data }: { data: any }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 uppercase tracking-wide">
          <th className="py-2.5 px-3 text-left rounded-l-lg">Account</th>
          <th className="py-2.5 px-3 text-left">Date</th>
          <th className="py-2.5 px-3 text-left">Entry No.</th>
          <th className="py-2.5 px-3 text-left">Description</th>
          <th className="py-2.5 px-3 text-right">Debit</th>
          <th className="py-2.5 px-3 text-right">Credit</th>
          <th className="py-2.5 px-3 text-right rounded-r-lg">Balance</th>
        </tr>
      </thead>
      <tbody>
        {data.ledger.map((r: any, i: number) => (
          <tr key={i} className="border-b border-gray-100 dark:border-gray-700/60 hover:bg-gray-50 dark:hover:bg-gray-800/30">
            <td className="py-2 px-3">
              <span className="font-mono text-xs text-gray-400">{r.account_code}</span>
              <br /><span className="text-xs text-gray-700 dark:text-gray-300">{r.account_name}</span>
            </td>
            <td className="py-2 px-3 text-xs text-gray-500">{r.date}</td>
            <td className="py-2 px-3 font-mono text-xs text-primary-600 dark:text-primary-400 font-semibold">{r.entry_no}</td>
            <td className="py-2 px-3 text-xs text-gray-600 dark:text-gray-400 max-w-[180px] truncate">{r.description}</td>
            <td className="py-2 px-3 text-right font-mono text-xs text-blue-600 dark:text-blue-400">{parseFloat(r.debit) ? fmt(r.debit) : <span className="text-gray-300">—</span>}</td>
            <td className="py-2 px-3 text-right font-mono text-xs text-emerald-600 dark:text-emerald-400">{parseFloat(r.credit) ? fmt(r.credit) : <span className="text-gray-300">—</span>}</td>
            <td className={`py-2 px-3 text-right font-mono text-xs font-bold ${parseFloat(r.balance) >= 0 ? 'text-gray-900 dark:text-white' : 'text-red-600'}`}>{fmt(r.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AccountingPage() {
  const { t } = useTranslation('tenant')
  const [activeTab, setActiveTab] = useState<Tab>('Overview')
  const [showJEModal, setShowJEModal] = useState(false)
  const [showSalaryModal, setShowSalaryModal] = useState(false)
  const [jeSearch, setJeSearch] = useState('')
  const [jeStatusFilter, setJeStatusFilter] = useState('')
  const [showReversed, setShowReversed] = useState(false)
  const [expandedJE, setExpandedJE] = useState<string | null>(null)
  const [salarySearch, setSalarySearch] = useState('')
  const queryClient = useQueryClient()

  const { data: kpis } = useQuery<DashboardKPIs>({
    queryKey: ['accounting-dashboard'],
    queryFn: () => apiClient.get('/accounting/dashboard/').then(r => r.data),
  })
  // Flat account list for JE modal + reports.
  // Uses the tree cache (same queryKey as ChartOfAccountsPanel) to avoid a
  // second network round-trip and sidesteps pagination format ambiguity.
  const { data: coaTree = [] } = useQuery<any[]>({
    queryKey: ['coa-tree'],
    queryFn: () => apiClient.get('/accounting/accounts/tree/').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })

  function flattenCOA(nodes: any[]): COA[] {
    const result: COA[] = []
    function walk(n: any) { result.push(n); (n.children ?? []).forEach(walk) }
    nodes.forEach(walk)
    return result
  }
  const allAccounts: COA[] = flattenCOA(coaTree)

  const { data: jeData } = useQuery({
    queryKey: ['journal-entries', jeSearch, jeStatusFilter],
    queryFn: () => {
      const p = new URLSearchParams()
      if (jeSearch) p.set('search', jeSearch)
      if (jeStatusFilter) p.set('status', jeStatusFilter)
      return apiClient.get(`/accounting/journal-entries/?${p}`).then(r => r.data)
    },
  })
  const jeRaw: JournalEntry[] = jeData?.data ?? jeData?.results ?? []
  const journalEntries = jeStatusFilter
    ? jeRaw
    : showReversed ? jeRaw : jeRaw.filter(je => je.status !== 'REVERSED')

  const { data: salaryData } = useQuery({
    queryKey: ['salary-payments'],
    queryFn: () => apiClient.get('/accounting/salary-payments/?page_size=100').then(r => r.data),
  })
  const allSalaries: SalaryPayment[] = salaryData?.data ?? salaryData?.results ?? []
  const salaryPayments = salarySearch
    ? allSalaries.filter(s => s.employee_name.toLowerCase().includes(salarySearch.toLowerCase()))
    : allSalaries

  const postMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/accounting/journal-entries/${id}/post/`).then(r => r.data),
    onSuccess: () => { toast.success('Entry posted'); queryClient.invalidateQueries({ queryKey: ['journal-entries'] }); queryClient.invalidateQueries({ queryKey: ['accounting-dashboard'] }) },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Failed'),
  })
  const reverseMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/accounting/journal-entries/${id}/reverse/`, { date: new Date().toISOString().split('T')[0] }).then(r => r.data),
    onSuccess: () => { toast.success('Entry reversed'); queryClient.invalidateQueries({ queryKey: ['journal-entries'] }) },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Failed'),
  })
  const payMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/accounting/salary-payments/${id}/pay/`).then(r => r.data),
    onSuccess: () => {
      toast.success('Salary paid — journal entry auto-created')
      queryClient.invalidateQueries({ queryKey: ['salary-payments'] })
      queryClient.invalidateQueries({ queryKey: ['accounting-dashboard'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Failed'),
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['journal-entries'] })
    queryClient.invalidateQueries({ queryKey: ['accounting-dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['coa-tree'] })
  }

  const SOURCE_COLORS: Record<string, string> = {
    MANUAL: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    TICKET: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
    FUEL: 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300',
    MAINTENANCE: 'bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300',
    SALARY: 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300',
  }

  return (
    <div className="min-h-full">
      {/* Page header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-primary-600 p-2.5">
            <BookOpen className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('accounting.title')}</h1>
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('accounting.subtitle')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {activeTab === 'Journal Entries' && (
            <button
              onClick={() => setShowJEModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors"
            >
              <Plus className="h-4 w-4" />{t('accounting.buttons.newJE')}
            </button>
          )}
          {activeTab === 'Salary Payments' && (
            <button
              onClick={() => setShowSalaryModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors"
            >
              <Plus className="h-4 w-4" />{t('accounting.buttons.addSalary')}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-0 border-b border-gray-200 dark:border-gray-700">
        {tabs.map(tab => {
          const tabLabel = tab === 'Overview' ? t('accounting.tabs.overview')
            : tab === 'Chart of Accounts' ? t('accounting.tabs.chartOfAccounts')
            : tab === 'Journal Entries' ? t('accounting.tabs.journalEntries')
            : tab === 'Salary Payments' ? t('accounting.tabs.salaryPayments')
            : t('accounting.tabs.reports')
          return (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all ${
              activeTab === tab
                ? 'border-primary-600 text-primary-700 dark:text-primary-300'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {tabLabel}
          </button>
          )
        })}
      </div>

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      {activeTab === 'Overview' && (
        <div className="space-y-5">

          {/* Hero MTD banner */}
          <div className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-6 h-6 rounded-lg bg-primary-600 flex items-center justify-center">
                <Activity className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                {t('accounting.overview.monthToDate')}{kpis?.month ? ` · ${kpis.month}` : ''}
              </span>
            </div>
            <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-gray-700">
              <div className="pr-8">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('accounting.overview.revenue')}</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{kpis ? fmt(kpis.revenue_mtd) : '—'}</p>
                <div className="flex items-center gap-1.5 mt-2">
                  <div className="w-5 h-5 rounded-md bg-primary-600 flex items-center justify-center">
                    <TrendingUp className="h-3 w-3 text-white" />
                  </div>
                  <span className="text-xs text-gray-400">Total income</span>
                </div>
              </div>
              <div className="px-8">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('accounting.overview.expenses')}</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{kpis ? fmt(kpis.expenses_mtd) : '—'}</p>
                <div className="flex items-center gap-1.5 mt-2">
                  <div className="w-5 h-5 rounded-md bg-primary-600 flex items-center justify-center">
                    <TrendingDown className="h-3 w-3 text-white" />
                  </div>
                  <span className="text-xs text-gray-400">Total costs</span>
                </div>
              </div>
              <div className="pl-8">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('accounting.overview.netProfit')}</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{kpis ? fmt(kpis.net_profit_mtd) : '—'}</p>
                <div className="flex items-center gap-1.5 mt-2">
                  <div className="w-5 h-5 rounded-md bg-primary-600 flex items-center justify-center">
                    <BarChart3 className="h-3 w-3 text-white" />
                  </div>
                  <span className="text-xs text-gray-400">Revenue − Expenses</span>
                </div>
              </div>
            </div>
          </div>

          {/* Balance sheet metrics */}
          <div className="grid grid-cols-3 gap-4">
            <KpiCard label={t('accounting.overview.cashBalance')}   value={kpis ? fmt(kpis.cash_balance) : '—'}        icon={Wallet}      sub="Current liquid funds" />
            <KpiCard label={t('accounting.overview.receivable')}    value={kpis ? fmt(kpis.accounts_receivable) : '—'} icon={ArrowUpDown} sub="Amounts owed to you" />
            <KpiCard label={t('accounting.overview.payable')}       value={kpis ? fmt(kpis.accounts_payable) : '—'}    icon={CreditCard}  sub="Amounts you owe" />
          </div>

          {/* Auto-journaling mapping */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="w-7 h-7 rounded-lg bg-primary-600 flex items-center justify-center">
                <Activity className="h-3.5 w-3.5 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Automatic Journal Entry Mapping</p>
                <p className="text-xs text-gray-400">Every operational event triggers a balanced double-entry automatically</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-gray-100 dark:divide-gray-700">
              {[
                { icon: Ticket, label: 'Ticket Sale',    dr: 'Cash / Bank (1110/1120)',  cr: 'Ticket Revenue (4100)', num: '01' },
                { icon: Fuel,   label: 'Fuel Purchase',  dr: 'Fuel Expense (5100)',       cr: 'AP – Fuel (2110)',      num: '02' },
                { icon: Wrench, label: 'Maintenance',    dr: 'Maintenance (5200)',         cr: 'AP – Vendor (2120)',    num: '03' },
                { icon: Users,  label: 'Salary Payment', dr: 'Salary Exp. (5300/5400)',   cr: 'Cash / Bank (1110)',    num: '04' },
              ].map(item => (
                <div key={item.label} className="p-5 hover:bg-primary-50/50 dark:hover:bg-primary-900/10 transition-colors">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-9 h-9 rounded-xl bg-primary-600 flex items-center justify-center shadow-sm shadow-primary-600/30 flex-shrink-0">
                      <item.icon className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-primary-400 uppercase tracking-widest">Step {item.num}</span>
                      <p className="text-sm font-bold text-gray-800 dark:text-gray-100 leading-tight">{item.label}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 inline-flex items-center justify-center w-6 h-5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-bold font-mono text-[10px] flex-shrink-0">Dr</span>
                      <span className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{item.dr}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 inline-flex items-center justify-center w-6 h-5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-bold font-mono text-[10px] flex-shrink-0">Cr</span>
                      <span className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{item.cr}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Chart of Accounts ─────────────────────────────────────────────── */}
      {activeTab === 'Chart of Accounts' && <ChartOfAccountsPanel />}

      {/* ── Journal Entries ──────────────────────────────────────────────── */}
      {activeTab === 'Journal Entries' && (
        <div className="space-y-4">
          {/* Search + Filter bar */}
          <div className="flex flex-wrap gap-3 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="relative flex-1 min-w-52">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input className="input pl-9" placeholder="Search entry no. or description…" value={jeSearch} onChange={e => setJeSearch(e.target.value)} />
            </div>
            <select className="input w-40" value={jeStatusFilter} onChange={e => setJeStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              <option value="DRAFT">Draft</option>
              <option value="POSTED">Posted</option>
              <option value="REVERSED">Reversed</option>
            </select>
            <button
              onClick={() => setShowReversed(v => !v)}
              className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors ${
                showReversed
                  ? 'bg-gray-100 border-gray-300 text-gray-700 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300'
                  : 'border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
              }`}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {showReversed ? 'Hiding reversed' : 'Show reversed'}
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/80 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide border-b border-gray-100 dark:border-gray-700">
                  <th className="py-2.5 px-4 text-left">{t('accounting.columns.entryNo')}</th>
                  <th className="py-2.5 px-3 text-left">{t('accounting.columns.date')}</th>
                  <th className="py-2.5 px-3 text-left">{t('accounting.columns.description')}</th>
                  <th className="py-2.5 px-3 text-left">{t('accounting.columns.source')}</th>
                  <th className="py-2.5 px-3 text-right">{t('accounting.columns.debit')}</th>
                  <th className="py-2.5 px-3 text-right">{t('accounting.columns.credit')}</th>
                  <th className="py-2.5 px-3 text-center">{t('accounting.columns.status')}</th>
                  <th className="py-2.5 px-4 text-center">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {journalEntries.map(je => {
                  const sm = STATUS_META[je.status] ?? STATUS_META.DRAFT
                  const SIcon = sm.icon
                  return (
                    <>
                      <tr key={je.id} className="border-b border-gray-100 dark:border-gray-700/60 hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors">
                        <td className="py-3 px-4 font-mono text-xs font-bold text-primary-600 dark:text-primary-400">{je.entry_no}</td>
                        <td className="py-3 px-3 text-xs text-gray-500 whitespace-nowrap">{je.date}</td>
                        <td className="py-3 px-3 text-sm text-gray-700 dark:text-gray-300 max-w-[200px] truncate">{je.description}</td>
                        <td className="py-3 px-3">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${SOURCE_COLORS[je.source_type] ?? SOURCE_COLORS.MANUAL}`}>
                            {je.source_type}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">{fmt(je.total_debit)}</td>
                        <td className="py-3 px-3 text-right font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">{fmt(je.total_credit)}</td>
                        <td className="py-3 px-3 text-center">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${sm.badge}`}>
                            <SIcon className="h-3 w-3" />{je.status}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => setExpandedJE(expandedJE === je.id ? null : je.id)}
                              title="View lines"
                              className="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${expandedJE === je.id ? 'rotate-180' : ''}`} />
                            </button>
                            {je.status === 'DRAFT' && (
                              <button onClick={() => postMutation.mutate(je.id)} title="Post entry"
                                className="rounded-lg p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                                <CheckCircle className="h-4 w-4" />
                              </button>
                            )}
                            {je.status === 'POSTED' && (
                              <button onClick={() => reverseMutation.mutate(je.id)} title="Reverse entry"
                                className="rounded-lg p-1.5 text-orange-500 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors">
                                <RotateCcw className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedJE === je.id && (
                        <tr key={`${je.id}-exp`} className="bg-gray-50/80 dark:bg-gray-800/60">
                          <td colSpan={8} className="px-8 py-4">
                            <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                              <div className="bg-gray-100 dark:bg-gray-700/50 px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                                Journal Lines — {je.entry_no}
                              </div>
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-gray-400 uppercase tracking-wide border-b border-gray-200 dark:border-gray-700">
                                    <th className="text-left px-4 py-2 w-16">Code</th>
                                    <th className="text-left px-3 py-2">Account</th>
                                    <th className="text-left px-3 py-2">Memo</th>
                                    <th className="text-right px-3 py-2 w-32">Debit</th>
                                    <th className="text-right px-4 py-2 w-32">Credit</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {je.lines.map((line, li) => (
                                    <tr key={li} className="border-t border-gray-100 dark:border-gray-700/60">
                                      <td className="px-4 py-2 font-mono text-gray-400">{line.account_code}</td>
                                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 font-medium">{line.account_name}</td>
                                      <td className="px-3 py-2 text-gray-400">{line.description}</td>
                                      <td className="px-3 py-2 text-right font-mono text-blue-600 dark:text-blue-400">{parseFloat(line.debit) ? fmt(line.debit) : <span className="text-gray-200 dark:text-gray-700">—</span>}</td>
                                      <td className="px-4 py-2 text-right font-mono text-emerald-600 dark:text-emerald-400">{parseFloat(line.credit) ? fmt(line.credit) : <span className="text-gray-200 dark:text-gray-700">—</span>}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
            {journalEntries.length === 0 && (
              <div className="py-20 text-center">
                <FileText className="h-10 w-10 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-400">No journal entries yet</p>
                <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">Entries are auto-generated from ticket sales, fuel & maintenance — or create manually.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Salary Payments ──────────────────────────────────────────────── */}
      {activeTab === 'Salary Payments' && (
        <div className="space-y-4">
          {/* Search bar */}
          <div className="flex gap-3 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input className="input pl-9" placeholder="Search by employee name…" value={salarySearch} onChange={e => setSalarySearch(e.target.value)} />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/80 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide border-b border-gray-100 dark:border-gray-700">
                  <th className="py-2.5 px-4 text-left">{t('accounting.columns.employee')}</th>
                  <th className="py-2.5 px-3 text-left">{t('accounting.columns.role')}</th>
                  <th className="py-2.5 px-3 text-left">{t('accounting.columns.period')}</th>
                  <th className="py-2.5 px-3 text-right">{t('accounting.columns.basic')}</th>
                  <th className="py-2.5 px-3 text-right">{t('accounting.columns.allowances')}</th>
                  <th className="py-2.5 px-3 text-right">{t('accounting.columns.deductions')}</th>
                  <th className="py-2.5 px-3 text-right">{t('accounting.columns.netPay')}</th>
                  <th className="py-2.5 px-3 text-center">{t('accounting.columns.status')}</th>
                  <th className="py-2.5 px-3 text-center">{t('accounting.columns.jeRef')}</th>
                  <th className="py-2.5 px-4 text-center">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {salaryPayments.map(sp => {
                  const sm = STATUS_META[sp.status] ?? STATUS_META.DRAFT
                  const SIcon = sm.icon
                  const initials = sp.employee_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                  const roleColor = sp.employee_type === 'DRIVER'
                    ? 'bg-primary-50 text-primary-700 ring-primary-200 dark:bg-primary-900/20 dark:text-primary-300 dark:ring-primary-800'
                    : sp.employee_type === 'CONDUCTOR'
                    ? 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:ring-blue-800'
                    : 'bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:ring-gray-600'
                  return (
                    <tr key={sp.id} className="border-b border-gray-100 dark:border-gray-700/60 hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 flex items-center justify-center text-xs font-bold">
                            {initials}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm">{sp.employee_name}</p>
                            <p className="text-xs text-gray-400">{sp.payment_method.replace(/_/g, ' ')}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${roleColor}`}>
                          {sp.employee_type}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-xs text-gray-500 whitespace-nowrap">
                        <span>{sp.period_from}</span>
                        <span className="mx-1 text-gray-300">→</span>
                        <span>{sp.period_to}</span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs text-gray-600 dark:text-gray-400">{fmt(sp.basic_salary)}</td>
                      <td className="py-3 px-3 text-right font-mono text-xs text-emerald-600 dark:text-emerald-400">+{fmt(sp.total_allowances)}</td>
                      <td className="py-3 px-3 text-right font-mono text-xs text-red-500">
                        {parseFloat(sp.deductions) > 0 ? `−${fmt(sp.deductions)}` : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="font-mono text-sm font-bold text-gray-900 dark:text-white">{fmt(sp.net_pay)}</span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${sm.badge}`}>
                          <SIcon className="h-3 w-3" />{sp.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        {sp.journal_entry_no
                          ? <span className="font-mono text-xs text-primary-600 dark:text-primary-400 font-semibold">{sp.journal_entry_no}</span>
                          : <span className="text-gray-200 dark:text-gray-700">—</span>}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {sp.status === 'DRAFT' && (
                          <button
                            onClick={() => payMutation.mutate(sp.id)}
                            disabled={payMutation.isPending}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 transition-colors disabled:opacity-50"
                          >
                            <CheckCircle className="h-3.5 w-3.5" />{t('accounting.buttons.markPaid')}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {salaryPayments.length === 0 && (
              <div className="py-20 text-center">
                <Users className="h-10 w-10 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-400">No salary records yet</p>
                <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">Add salary payments to auto-generate journal entries.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Reports ──────────────────────────────────────────────────────── */}
      {activeTab === 'Reports' && (
        <ReportsPanel accounts={Array.isArray(allAccounts) ? allAccounts : []} />
      )}

      {/* Modals */}
      {showJEModal && (
        <NewJournalEntryModal
          onClose={() => setShowJEModal(false)}
          onSuccess={invalidateAll}
        />
      )}
      {showSalaryModal && (
        <NewSalaryModal
          onClose={() => setShowSalaryModal(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['salary-payments'] })}
        />
      )}
    </div>
  )
}
