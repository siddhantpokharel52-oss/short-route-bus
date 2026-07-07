/**
 * RoutesPage — draw a route on the map by clicking waypoints, then name & save it.
 */
import { useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, MapPin, Ruler, Trash2, Undo2, Map as MapIcon, CheckCircle, Eye, Pencil } from 'lucide-react'
import Map, { Marker, Popup, Source, Layer, useMap } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BAATO_STYLE_URL } from '@/config/baato'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { NepaliInput } from '@components/shared/NepaliInput'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { usePagination } from '@hooks/usePagination'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import { cn } from '@utils/cn'
import { useTranslation } from 'react-i18next'

const KATHMANDU: [number, number] = [27.7172, 85.3240]

// ── Haversine distance between two lat/lng points (km) ──────────────────────
function haversine([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function totalDistance(pts: [number, number][]) {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i])
  return d
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

// ── Route interface ──────────────────────────────────────────────────────────
interface Route {
  id: string
  route_code: string
  name_en: string
  name_ne: string
  distance_km: number
  status: string
  geojson_path: string
  route_stops: { id: string; sequence_no: number; stop_detail: { name_en: string } }[]
}

interface RouteForm {
  route_code: string
  name_en: string
  name_ne: string
  base_fare: string
}

// ════════════════════════════════════════════════════════════════════════════════
export default function RoutesPage() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const pagination = usePagination(totalCount)

  const [waypoints, setWaypoints] = useState<[number, number][]>([])
  const [openWaypointIdx, setOpenWaypointIdx] = useState<number | null>(null)

  const [viewTarget, setViewTarget] = useState<Route | null>(null)
  const [editTarget, setEditTarget] = useState<Route | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Route | null>(null)
  const [editCode, setEditCode] = useState('')
  const [editNameEn, setEditNameEn] = useState('')
  const [editNameNe, setEditNameNe] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['routes', pagination.page, search],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/routes/', {
        params: { ...pagination.queryParams, ...(search && { search }) },
      })
      setTotalCount(data.meta?.total_count ?? 0)
      return Array.isArray(data.data) ? data.data : []
    },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<RouteForm>()

  const createMutation = useMutation({
    mutationFn: (d: RouteForm) => {
      const dist = parseFloat(totalDistance(waypoints).toFixed(2))
      const geojson = waypoints.length >= 2
        ? JSON.stringify({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: waypoints.map(([lat, lng]) => [lng, lat]),
            },
          })
        : ''
      return apiClient.post('/platform/routes/', {
        route_code: d.route_code,
        name_en: d.name_en,
        name_ne: d.name_ne || '',
        distance_km: dist,
        geojson_path: geojson,
        route_type: 'EXCLUSIVE',
        status: 'DRAFT',
      })
    },
    onSuccess: () => {
      toast.success(t('routes.toasts.created'))
      setShowCreate(false)
      setWaypoints([])
      reset()
      qc.invalidateQueries({ queryKey: ['routes'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { message?: string; errors?: Record<string, unknown> } } }
      if (e?.response?.status === 403) return
      const res = e?.response?.data
      if (res?.errors && typeof res.errors === 'object' && Object.keys(res.errors).length > 0) {
        const firstKey = Object.keys(res.errors)[0]
        const val = res.errors[firstKey]
        toast.error(Array.isArray(val) ? String(val[0]) : String(val))
      } else {
        toast.error(res?.message || (err as Error).message || t('routes.toasts.createFailed'))
      }
    },
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/platform/routes/${id}/approve/`),
    onSuccess: () => {
      toast.success(t('routes.toasts.approved'))
      qc.invalidateQueries({ queryKey: ['routes'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { message?: string } } }
      if (e?.response?.status === 403) return
      toast.error(e?.response?.data?.message || t('routes.toasts.approveFailed'))
    },
  })

  useEffect(() => {
    if (!editTarget) return
    setEditCode(editTarget.route_code)
    setEditNameEn(editTarget.name_en)
    setEditNameNe(editTarget.name_ne ?? '')
  }, [editTarget])

  const updateRouteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/platform/routes/${id}/`, {
        route_code: editCode,
        name_en: editNameEn,
        name_ne: editNameNe,
      }),
    onSuccess: () => {
      toast.success(t('routes.toasts.updated'))
      setEditTarget(null)
      qc.invalidateQueries({ queryKey: ['routes'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { message?: string } } }
      if (e?.response?.status === 403) return
      toast.error(e?.response?.data?.message || t('routes.toasts.updateFailed'))
    },
  })

  const deleteRouteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/platform/routes/${id}/`),
    onSuccess: () => {
      toast.success(t('routes.toasts.deleted'))
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['routes'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { message?: string } } }
      if (e?.response?.status === 403) return
      toast.error(e?.response?.data?.message || t('routes.toasts.deleteFailed'))
    },
  })

  const handleMapClick = useCallback((lat: number, lng: number) => {
    setWaypoints((prev) => [...prev, [lat, lng]])
    setOpenWaypointIdx(null)
  }, [])

  const handleUndo = () => setWaypoints((prev) => prev.slice(0, -1))
  const handleClear = () => setWaypoints([])

  const distKm = totalDistance(waypoints).toFixed(2)

  // GeoJSON for the drawn polyline — [lng, lat] for MapLibre
  const polylineGeoJSON = waypoints.length >= 2 ? {
    type: 'Feature' as const,
    geometry: {
      type: 'LineString' as const,
      coordinates: waypoints.map(([lat, lng]) => [lng, lat]),
    },
    properties: {},
  } : null

  const columns: Column<Route>[] = [
    {
      key: 'route_code',
      header: t('routes.code'),
      render: (r) => <span className="font-mono font-bold text-primary-600">{r.route_code}</span>,
    },
    {
      key: 'name_en',
      header: t('routes.routeName'),
      render: (r) => (
        <div>
          <p className="font-medium text-gray-900">{r.name_en}</p>
          {r.name_ne && <p className="text-xs text-gray-400">{r.name_ne}</p>}
        </div>
      ),
    },
    {
      key: 'route_stops',
      header: t('routes.stops'),
      render: (r) => (
        <div className="flex items-center gap-1 text-sm">
          <MapPin className="h-3.5 w-3.5 text-gray-400" />
          {r.route_stops?.length ?? 0} {t('routes.stopsCount')}
        </div>
      ),
    },
    {
      key: 'distance_km',
      header: t('routes.distance'),
      render: (r) => (
        <div className="flex items-center gap-1 text-sm">
          <Ruler className="h-3.5 w-3.5 text-gray-400" />
          {r.distance_km} {t('routes.distanceUnit')}
        </div>
      ),
    },
    {
      key: 'geojson_path',
      header: t('routes.path'),
      render: (r) => r.geojson_path
        ? <Badge variant="success">{t('routes.pathStatus.Mapped')}</Badge>
        : <Badge variant="neutral">{t('routes.pathStatus.No map')}</Badge>,
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (r) => (
        <Badge variant={r.status === 'APPROVED' ? 'success' : r.status === 'DRAFT' ? 'neutral' : 'warning'} dot>
          {t(`routes.status.${r.status}`, { defaultValue: r.status })}
        </Badge>
      ),
    },
    {
      key: 'id',
      header: t('common.actions'),
      render: (r) => (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewTarget(r)}
              className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
            >
              <Eye className="h-3 w-3" /> {t('common.view')}
            </button>
            <button
              onClick={() => setEditTarget(r)}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
            >
              <Pencil className="h-3 w-3" /> {t('common.edit')}
            </button>
            <button
              onClick={() => setDeleteTarget(r)}
              className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
            >
              <Trash2 className="h-3 w-3" /> {t('common.delete')}
            </button>
          </div>
          {r.status !== 'APPROVED' ? (
            <button
              onClick={() => approveMutation.mutate(r.id)}
              disabled={approveMutation.isPending}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold w-fit',
                'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <CheckCircle className="h-3 w-3" />
              {t('routes.approve')}
            </button>
          ) : (
            <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
              <CheckCircle className="h-3 w-3" />
              {t('routes.approved')}
            </span>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('routes.title')}</h1>
          <p className="page-subtitle">{t('routes.subtitle')}</p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
          {t('routes.addRoute')}
        </Button>
      </div>

      <Input
        placeholder={t('routes.searchPlaceholder')}
        leftAddon={<Search className="h-4 w-4" />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="card p-0">
        <Table columns={columns} data={data ?? []} keyExtractor={(r) => r.id} loading={isLoading} />
        <Pagination
          page={pagination.page} totalPages={pagination.totalPages}
          totalCount={totalCount} pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
        />
      </div>

      {/* ── View Route Modal ─────────────────────────────────────────────────── */}
      {viewTarget && (
        <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title={t('routes.details')} size="sm">
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('routes.code')}</p>
                <span className="font-mono font-bold text-primary-600 text-sm">{viewTarget.route_code}</span>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('common.status')}</p>
                <Badge variant={viewTarget.status === 'APPROVED' ? 'success' : viewTarget.status === 'DRAFT' ? 'neutral' : 'warning'} dot>
                  {t(`routes.status.${viewTarget.status}`, { defaultValue: viewTarget.status })}
                </Badge>
              </div>
              <div className="col-span-2 rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('routes.routeName')}</p>
                <p className="text-sm font-semibold text-gray-800">{viewTarget.name_en}</p>
                {viewTarget.name_ne && <p className="text-xs text-gray-500 mt-0.5">{viewTarget.name_ne}</p>}
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('routes.stops')}</p>
                <div className="flex items-center gap-1 text-sm text-gray-700">
                  <MapPin className="h-3.5 w-3.5 text-gray-400" />
                  {viewTarget.route_stops?.length ?? 0} {t('routes.stopsCount')}
                </div>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('routes.distanceLabel')}</p>
                <div className="flex items-center gap-1 text-sm text-gray-700">
                  <Ruler className="h-3.5 w-3.5 text-gray-400" />
                  {viewTarget.distance_km} {t('routes.distanceUnit')}
                </div>
              </div>
              <div className="col-span-2 rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400 mb-0.5">{t('routes.pathMapped')}</p>
                {viewTarget.geojson_path
                  ? <Badge variant="success">{t('routes.pathYes')}</Badge>
                  : <Badge variant="neutral">{t('routes.pathNo')}</Badge>}
              </div>
            </div>
            {viewTarget.route_stops?.length > 0 && (
              <div className="rounded-xl bg-blue-50 p-3">
                <p className="text-xs font-semibold text-blue-600 mb-2">{t('routes.stopsOnRoute')}</p>
                <div className="space-y-1">
                  {viewTarget.route_stops.map((rs) => (
                    <div key={rs.id} className="flex items-center gap-2 text-xs text-blue-700">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-white">
                        {rs.sequence_no}
                      </span>
                      {rs.stop_detail.name_en}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="secondary" onClick={() => setViewTarget(null)}>{t('common.close')}</Button>
              <Button onClick={() => { setViewTarget(null); setEditTarget(viewTarget) }}>{t('routes.editRoute')}</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Edit Route Modal ──────────────────────────────────────────────────── */}
      {editTarget && (
        <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={t('routes.editRoute')} size="sm">
          <div className="p-5 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('routes.editCodeLabel')} *</label>
              <input
                value={editCode}
                onChange={(e) => setEditCode(e.target.value)}
                placeholder="e.g. 23, 37A"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('routes.editNameEnLabel')} *</label>
              <input
                value={editNameEn}
                onChange={(e) => setEditNameEn(e.target.value)}
                placeholder="e.g. Ratnapark — Kalanki"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div>
              <NepaliInput
                label={t('routes.editNameNeLabel')}
                value={editNameNe}
                onChange={(e) => setEditNameNe(e.target.value)}
                placeholder="e.g. रत्नपार्क — कलंकी"
              />
            </div>
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="secondary" onClick={() => setEditTarget(null)}>{t('common.cancel')}</Button>
              <Button
                loading={updateRouteMutation.isPending}
                disabled={!editCode.trim() || !editNameEn.trim()}
                onClick={() => updateRouteMutation.mutate(editTarget.id)}
              >
                {t('routes.saveChanges')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Delete Route Modal ────────────────────────────────────────────────── */}
      {deleteTarget && (
        <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t('routes.deleteRoute')} size="sm">
          <div className="p-5 space-y-4">
            <div className="rounded-xl border border-red-100 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-700 mb-1">{t('routes.cannotUndo')}</p>
              <p className="text-sm text-red-600">
                {t('routes.deleteDesc', { code: deleteTarget.route_code, name: deleteTarget.name_en })}
              </p>
              {deleteTarget.route_stops?.length > 0 && (
                <p className="mt-2 text-xs text-red-500">
                  {t('routes.stopsDetached', { count: deleteTarget.route_stops.length })}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t('routes.keepRoute')}</Button>
              <Button
                variant="danger"
                loading={deleteRouteMutation.isPending}
                onClick={() => deleteRouteMutation.mutate(deleteTarget.id)}
              >
                {t('routes.deleteRoute')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Add Route Modal — map draw ──────────────────────────────────────── */}
      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); setWaypoints([]); reset() }}
        title={t('routes.addRoute')}
        size="xl"
      >
        <div className="flex h-[620px] flex-col">
          {/* Top form strip */}
          <form
            id="route-form"
            onSubmit={handleSubmit((d) => createMutation.mutate(d))}
            className="shrink-0 border-b border-gray-100 bg-gray-50 px-6 py-4"
          >
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Input
                label={`${t('routes.editCodeLabel')} *`}
                placeholder="e.g. 23, 37A"
                error={errors.route_code?.message}
                {...register('route_code', { required: t('routes.required') })}
              />
              <div className="sm:col-span-2">
                <Input
                  label={`${t('routes.editNameEnLabel')} *`}
                  placeholder="e.g. Ratnapark — Kalanki"
                  error={errors.name_en?.message}
                  {...register('name_en', { required: t('routes.required') })}
                />
              </div>
              <NepaliInput
                label={t('routes.editNameNeLabel')}
                placeholder="e.g. रत्नपार्क — कलंकी"
                {...register('name_ne')}
              />
            </div>
          </form>

          {/* Map + sidebar */}
          <div className="flex flex-1 overflow-hidden">
            {/* Map */}
            <div className="relative flex-1 h-full">
              <Map
                initialViewState={{ latitude: KATHMANDU[0], longitude: KATHMANDU[1], zoom: 12 }}
                style={{ height: '100%', width: '100%' }}
                mapStyle={BAATO_STYLE_URL}
                cursor="crosshair"
                onClick={(e) => {
                  setOpenWaypointIdx(null)
                  handleMapClick(e.lngLat.lat, e.lngLat.lng)
                }}
              >
                <MapResizeHandler />

                {/* Route polyline */}
                {polylineGeoJSON && (
                  <Source id="waypoint-route" type="geojson" data={polylineGeoJSON}>
                    <Layer
                      id="waypoint-route-line"
                      type="line"
                      paint={{ 'line-color': '#2563eb', 'line-width': 4, 'line-opacity': 0.85 }}
                      layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                    />
                  </Source>
                )}

                {/* Waypoint markers */}
                {waypoints.map((pt, i) => (
                  <Marker key={i} latitude={pt[0]} longitude={pt[1]} anchor="center">
                    <div
                      onClick={(e) => { e.stopPropagation(); setOpenWaypointIdx(i) }}
                      style={{
                        background: '#2563eb', color: '#fff', borderRadius: '50%',
                        width: 26, height: 26, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 11, fontWeight: 700,
                        boxShadow: '0 2px 6px rgba(0,0,0,.3)', border: '2px solid #fff',
                        cursor: 'pointer',
                      }}
                    >
                      {i + 1}
                    </div>
                  </Marker>
                ))}

                {/* Waypoint popup */}
                {openWaypointIdx !== null && waypoints[openWaypointIdx] && (
                  <Popup
                    latitude={waypoints[openWaypointIdx][0]}
                    longitude={waypoints[openWaypointIdx][1]}
                    onClose={() => setOpenWaypointIdx(null)}
                    closeButton
                  >
                    <div className="text-xs p-1">
                      <p className="font-semibold">Point {openWaypointIdx + 1}</p>
                      <p className="text-gray-500">
                        {waypoints[openWaypointIdx][0].toFixed(5)}, {waypoints[openWaypointIdx][1].toFixed(5)}
                      </p>
                    </div>
                  </Popup>
                )}
              </Map>

              {/* Map instruction overlay */}
              <div className="absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-xl bg-white/90 px-4 py-2 shadow text-sm font-medium text-gray-700 backdrop-blur-sm whitespace-nowrap pointer-events-none">
                <MapIcon className="inline h-4 w-4 mr-1.5 text-primary-500" />
                {t('routes.mapInstruction')}
              </div>
            </div>

            {/* Right sidebar */}
            <div className="flex w-64 shrink-0 flex-col border-l border-gray-100 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">{t('routes.waypoints')}</p>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={waypoints.length === 0}
                    title="Undo last point"
                    className={cn(
                      'rounded-lg p-1.5 text-gray-500 hover:bg-gray-100',
                      waypoints.length === 0 && 'opacity-30 cursor-not-allowed'
                    )}
                  >
                    <Undo2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={waypoints.length === 0}
                    title="Clear all"
                    className={cn(
                      'rounded-lg p-1.5 text-red-400 hover:bg-red-50',
                      waypoints.length === 0 && 'opacity-30 cursor-not-allowed'
                    )}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="mb-3 rounded-lg bg-primary-50 p-3 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">{t('routes.points')}</span>
                  <span className="font-semibold text-primary-700">{waypoints.length}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">{t('routes.distanceLabel')}</span>
                  <span className="font-semibold text-primary-700">{distKm} {t('routes.distanceUnit')}</span>
                </div>
              </div>

              {/* Waypoints list */}
              <div className="flex-1 overflow-y-auto space-y-1 text-xs">
                {waypoints.length === 0 ? (
                  <p className="text-center text-gray-400 mt-6 italic text-xs">
                    {t('routes.clickToStart')}
                  </p>
                ) : (
                  waypoints.map((pt, i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-2.5 py-1.5',
                        i === 0 ? 'bg-green-50' : i === waypoints.length - 1 ? 'bg-red-50' : 'bg-gray-50'
                      )}
                    >
                      <span className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white',
                        i === 0 ? 'bg-green-500' : i === waypoints.length - 1 ? 'bg-red-500' : 'bg-blue-500'
                      )}>
                        {i + 1}
                      </span>
                      <div>
                        <p className="font-medium text-gray-700">
                          {i === 0 ? t('routes.waypointStart') : i === waypoints.length - 1 ? t('routes.waypointEnd') : t('routes.waypointPoint', { n: i + 1 })}
                        </p>
                        <p className="text-gray-400">{pt[0].toFixed(4)}, {pt[1].toFixed(4)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Save button */}
              <div className="mt-4 border-t border-gray-100 pt-4 space-y-2">
                {waypoints.length < 2 && waypoints.length > 0 && (
                  <p className="text-xs text-amber-600 text-center">
                    {t('routes.minPoints')}
                  </p>
                )}
                <Button
                  type="submit"
                  form="route-form"
                  className="w-full"
                  loading={createMutation.isPending}
                  disabled={waypoints.length < 2}
                  leftIcon={<Plus className="h-4 w-4" />}
                >
                  {t('routes.saveRoute')}
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  className="w-full"
                  onClick={() => { setShowCreate(false); setWaypoints([]); reset() }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
