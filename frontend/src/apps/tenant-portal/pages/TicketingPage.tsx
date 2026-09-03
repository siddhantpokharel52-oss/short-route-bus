import { useState, useMemo, useEffect, forwardRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Ticket, Search, QrCode, CheckCircle, XCircle, Plus,
  MapPin, ArrowRight, Printer, RotateCcw, Monitor, Smartphone,
} from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge, statusVariant } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { usePagination } from '@hooks/usePagination'
import apiClient from '@services/api'
import publicService, { FareMatch } from '@services/publicService'
import { formatNPR } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'
import { useDateFormatter } from '@hooks/useDateFormatter'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'

// ─── Types ────────────────────────────────────────────────────────────────────
interface TicketRecord {
  id: string
  ticket_uid: string
  passenger_name: string
  from_stop_id: string | null
  to_stop_id: string | null
  from_stop_name: string | null
  to_stop_name: string | null
  fare_paid: number
  payment_method: string
  issued_by: 'POS' | 'MOBILE' | 'CONDUCTOR'
  status: string
  issued_at: string
  qr_code: string | null
}

interface PosForm {
  route_id: string
  from_stop_id: string
  to_stop_id: string
  fare_paid: string
  passenger_name: string
  payment_method: string
}

// Shape returned by GET /platform/routes/{id}/stops/
interface RouteStopFlat {
  route_stop_id: string
  stop_id: string
  name_en: string
  name_ne: string
  stop_code: string
  sequence_no: number
  latitude: number
  longitude: number
}

// Shape returned by GET /platform/routes/?page_size=200 (for dropdown only)
interface RouteListItem {
  id: string
  route_code: string
  name_en: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
// forwardRef is required so react-hook-form's ref callback reaches the <select>
// DOM element (React strips ref from props on function components without it).
const SelectField = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; required?: boolean }
>(function SelectField({ label, required, children, ...props }, ref) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <select
        ref={ref}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                   focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500
                   disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
        {...props}
      >
        {children}
      </select>
    </div>
  )
})

function SourceBadge({ source }: { source: string }) {
  const { t } = useTranslation('tenant')
  if (source === 'POS') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
        <Monitor className="h-3 w-3" /> POS
      </span>
    )
  }
  if (source === 'MOBILE') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
        <Smartphone className="h-3 w-3" /> {t('ticketing.mobileSource')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
      {source}
    </span>
  )
}

// ─── E-Ticket ─────────────────────────────────────────────────────────────────
interface CompanyInfo { company_name: string; logo: string | null }

