/**
 * StopsPage — select a route from dropdown, see its path on the map,
 * click to place stops, fill details, and save.
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, MapPin, X, Navigation, Eye, Pencil, Trash2 } from 'lucide-react'
import Map, { Marker, Popup, Source, Layer, useMap } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BAATO_STYLE_URL } from '@/config/baato'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { NepaliInput } from '@components/shared/NepaliInput'
import { Badge } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

const KATHMANDU: [number, number] = [27.7172, 85.3240]

// Parse GeoJSON LineString into [lng, lat][] for MapLibre Source (preserves GeoJSON coordinate order)
function parseRouteGeoJSON(geojson: string): [number, number][] {
  try {
    const parsed = JSON.parse(geojson)
    return parsed?.geometry?.coordinates ?? parsed?.coordinates ?? []
  } catch {
    return []
  }
}

// Invalidates map size after the modal's CSS scale transition (≈200 ms).
function MapResizeHandler() {
  const { current: map } = useMap()
  useEffect(() => {
    const t = setTimeout(() => map?.resize(), 250)
    return () => clearTimeout(t)
  }, [map])
  return null
}

// ── Types ────────────────────────────────────────────────────────────────────
interface StopDetail {
  id: string
  stop_code: string
  name_en: string
  name_ne: string
  latitude: number
  longitude: number
  status: string
}

interface RouteStopItem {
  id: string
  sequence_no: number
  stop_detail: StopDetail
}

interface Route {
  id: string
  route_code: string
  name_en: string
  geojson_path: string
  route_stops: RouteStopItem[]
}

interface StopRoute {
  id: string
  route_code: string
  name_en: string
}

interface Stop {
  id: string
  stop_code: string
  name_en: string
  name_ne: string
  latitude: number
  longitude: number
  status: string
  routes: StopRoute[]
}

interface PendingStop {
  lat: number
  lng: number
  name_en: string
  name_ne: string
  is_terminal: boolean
}

interface SavedStop extends PendingStop {
  seq: number
  id: string
  route_stop_id: string
}

interface StopForm {
  name_en: string
  name_ne: string
  is_terminal: boolean
}

type PopupInfo =
  | { kind: 'existing'; lat: number; lng: number; seq: number; name: string; routeStopId: string }
  | { kind: 'saved'; lat: number; lng: number; seq: number; name: string }
  | null

// ── Helper: build a Stop object from StopDetail for modals ───────────────────
function buildStop(detail: StopDetail, allRoutes: Route[]): Stop {
  const routes = allRoutes
    .filter((r) => r.route_stops?.some((rs) => rs.stop_detail.id === detail.id))
    .map((r) => ({ id: r.id, route_code: r.route_code, name_en: r.name_en }))
  return {
    id: detail.id,
    stop_code: detail.stop_code ?? '',
    name_en: detail.name_en,
    name_ne: detail.name_ne ?? '',
    latitude: detail.latitude,
    longitude: detail.longitude,
    status: detail.status ?? 'ACTIVE',
    routes,
  }
}

// ════════════════════════════════════════════════════════════════════════════════
export default function StopsPage() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selectedRouteId, setSelectedRouteId] = useState('')
  const [pendingStop, setPendingStop] = useState<PendingStop | null>(null)
  const [savedStops, setSavedStops] = useState<SavedStop[]>([])
  const [openPopup, setOpenPopup] = useState<PopupInfo>(null)

  const [viewTarget, setViewTarget] = useState<Stop | null>(null)
  const [editTarget, setEditTarget] = useState<Stop | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Stop | null>(null)
  const [editNameEn, setEditNameEn] = useState('')
  const [editNameNe, setEditNameNe] = useState('')
  const [editStatus, setEditStatus] = useState('ACTIVE')

  const { data: routes = [], isLoading: routesLoading } = useQuery({
    queryKey: ['routes-dropdown'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/routes/', {
        params: { page_size: 200 },
      })
      return (Array.isArray(data.data) ? data.data : []) as Route[]
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data: allStops = [] } = useQuery<Stop[]>({
    queryKey: ['stops'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/stops/', { params: { page_size: 500 } })
      return Array.isArray(data.data) ? data.data : (data.data?.results ?? [])
    },
    staleTime: 2 * 60 * 1000,
  })

  const assignedStopIds = useMemo(
    () => new Set(routes.flatMap((r) => r.route_stops?.map((rs) => rs.stop_detail.id) ?? [])),
    [routes]
  )

  const filteredRoutes = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return routes
    return routes
      .map((route) => ({
        ...route,
        route_stops: route.route_stops?.filter(
          (rs) =>
            rs.stop_detail.name_en.toLowerCase().includes(q) ||
            route.route_code.toLowerCase().includes(q) ||
            route.name_en.toLowerCase().includes(q)
        ) ?? [],
      }))
      .filter((r) => r.route_stops.length > 0)
  }, [routes, search])

  const unassignedStops = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allStops.filter(
      (s) =>
        !assignedStopIds.has(s.id) &&
        (!q || s.name_en.toLowerCase().includes(q))
    )
  }, [allStops, assignedStopIds, search])

  const isLoading = routesLoading

  const selectedRoute = routes.find((r) => r.id === selectedRouteId)
  // routePath is [lng, lat][] — GeoJSON coordinate order for MapLibre Source
  const routePath = selectedRoute?.geojson_path ? parseRouteGeoJSON(selectedRoute.geojson_path) : []

  // Map center derived from route path; routePath[*][0] = lng, routePath[*][1] = lat
  const mapCenter = routePath.length > 0
    ? {
        longitude: routePath.reduce((s, p) => s + p[0], 0) / routePath.length,
        latitude: routePath.reduce((s, p) => s + p[1], 0) / routePath.length,
      }
    : { longitude: KATHMANDU[1], latitude: KATHMANDU[0] }

  const { register, handleSubmit, reset, formState: { errors } } = useForm<StopForm>()

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (!pendingStop) {
      setPendingStop({ lat, lng, name_en: '', name_ne: '', is_terminal: false })
      setOpenPopup(null)
    }
  }, [pendingStop])

  const addStopMutation = useMutation({
    mutationFn: async (form: StopForm) => {
      if (!pendingStop || !selectedRouteId) throw new Error(t('stops.noStopOrRoute'))
      const res = await apiClient.post(`/platform/routes/${selectedRouteId}/add-stop/`, {
        name_en: form.name_en,
        name_ne: form.name_ne || '',
        latitude: pendingStop.lat.toFixed(7),
        longitude: pendingStop.lng.toFixed(7),
        is_terminal: form.is_terminal,
      })
      return { ...res.data.data, formData: form }
    },
    onSuccess: (data) => {
      toast.success(t('stops.toasts.added', { name: data.formData.name_en }))
      setSavedStops((prev) => [...prev, {
        ...pendingStop!,
        name_en: data.formData.name_en,
        name_ne: data.formData.name_ne,
        is_terminal: data.formData.is_terminal,
        seq: data.sequence_no,
        id: data.stop.id,
        route_stop_id: data.route_stop_id,
      }])
      setPendingStop(null)
      setOpenPopup(null)
      reset()
      qc.invalidateQueries({ queryKey: ['stops'] })
      qc.invalidateQueries({ queryKey: ['routes'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { message?: string; errors?: Record<string, unknown> } } }
      if (e?.response?.status === 403) return
      const res = e?.response?.data
      if (res?.errors && typeof res.errors === 'object' && Object.keys(res.errors).length > 0) {
        const firstKey = Object.keys(res.errors)[0]
        const val = res.errors[firstKey]
        toast.error(`${firstKey}: ${Array.isArray(val) ? String(val[0]) : String(val)}`)
      } else {
        toast.error(res?.message || (err as Error).message || 'Failed to add stop')
      }
    },
  })

  const removeStopFromRouteMutation = useMutation({
    mutationFn: ({ routeStopId }: { routeStopId: string; sessionStopId?: string }) =>
      apiClient.post(`/platform/routes/${selectedRouteId}/remove-stop/`, {
        route_stop_id: routeStopId,
      }),
    onSuccess: (_, { sessionStopId }) => {
      if (sessionStopId) {
        setSavedStops((prev) => prev.filter((s) => s.id !== sessionStopId))
      }
      setOpenPopup(null)
      toast.success('Stop removed from route.')
      qc.invalidateQueries({ queryKey: ['stops'] })
      qc.invalidateQueries({ queryKey: ['routes-dropdown'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to remove stop')
    },
  })

  useEffect(() => {
    if (!editTarget) return
    setEditNameEn(editTarget.name_en)
    setEditNameNe(editTarget.name_ne ?? '')
    setEditStatus(editTarget.status)
  }, [editTarget])

  const updateStopMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/platform/stops/${id}/`, {
        name_en: editNameEn,
        name_ne: editNameNe,
        status: editStatus,
      }),
    onSuccess: () => {
      toast.success('Stop updated.')
      setEditTarget(null)
      qc.invalidateQueries({ queryKey: ['stops'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to update stop')
    },
  })

  const deleteStopMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/platform/stops/${id}/`),
    onSuccess: () => {
      toast.success('Stop deleted.')
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['stops'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to delete stop')
    },
  })

  const handleCloseModal = () => {
    setShowCreate(false)
    setPendingStop(null)
    setSavedStops([])
    setSelectedRouteId('')
    setOpenPopup(null)
    reset()
  }

  const stopActions = (stop: Stop) => (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setViewTarget(stop)}
        className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
      >
        <Eye className="h-3 w-3" /> {t('common.view')}
      </button>
      <button
        onClick={() => setEditTarget(stop)}
        className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
      >
        <Pencil className="h-3 w-3" /> {t('common.edit')}
      </button>
      <button
        onClick={() => setDeleteTarget(stop)}
        className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
      >
        <Trash2 className="h-3 w-3" /> {t('common.delete')}
      </button>
    </div>
  )

  // Route path GeoJSON for MapLibre Source (coordinates already in [lng, lat] order)
  const routePathGeoJSON = routePath.length >= 2 ? {
    type: 'Feature' as const,
    geometry: {
      type: 'LineString' as const,
      coordinates: routePath,
    },
    properties: {},
  } : null

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('stops.title')}</h1>
          <p className="page-subtitle">{t('stops.subtitle')}</p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
          {t('stops.addStop')}
        </Button>
      </div>

      <Input
        placeholder={t('stops.searchPlaceholder')}
        leftAddon={<Search className="h-4 w-4" />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {/* ── Grouped table ─────────────────────────────────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-gray-400">{t('stops.loading')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="w-40 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('stops.route')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('stops.stopName')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('stops.coordinates')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('common.status')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRoutes.flatMap((route) => {
                const sortedStops = [...(route.route_stops ?? [])].sort(
                  (a, b) => a.sequence_no - b.sequence_no
                )
                if (sortedStops.length === 0) return []
                return sortedStops.map((rs, idx) => {
                  const stop = buildStop(rs.stop_detail, routes)
                  return (
                    <tr key={rs.id} className="border-b border-gray-100 hover:bg-gray-50/70 transition-colors">
                      {idx === 0 && (
                        <td rowSpan={sortedStops.length} className="border-r border-gray-100 bg-gray-50/50 px-4 py-3 align-top">
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
                            {route.route_code}
                          </span>
                          <p className="mt-1 max-w-[130px] text-xs leading-tight text-gray-400">{route.name_en}</p>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-[10px] font-bold text-red-600">
                            {rs.sequence_no}
                          </span>
                          <div>
                            <p className="font-medium text-gray-900">{rs.stop_detail.name_en}</p>
                            {rs.stop_detail.name_ne && <p className="text-xs text-gray-400">{rs.stop_detail.name_ne}</p>}
                            <code className="text-[10px] text-gray-400">{rs.stop_detail.stop_code}</code>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs text-gray-600">
                          {Number(rs.stop_detail.latitude).toFixed(5)},{' '}
                          {Number(rs.stop_detail.longitude).toFixed(5)}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={rs.stop_detail.status === 'ACTIVE' ? 'success' : 'neutral'} dot>
                          {t(`stops.status.${rs.stop_detail.status}`, { defaultValue: rs.stop_detail.status ?? 'ACTIVE' })}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">{stopActions(stop)}</td>
                    </tr>
                  )
                })
              })}

              {unassignedStops.length > 0 &&
                unassignedStops.map((s, idx) => (
                  <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50/70 transition-colors">
                    {idx === 0 && (
                      <td rowSpan={unassignedStops.length} className="border-r border-gray-100 bg-gray-50/50 px-4 py-3 align-top">
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500 ring-1 ring-inset ring-gray-200">
                          {t('stops.unassigned')}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 shrink-0 text-gray-300" />
                        <div>
                          <p className="font-medium text-gray-700">{s.name_en}</p>
                          {s.name_ne && <p className="text-xs text-gray-400">{s.name_ne}</p>}
                          <code className="text-[10px] text-gray-400">{s.stop_code}</code>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs text-gray-600">
                        {Number(s.latitude).toFixed(5)}, {Number(s.longitude).toFixed(5)}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={s.status === 'ACTIVE' ? 'success' : 'neutral'} dot>
                        {t(`stops.status.${s.status}`, { defaultValue: s.status })}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">{stopActions(s)}</td>
                  </tr>
                ))}

              {filteredRoutes.length === 0 && unassignedStops.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-16 text-center text-sm text-gray-400">
                    {search ? t('stops.noMatch', { query: search }) : t('stops.noStopsFound')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── View Stop Modal ─────────────────────────────────────────────────── */}
      {viewTarget && (
        <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title={t('stops.details')} size="sm">
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('stops.stopName')}</p>
                <p className="text-sm font-semibold text-gray-800">{viewTarget.name_en}</p>
                {viewTarget.name_ne && <p className="text-xs text-gray-500 mt-0.5">{viewTarget.name_ne}</p>}
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('stops.code')}</p>
                <code className="text-sm font-bold text-gray-800">{viewTarget.stop_code}</code>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('common.status')}</p>
                <Badge variant={viewTarget.status === 'ACTIVE' ? 'success' : 'neutral'} dot>
                  {t(`stops.status.${viewTarget.status}`, { defaultValue: viewTarget.status })}
                </Badge>
              </div>
              <div className="col-span-2 rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('stops.coordinates')}</p>
                <code className="text-xs font-mono text-gray-700">
                  {Number(viewTarget.latitude).toFixed(5)}, {Number(viewTarget.longitude).toFixed(5)}
                </code>
              </div>
            </div>
            {viewTarget.routes?.length > 0 && (
              <div className="rounded-xl bg-blue-50 p-3">
                <p className="text-xs font-semibold text-blue-600 mb-2">{t('stops.routesUsing')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {viewTarget.routes.map((r) => (
                    <span key={r.id} className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                      {r.route_code} — {r.name_en}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="secondary" onClick={() => setViewTarget(null)}>{t('common.close')}</Button>
              <Button onClick={() => { setViewTarget(null); setEditTarget(viewTarget) }}>{t('stops.editStop')}</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Edit Stop Modal ──────────────────────────────────────────────────── */}
      {editTarget && (
        <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={t('stops.editStop')} size="sm">
          <div className="p-5 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('stops.stopNameEnLabel')} *</label>
              <input
                value={editNameEn}
                onChange={(e) => setEditNameEn(e.target.value)}
                placeholder="e.g. Kalanki Chowk"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div>
              <NepaliInput
                label={t('stops.stopNameNeLabel')}
                value={editNameNe}
                onChange={(e) => setEditNameNe(e.target.value)}
                placeholder="e.g. कलंकी चोक"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('common.status')}</label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="ACTIVE">{t('stops.status.ACTIVE')}</option>
                <option value="INACTIVE">{t('stops.status.INACTIVE')}</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="secondary" onClick={() => setEditTarget(null)}>{t('common.cancel')}</Button>
              <Button
                loading={updateStopMutation.isPending}
                disabled={!editNameEn.trim()}
                onClick={() => updateStopMutation.mutate(editTarget.id)}
              >
                {t('common.update')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Delete Stop Modal ────────────────────────────────────────────────── */}
      {deleteTarget && (
        <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t('stops.deleteStop')} size="sm">
          <div className="p-5 space-y-4">
            <div className="rounded-xl border border-red-100 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-700 mb-1">{t('stops.cannotUndo')}</p>
              <p className="text-sm text-red-600">
                {t('stops.deleteDesc', { name: deleteTarget.name_en, code: deleteTarget.stop_code })}
              </p>
              {deleteTarget.routes?.length > 0 && (
                <p className="mt-2 text-xs text-red-500">
                  {t('stops.routesAffected', { count: deleteTarget.routes.length })}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t('stops.keepStop')}</Button>
              <Button
                variant="danger"
                loading={deleteStopMutation.isPending}
                onClick={() => deleteStopMutation.mutate(deleteTarget.id)}
              >
                {t('stops.deleteStop')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Add Stop Modal ──────────────────────────────────────────────────── */}
      <Modal open={showCreate} onClose={handleCloseModal} title={t('stops.addBusStop')} size="xl">
        <div className="flex h-[620px] flex-col">

          {/* Route selector strip */}
          <div className="shrink-0 border-b border-gray-100 bg-gray-50 px-6 py-3">
            <div className="flex items-center gap-4">
              <div className="w-80">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('stops.selectRoute')} *
                </label>
                <select
                  value={selectedRouteId}
                  onChange={(e) => {
                    setSelectedRouteId(e.target.value)
                    setPendingStop(null)
                    setSavedStops([])
                    setOpenPopup(null)
                    reset()
                  }}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                             focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="">{t('stops.chooseRoute')}</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.route_code} — {r.name_en}
                    </option>
                  ))}
                </select>
              </div>
              {selectedRoute && (
                <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                  <Navigation className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium text-blue-700">{selectedRoute.name_en}</span>
                  {routePath.length > 0 && (
                    <Badge variant="info" className="ml-1">{t('stops.routeVisible')}</Badge>
                  )}
                </div>
              )}
            </div>
            {selectedRouteId && !pendingStop && (
              <p className="mt-2 text-xs text-amber-600 font-medium">
                📍 {t('stops.clickMapHint')}
              </p>
            )}
          </div>

          {/* Map + form panel */}
          <div className="flex flex-1 overflow-hidden">
            {/* Map — key forces remount when route changes to re-center */}
            <div className="relative flex-1 h-full">
              <Map
                key={selectedRouteId || 'default'}
                initialViewState={{
                  latitude: mapCenter.latitude,
                  longitude: mapCenter.longitude,
                  zoom: routePath.length > 0 ? 13 : 12,
                }}
                style={{ height: '100%', width: '100%' }}
                mapStyle={BAATO_STYLE_URL}
                cursor={selectedRouteId && !pendingStop ? 'crosshair' : 'default'}
                onClick={(e) => {
                  if (selectedRouteId && !pendingStop) {
                    handleMapClick(e.lngLat.lat, e.lngLat.lng)
                  }
                }}
              >
                <MapResizeHandler />

                {/* Route polyline */}
                {routePathGeoJSON && (
                  <Source id="route-path" type="geojson" data={routePathGeoJSON}>
                    <Layer
                      id="route-path-line"
                      type="line"
                      paint={{ 'line-color': '#2563eb', 'line-width': 4, 'line-opacity': 0.7, 'line-dasharray': [2, 1] }}
                      layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                    />
                  </Source>
                )}

                {/* Existing route stops */}
                {selectedRoute?.route_stops?.map((rs) => (
                  <Marker
                    key={rs.id}
                    latitude={rs.stop_detail.latitude}
                    longitude={rs.stop_detail.longitude}
                    anchor="center"
                  >
                    <div
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenPopup({
                          kind: 'existing',
                          lat: rs.stop_detail.latitude,
                          lng: rs.stop_detail.longitude,
                          seq: rs.sequence_no,
                          name: rs.stop_detail.name_en,
                          routeStopId: rs.id,
                        })
                      }}
                      style={{
                        background: '#dc2626', color: '#fff', borderRadius: '50%',
                        width: 28, height: 28, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 11, fontWeight: 700,
                        boxShadow: '0 2px 6px rgba(0,0,0,.35)', border: '2px solid #fff',
                        cursor: 'pointer',
                      }}
                    >
                      {rs.sequence_no}
                    </div>
                  </Marker>
                ))}

                {/* Newly saved stops this session */}
                {savedStops.map((s) => (
                  <Marker key={s.id} latitude={s.lat} longitude={s.lng} anchor="center">
                    <div
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenPopup({ kind: 'saved', lat: s.lat, lng: s.lng, seq: s.seq, name: s.name_en })
                      }}
                      style={{
                        background: s.is_terminal ? '#16a34a' : '#dc2626', color: '#fff',
                        borderRadius: '50%', width: 28, height: 28, display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontSize: 11,
                        fontWeight: 700, boxShadow: '0 2px 6px rgba(0,0,0,.35)',
                        border: '2px solid #fff', cursor: 'pointer',
                      }}
                    >
                      {s.seq}
                    </div>
                  </Marker>
                ))}

                {/* Pending stop pin */}
                {pendingStop && (
                  <Marker latitude={pendingStop.lat} longitude={pendingStop.lng} anchor="center">
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%',
                      background: '#f59e0b', border: '3px solid #fff',
                      boxShadow: '0 2px 6px rgba(0,0,0,.4)',
                    }} />
                  </Marker>
                )}

                {/* Popups */}
                {openPopup?.kind === 'existing' && (
                  <Popup
                    latitude={openPopup.lat}
                    longitude={openPopup.lng}
                    onClose={() => setOpenPopup(null)}
                    closeButton
                  >
                    <div className="text-sm min-w-[160px]">
                      <p className="font-semibold mb-1">#{openPopup.seq} {openPopup.name}</p>
                      <button
                        onClick={() => removeStopFromRouteMutation.mutate({ routeStopId: openPopup.routeStopId })}
                        disabled={removeStopFromRouteMutation.isPending}
                        style={{
                          background: '#fee2e2', color: '#b91c1c', border: 'none',
                          borderRadius: '6px', padding: '3px 8px', fontSize: '11px',
                          fontWeight: 600, cursor: 'pointer', width: '100%', marginTop: '2px',
                        }}
                      >
                        {removeStopFromRouteMutation.isPending ? t('stops.removing') : `✕ ${t('stops.removeFromRoute')}`}
                      </button>
                    </div>
                  </Popup>
                )}
                {openPopup?.kind === 'saved' && (
                  <Popup
                    latitude={openPopup.lat}
                    longitude={openPopup.lng}
                    onClose={() => setOpenPopup(null)}
                    closeButton
                  >
                    <p className="text-sm font-semibold text-green-700">#{openPopup.seq} {openPopup.name}</p>
                    <p className="text-xs text-gray-400">{t('stops.justAdded')}</p>
                  </Popup>
                )}
              </Map>

              {/* No route selected overlay */}
              {!selectedRouteId && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-sm">
                  <div className="rounded-xl border border-gray-200 bg-white px-6 py-5 shadow-lg text-center">
                    <MapPin className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                    <p className="font-semibold text-gray-600">{t('stops.selectRouteFirst')}</p>
                    <p className="mt-1 text-sm text-gray-400">{t('stops.routePathOnMap')}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Stop detail form */}
            <div className="flex w-72 shrink-0 flex-col border-l border-gray-100 bg-white p-5">
              {!pendingStop ? (
                <div className="flex flex-1 flex-col items-center justify-center text-center gap-3">
                  <div className="rounded-full bg-gray-100 p-4">
                    <MapPin className="h-7 w-7 text-gray-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-600">
                      {selectedRouteId ? t('stops.clickMapForStop') : t('stops.selectRouteFirst')}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {selectedRouteId ? t('stops.fillStopDetails') : t('stops.mapShowsRoute')}
                    </p>
                  </div>

                  {savedStops.length > 0 && (
                    <div className="mt-4 w-full rounded-xl border border-green-200 bg-green-50 p-3">
                      <p className="text-xs font-semibold text-green-700 mb-2">
                        {t('stops.stopsAdded', { count: savedStops.length })}
                      </p>
                      <div className="space-y-1">
                        {savedStops.map((s) => (
                          <div key={s.id} className="flex items-center gap-1.5 text-xs text-green-700">
                            <span className="h-4 w-4 rounded-full bg-green-500 text-white text-[9px] flex items-center justify-center font-bold shrink-0">
                              {s.seq}
                            </span>
                            <span className="truncate flex-1">{s.name_en}</span>
                            {s.is_terminal && <Badge variant="info" className="text-[9px] py-0">T</Badge>}
                            <button
                              onClick={() => removeStopFromRouteMutation.mutate({
                                routeStopId: s.route_stop_id,
                                sessionStopId: s.id,
                              })}
                              disabled={removeStopFromRouteMutation.isPending}
                              title="Remove this stop from route"
                              className="ml-1 rounded p-0.5 text-red-400 hover:bg-red-100 hover:text-red-600 transition-colors disabled:opacity-40 shrink-0"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-800">{t('stops.newStop')}</p>
                    <button
                      type="button"
                      onClick={() => { setPendingStop(null); reset() }}
                      className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    📍 {pendingStop.lat.toFixed(5)}, {pendingStop.lng.toFixed(5)}
                  </div>

                  <form
                    onSubmit={handleSubmit((d) => addStopMutation.mutate(d))}
                    className="flex flex-1 flex-col gap-3"
                  >
                    <Input
                      label={`${t('stops.stopNameEnLabel')} *`}
                      placeholder="e.g. Kalanki Chowk"
                      error={errors.name_en?.message}
                      {...register('name_en', { required: 'Stop name is required' })}
                    />
                    <NepaliInput
                      label={t('stops.stopNameNeLabel')}
                      placeholder="e.g. कलंकी चोक"
                      {...register('name_ne')}
                    />
                    <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5">
                      <input
                        type="checkbox"
                        id="is_terminal"
                        className="h-4 w-4 rounded border-gray-300 text-green-600"
                        {...register('is_terminal')}
                      />
                      <label htmlFor="is_terminal" className="text-sm text-gray-700 cursor-pointer">
                        {t('stops.terminalStop')}
                        <span className="block text-xs text-gray-400">{t('stops.terminalStopDesc')}</span>
                      </label>
                    </div>

                    <div className="mt-auto pt-3 border-t border-gray-100 space-y-2">
                      <Button
                        type="submit"
                        className="w-full"
                        loading={addStopMutation.isPending}
                        leftIcon={<Plus className="h-4 w-4" />}
                      >
                        {t('stops.addStop')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                        onClick={() => { setPendingStop(null); reset() }}
                      >
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