function ETicket({
  ticket,
  company,
  onNewTicket,
}: {
  ticket: TicketRecord
  company: CompanyInfo | null
  onNewTicket: () => void
}) {
  const { t } = useTranslation('tenant')
  const fmtDate = useDateFormatter()
  const { language } = useUiStore()

  const initials = company?.company_name
    ? company.company_name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    : 'BUS'

  return (
    <div className="flex flex-col items-center gap-4 p-2">
      <div id="eticket-print" className="w-full max-w-xs overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">

        {/* Header */}
        <div className="relative px-5 py-4" style={{ background: '#0D4A38' }}>
          {/* Logo — top-right circle */}
          <div className="absolute right-4 top-3 flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 bg-white" style={{ borderColor: 'rgba(255,255,255,0.25)' }}>
            {company?.logo
              ? <img src={company.logo} alt={company.company_name} className="h-full w-full object-cover" />
              : <span className="text-[10px] font-semibold" style={{ color: '#0D4A38' }}>{initials}</span>
            }
          </div>

          <div className="pr-16">
            <p className="text-[10px] uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {company?.company_name ?? t('ticketing.busTicket')}
            </p>
            <p className="mt-0.5 text-xl font-medium text-white">e-Ticket</p>
            <span className="mt-2 inline-block rounded-full px-3 py-0.5 text-[10px] font-medium tracking-wider" style={{ background: '#1FC87A', color: '#063D22' }}>
              VALID
            </span>
          </div>
        </div>

        {/* Route */}
        <div className="border-b border-gray-100 px-5 py-3.5">
          <p className="mb-2.5 text-[10px] uppercase tracking-widest text-gray-400">{t('routes.title')}</p>
          <div className="grid items-center gap-2" style={{ gridTemplateColumns: '1fr 28px 1fr' }}>
            <div>
              <p className="text-sm font-medium leading-snug text-gray-900">{ticket.from_stop_name ?? '—'}</p>
              <p className="mt-1 text-[11px] text-gray-400">{t('ticketing.from')}</p>
            </div>
            <div className="flex justify-center">
              <ArrowRight className="h-4 w-4" style={{ color: '#C8830A' }} />
            </div>
            <div className="text-right">
              <p className="text-sm font-medium leading-snug text-gray-900">{ticket.to_stop_name ?? '—'}</p>
              <p className="mt-1 text-right text-[11px] text-gray-400">{t('ticketing.to')}</p>
            </div>
          </div>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 border-b border-gray-100 px-5 py-3.5">
          {[
            { label: t('ticketing.passenger'), value: ticket.passenger_name || '—' },
            { label: t('ticketing.price'), value: formatNPR(Number(ticket.fare_paid), language as 'en' | 'ne') },
            { label: t('ticketing.dateTime'), value: fmtDate(ticket.issued_at) },
            { label: t('ticketing.payment'), value: ticket.payment_method },
            { label: t('ticketing.source'), value: ticket.issued_by },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[10px] uppercase tracking-widest text-gray-400">{label}</p>
              <p className="mt-0.5 text-[13px] font-medium text-gray-900">{value}</p>
            </div>
          ))}
        </div>

        {/* Tear line */}
        <div className="mx-4 border-t-2 border-dashed border-gray-200" />

        {/* QR + UID */}
        <div className="flex items-center gap-4 px-5 py-3.5">
          {ticket.qr_code
            ? <img src={`data:image/png;base64,${ticket.qr_code}`} alt="Ticket QR" className="h-20 w-20 flex-shrink-0 rounded-md border border-gray-100" />
            : <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-md border border-gray-100 bg-gray-50"><QrCode className="h-8 w-8 text-gray-300" /></div>
          }
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest text-gray-400">{t('ticketing.ticketId')}</p>
            <p className="mt-0.5 break-all font-mono text-[12px] font-semibold text-gray-900">{ticket.ticket_uid}</p>
            <p className="mt-2.5 flex items-center gap-1 text-[11px] text-gray-400">
              <QrCode className="h-3.5 w-3.5" />{t('ticketing.scanToVerify')}
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex w-full max-w-xs gap-3">
        <Button variant="outline" className="flex-1" leftIcon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
          {t('ticketing.print')}
        </Button>
        <Button className="flex-1" leftIcon={<RotateCcw className="h-4 w-4" />} onClick={onNewTicket}>
          {t('ticketing.newTicket')}
        </Button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TicketingPage() {
  const { t } = useTranslation('tenant')
  const fmtDate = useDateFormatter()
  const { language } = useUiStore()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const sourceFilter = 'POS' as const
  const [showPos, setShowPos] = useState(false)
  const [showVerify, setShowVerify] = useState(false)
  const [issuedTicket, setIssuedTicket] = useState<TicketRecord | null>(null)
  const [verifyTicketNum, setVerifyTicketNum] = useState('')
  const [verifyResult, setVerifyResult] = useState<Awaited<ReturnType<typeof publicService.verifyTicket>> | null>(null)
  const [selectedTicket, setSelectedTicket] = useState<TicketRecord | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const pagination = usePagination(totalCount)

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['tickets', pagination.page, search, sourceFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { ...pagination.queryParams }
      if (search) params.search = search
      params.source = sourceFilter
      const { data } = await apiClient.get('/ticketing/tickets/', { params })
      setTotalCount(data.data?.count ?? 0)
      return data.data?.results ?? []
    },
  })

  const { data: routes = [] } = useQuery<RouteListItem[]>({
    queryKey: ['routes-dropdown'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/routes/', { params: { page_size: 200 } })
      return (Array.isArray(data.data) ? data.data : []) as RouteListItem[]
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data: company = null } = useQuery<CompanyInfo | null>({
    queryKey: ['company-info'],
    queryFn: async () => {
      const { data } = await apiClient.get('/staff/company/')
      return data.data as CompanyInfo
    },
    staleTime: 10 * 60 * 1000,
  })

  // Today stats from the loaded tickets
  const todayStats = useMemo(() => {
    const today = new Date().toDateString()
    const todayTickets = (data ?? []).filter(
      (t: TicketRecord) => new Date(t.issued_at).toDateString() === today
    )
    const revenue = todayTickets.reduce((s: number, t: TicketRecord) => s + Number(t.fare_paid), 0)
    return { count: todayTickets.length, revenue }
  }, [data])

  // ── Form ─────────────────────────────────────────────────────────────────
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<PosForm>({
    defaultValues: { payment_method: 'CASH', route_id: '', from_stop_id: '', to_stop_id: '' },
    mode: 'onChange',
    reValidateMode: 'onChange',
  })

  const watchedRouteId = watch('route_id')
  const watchedFromStopId = watch('from_stop_id')
  const watchedToStopId = watch('to_stop_id')

  // Whether the operator has typed into Price themselves -- once true, the
  // fare auto-fill below never overwrites it again (same "suggest but don't
  // clobber a manual edit" rule used elsewhere in the app).
  const [fareEdited, setFareEdited] = useState(false)

  // Reset stop selections whenever the route changes
  useEffect(() => {
    setValue('from_stop_id', '')
    setValue('to_stop_id', '')
    setFareEdited(false)
  }, [watchedRouteId, setValue])

  const {
    data: routeStops = [],
    isLoading: stopsLoading,
    isError: stopsError,
  } = useQuery<RouteStopFlat[]>({
    queryKey: ['route-stops', watchedRouteId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/platform/routes/${watchedRouteId}/stops/`)
      return (data.data ?? []) as RouteStopFlat[]
    },
    enabled: !!watchedRouteId,
    staleTime: 5 * 60 * 1000,
    retry: 0,
  })

  // ── Auto-fill Price from the real fare matrix ────────────────────────────
  // Once Route + From + To are all picked, look up the actual configured
  // fare for that leg (same bidirectional, route-aware lookup the public
  // fare API already does) and suggest it -- editable, never forced, and
  // it clears itself (falls back to manual entry) if no fare is set yet for
  // that exact pair, rather than silently showing 0.
  const fromStopCode = routeStops.find((s) => s.stop_id === watchedFromStopId)?.stop_code
  const toStopCode = routeStops.find((s) => s.stop_id === watchedToStopId)?.stop_code

  const { data: fareMatches, isFetching: fareLoading } = useQuery<FareMatch[]>({
    queryKey: ['pos-fare-lookup', watchedRouteId, fromStopCode, toStopCode],
    queryFn: () => publicService.fareForStops(watchedRouteId, fromStopCode!, toStopCode!),
    enabled: !!watchedRouteId && !!fromStopCode && !!toStopCode && fromStopCode !== toStopCode,
    staleTime: 60 * 1000,
    retry: 0,
  })

  useEffect(() => {
    if (fareEdited) return
    if (fareMatches && fareMatches.length > 0) {
      setValue('fare_paid', String(fareMatches[0].base_fare))
    }
  }, [fareMatches, fareEdited, setValue])

  const noFareConfigured =
    !!watchedRouteId && !!fromStopCode && !!toStopCode && fromStopCode !== toStopCode &&
    !fareLoading && fareMatches?.length === 0

  const issueMutation = useMutation({
    mutationFn: async (payload: PosForm) => {
      const { data } = await apiClient.post('/ticketing/tickets/', {
        from_stop_id: payload.from_stop_id || null,
        to_stop_id: payload.to_stop_id || null,
        fare_paid: payload.fare_paid,
        passenger_name: payload.passenger_name || '',
        payment_method: payload.payment_method,
        issued_by: 'POS',
      })
      return data.data as TicketRecord
    },
    onSuccess: (ticket) => {
      setIssuedTicket(ticket)
      qc.invalidateQueries({ queryKey: ['tickets'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { message?: string; errors?: Record<string, unknown> } } }
      if (e?.response?.status === 403) {
        toast.error(t('ticketing.noPermission'))
        return
      }
      const res = e?.response?.data
      if (res?.errors && typeof res.errors === 'object' && Object.keys(res.errors).length > 0) {
        const firstKey = Object.keys(res.errors)[0]
        const val = res.errors[firstKey]
        toast.error(`${firstKey}: ${Array.isArray(val) ? String(val[0]) : String(val)}`)
      } else {
        toast.error(res?.message || (err as Error).message || t('ticketing.issueError'))
      }
    },
  })

  const handleVerify = async () => {
    try {
      const result = await publicService.verifyTicket(verifyTicketNum)
      setVerifyResult(result)
    } catch {
      toast.error(t('ticketing.ticketNotFound'))
      setVerifyResult(null)
    }
  }

  const handleClosePOS = () => {
    setShowPos(false)
    setIssuedTicket(null)
    reset({ payment_method: 'CASH', route_id: '', from_stop_id: '', to_stop_id: '', fare_paid: '', passenger_name: '' }); setFareEdited(false)
  }

  // helper: stop dropdown placeholder based on loading/error state
  const stopPlaceholder = () => {
    if (!watchedRouteId) return t('ticketing.selectStop')
    if (stopsLoading) return t('ticketing.loadingStops')
    if (stopsError) return t('ticketing.stopsError')
    if (routeStops.length === 0) return t('ticketing.noStops')
    return t('ticketing.selectStop')
  }

  // ── Columns ───────────────────────────────────────────────────────────────
  const columns: Column<TicketRecord>[] = [
    {
      key: 'ticket_uid',
      header: t('ticketing.ticketId'),
      render: (t) => (
        <code className="rounded bg-primary-50 px-2 py-0.5 text-xs font-mono font-semibold text-primary-700">
          {t.ticket_uid}
        </code>
      ),
    },
    {
      key: 'issued_at',
      header: t('ticketing.dateTime'),
      render: (tk) => (
        <div className="text-sm">
          <p className="font-medium text-gray-800">
            {fmtDate(tk.issued_at)}
          </p>
        </div>
      ),
    },
    {
      key: 'from_stop_name',
      header: t('routes.title'),
      render: (t) => (
        <div className="flex items-center gap-1.5 text-sm">
          <span className="flex items-center gap-1 text-gray-700">
            <MapPin className="h-3 w-3 text-green-500" />
            {t.from_stop_name ?? '—'}
          </span>
          <ArrowRight className="h-3 w-3 text-gray-300 flex-shrink-0" />
          <span className="flex items-center gap-1 text-gray-700">
            <MapPin className="h-3 w-3 text-red-500" />
            {t.to_stop_name ?? '—'}
          </span>
        </div>
      ),
    },
    {
      key: 'fare_paid',
      header: t('ticketing.price'),
      render: (t) => (
        <span className="font-semibold text-gray-900">
          {formatNPR(Number(t.fare_paid), language as 'en' | 'ne')}
        </span>
      ),
    },
    {
      key: 'passenger_name',
      header: t('ticketing.passenger'),
      render: (t) => t.passenger_name
        ? <span className="text-sm text-gray-800">{t.passenger_name}</span>
        : <span className="text-xs italic text-gray-400">—</span>,
    },
    {
      key: 'payment_method',
      header: t('ticketing.payment'),
      render: (t) => <Badge variant="neutral">{t.payment_method}</Badge>,
    },
    {
      key: 'issued_by',
      header: t('ticketing.source'),
      render: (t) => <SourceBadge source={t.issued_by} />,
    },
    {
      key: 'status',
      header: t('common:common.status'),
      render: (tk) => <Badge variant={statusVariant(tk.status)} dot>{tk.status}</Badge>,
    },
    {
      key: 'qr_code',
      header: t('ticketing.qrCode'),
      render: (tk) => tk.qr_code
        ? (
          <button
            onClick={() => setSelectedTicket(tk)}
            className="flex items-center gap-1 text-xs text-primary-600 hover:underline"
          >
            <QrCode className="h-3.5 w-3.5" />{t('common:common.view')}
          </button>
        )
        : <span className="text-gray-300">—</span>,
    },
  ]

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('ticketing.title')}</h1>
          <p className="page-subtitle">{t('ticketing.subtitle')}</p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            leftIcon={<QrCode className="h-4 w-4" />}
            onClick={() => setShowVerify(true)}
          >
            {t('ticketing.verify')}
          </Button>
          <Button
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => { setIssuedTicket(null); reset({ payment_method: 'CASH', route_id: '', from_stop_id: '', to_stop_id: '', fare_paid: '', passenger_name: '' }); setFareEdited(false); setShowPos(true) }}
          >
            {t('ticketing.issueTicketPOS')}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: t('ticketing.todayTickets'), value: todayStats.count, color: 'text-primary-700' },
          {
            label: t('ticketing.todayRevenue'),
            value: formatNPR(todayStats.revenue, language as 'en' | 'ne'),
            color: 'text-green-700',
          },
        ].map((s) => (
          <div key={s.label} className="card py-4 px-5">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`mt-1 text-xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={t('ticketing.searchPlaceholder')}
          leftAddon={<Search className="h-4 w-4" />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {/* Table */}
      <div className="card p-0">
        <Table
          columns={columns}
          data={data ?? []}
          keyExtractor={(t) => t.id}
          loading={isLoading}
        />
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalCount={totalCount}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
        />
      </div>

      {/* ── POS Issue Modal ───────────────────────────────────────────────── */}
      <Modal
        open={showPos}
        onClose={handleClosePOS}
        title={issuedTicket ? t('ticketing.ticketIssued') : t('ticketing.issueTicketTitle')}
        size="md"
      >
        {issuedTicket ? (
          <ETicket
            ticket={issuedTicket}
            company={company}
            onNewTicket={() => { setIssuedTicket(null); reset({ payment_method: 'CASH', route_id: '', from_stop_id: '', to_stop_id: '', fare_paid: '', passenger_name: '' }); setFareEdited(false) }}
          />
        ) : (
          <form
            onSubmit={handleSubmit((d) => issueMutation.mutate(d))}
            className="space-y-5 p-6"
          >
            {/* Route */}
            <SelectField
              label={t('ticketing.route')}
              required
              {...register('route_id', { required: t('ticketing.routeRequired') })}
            >
              <option value="">{t('ticketing.selectRoute')}</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.route_code} — {r.name_en}
                </option>
              ))}
            </SelectField>
            {errors.route_id && (
              <p className="text-xs text-red-500 -mt-3">{errors.route_id.message}</p>
            )}

            {/* From / To stops */}
            <div className="grid grid-cols-2 gap-4">
              <SelectField
                label={t('ticketing.fromBusStop')}
                required
                disabled={!watchedRouteId || stopsLoading}
                {...register('from_stop_id', { required: t('ticketing.originRequired') })}
              >
                <option value="">{stopPlaceholder()}</option>
                {routeStops.map((s) => (
                  <option key={s.route_stop_id} value={s.stop_id}>{s.name_en}</option>
                ))}
              </SelectField>
              <SelectField
                label={t('ticketing.toBusStop')}
                required
                disabled={!watchedRouteId || stopsLoading}
                {...register('to_stop_id', { required: t('ticketing.destinationRequired') })}
              >
                <option value="">{stopPlaceholder()}</option>
                {routeStops.map((s) => (
                  <option key={s.route_stop_id} value={s.stop_id}>{s.name_en}</option>
                ))}
              </SelectField>
            </div>
            {(errors.from_stop_id || errors.to_stop_id) && (
              <p className="text-xs text-red-500 -mt-3">
                {errors.from_stop_id?.message ?? errors.to_stop_id?.message}
              </p>
            )}

            {/* Price -- auto-filled from the real fare matrix once Route/From/To
                are all picked, but always editable and never re-overwritten
                once the operator has typed into it themselves. */}
            <Input
              label={t('ticketing.priceNPR')}
              type="number"
              min="1"
              step="0.01"
              required
              placeholder="e.g. 35"
              error={errors.fare_paid?.message}
              hint={fareLoading ? 'Looking up the fare…' : noFareConfigured ? 'No fare set for this leg — enter it manually.' : undefined}
              {...register('fare_paid', {
                required: t('ticketing.priceRequired'),
                min: { value: 1, message: t('ticketing.priceMin') },
                onChange: () => setFareEdited(true),
              })}
            />

            {/* Payment method */}
            <SelectField label={t('ticketing.paymentMethod')} required {...register('payment_method')}>
              <option value="CASH">{t('ticketing.paymentMethods.CASH')}</option>
              <option value="ESEWA">{t('ticketing.paymentMethods.ESEWA')}</option>
              <option value="KHALTI">{t('ticketing.paymentMethods.KHALTI')}</option>
              <option value="FONEPAY">{t('ticketing.paymentMethods.FONEPAY')}</option>
              <option value="SMART_CARD">{t('ticketing.paymentMethods.SMART_CARD')}</option>
              <option value="CONNECTIPS">{t('ticketing.paymentMethods.CONNECTIPS')}</option>
            </SelectField>

            {/* Passenger Name (optional) */}
            <Input
              label={t('ticketing.passengerOptional')}
              placeholder="e.g. Hari Prasad Adhikari"
              {...register('passenger_name')}
            />

            {/* Source note */}
            <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-2.5 flex items-center gap-2">
              <Monitor className="h-4 w-4 text-blue-500 flex-shrink-0" />
              <p className="text-xs text-blue-700">
                {t('ticketing.posNote')}
              </p>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 border-t pt-4">
              <Button variant="secondary" type="button" onClick={handleClosePOS}>
                {t('common:common.cancel')}
              </Button>
              <Button
                type="submit"
                loading={issueMutation.isPending}
                leftIcon={<Ticket className="h-4 w-4" />}
              >
                {t('ticketing.issueTicket')}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Verify Ticket Modal ───────────────────────────────────────────── */}
      <Modal
        open={showVerify}
        onClose={() => { setShowVerify(false); setVerifyResult(null); setVerifyTicketNum('') }}
        title={t('ticketing.verifyTicket')}
        size="sm"
      >
        <div className="space-y-4 p-6">
          <div className="flex gap-2">
            <Input
              placeholder={t('ticketing.verifyPlaceholder')}
              value={verifyTicketNum}
              onChange={(e) => setVerifyTicketNum(e.target.value.toUpperCase())}
              className="flex-1 font-mono"
            />
            <Button onClick={handleVerify} disabled={!verifyTicketNum}>
              {t('ticketing.verifyButton')}
            </Button>
          </div>
          {verifyResult && (
            <div
              className={`rounded-xl p-4 ${
                verifyResult.is_valid
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-red-50 border border-red-200'
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                {verifyResult.is_valid ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600" />
                )}
                <span
                  className={`font-bold text-sm ${
                    verifyResult.is_valid ? 'text-green-700' : 'text-red-700'
                  }`}
                >
                  {verifyResult.is_valid
                    ? t('ticketing.validResult')
                    : `${t('ticketing.invalidResult')} — ${verifyResult.status}`}
                </span>
              </div>
              {verifyResult.is_valid && (
                <dl className="text-sm space-y-1.5">
                  {verifyResult.passenger_name && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">{t('ticketing.passenger_label')}</dt>
                      <dd className="font-medium">{verifyResult.passenger_name}</dd>
                    </div>
                  )}
                  {verifyResult.route && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">{t('ticketing.route_label')}</dt>
                      <dd>{verifyResult.route}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-gray-500">{t('ticketing.fare_label')}</dt>
                    <dd className="font-semibold">{formatNPR(verifyResult.fare, 'en')}</dd>
                  </div>
                </dl>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* ── QR Code Modal ────────────────────────────────────────────────── */}
      <Modal
        open={!!selectedTicket}
        onClose={() => setSelectedTicket(null)}
        title={t('ticketing.ticketQR')}
        size="sm"
      >
        {selectedTicket?.qr_code && (
          <div className="flex flex-col items-center gap-3 p-6">
            <img
              src={`data:image/png;base64,${selectedTicket.qr_code}`}
              alt={t('ticketing.ticketQR')}
              className="h-44 w-44 rounded-xl border border-gray-100 shadow"
            />
            <code className="font-mono text-sm font-bold text-gray-700">
              {selectedTicket.ticket_uid}
            </code>
            <div className="text-center text-xs text-gray-500 space-y-0.5">
              <p>{selectedTicket.from_stop_name} → {selectedTicket.to_stop_name}</p>
              <p>{formatNPR(Number(selectedTicket.fare_paid), language as 'en' | 'ne')}</p>
              {selectedTicket.passenger_name && <p>{selectedTicket.passenger_name}</p>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
