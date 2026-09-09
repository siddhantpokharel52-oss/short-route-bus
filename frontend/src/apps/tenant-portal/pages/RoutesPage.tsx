/**
 * RoutesPage — draw a route on the map by clicking waypoints, then name & save it.
 */
import { useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, MapPin, Ruler, Trash2, Undo2, Map as MapIcon, CheckCircle, Clock, Eye, Pencil } from 'lucide-react'
import Map, { Marker, Popup, Source, Layer, useMap } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BAATO_STYLE_URL } from '@/config/baato'
import { getDirections, BaatoPlace, BaatoDirectionsResult } from '@services/baatoService'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { NepaliInput } from '@components/shared/NepaliInput'
import { PlaceSearchInput } from '@components/shared/PlaceSearchInput'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { usePagination } from '@hooks/usePagination'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import { cn } from '@utils/cn'
import { suggestNepaliName } from '@utils/nepaliKeyboard'
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

// Perpendicular distance from a point to a segment, in the same rough units
// as haversine (km) -- good enough to compare segments against each other,
// not meant to be geodesically exact.
function pointToSegmentDistance(
  p: [number, number], a: [number, number], b: [number, number]
): number {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return haversine(p, a)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const proj: [number, number] = [ax + t * dx, ay + t * dy]
  return haversine(p, proj)
}

// A raw map click doesn't say where in the route it belongs -- find the
// existing segment it lands closest to and insert it there instead of
// always tacking it onto the end, so editing the middle of a long route
// doesn't quietly append past the real last stop.
function insertionIndexFor(point: [number, number], pts: [number, number][]): number {
  if (pts.length < 2) return pts.length
  let bestIdx = pts.length
  let bestDist = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const dist = pointToSegmentDistance(point, pts[i], pts[i + 1])
    if (dist < bestDist) {
      bestDist = dist
      bestIdx = i + 1
    }
  }
  return bestIdx
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

// Flies the map to a freshly-picked Route Start/End place.
function MapFlyTo({ target }: { target: [number, number] | null }) {
  const { current: map } = useMap()
  useEffect(() => {
    if (map && target) {
      map.flyTo({ center: [target[1], target[0]], zoom: 14, duration: 1200 })
    }
  }, [map, target])
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
  route_stops: { id: string; sequence_no: number; stop_detail: { name_en: string; latitude: string; longitude: string } }[]
}

// Parse a route's stored GeoJSON LineString back into [lat, lng][] waypoints
// (the stored coordinate order is [lng, lat] per GeoJSON spec).
function parseRouteGeoJSON(geojson: string): [number, number][] {
  if (!geojson) return []
  try {
    const parsed = JSON.parse(geojson)
    const coords: [number, number][] = parsed?.geometry?.coordinates ?? []
    return coords.map(([lng, lat]) => [lat, lng])
  } catch {
    return []
  }
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

  // Route Start / Route End (Baato search) -- drive the map fly-to and the
  // auto-suggested Directions path; manual waypoint editing still layers on
  // top of whatever this produces.
  const [routeStart, setRouteStart] = useState<BaatoPlace | null>(null)
  const [routeEnd, setRouteEnd] = useState<BaatoPlace | null>(null)
  const [nameEdited, setNameEdited] = useState(false)
  const [nameNeEdited, setNameNeEdited] = useState(false)
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null)
  const [directionsLoading, setDirectionsLoading] = useState(false)
  const [routeOptions, setRouteOptions] = useState<BaatoDirectionsResult[]>([])
  const [selectedOptionIdx, setSelectedOptionIdx] = useState(0)

  const resetRouteDraft = () => {
    setWaypoints([])
    setRouteStart(null)
    setRouteEnd(null)
    setNameEdited(false)
    setNameNeEdited(false)
    setFlyTarget(null)
    setRouteOptions([])
    setSelectedOptionIdx(0)
  }

  const [viewTarget, setViewTarget] = useState<Route | null>(null)
  const [editTarget, setEditTarget] = useState<Route | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Route | null>(null)
  const [editCode, setEditCode] = useState('')
  const [editNameEn, setEditNameEn] = useState('')
  const [editNameNe, setEditNameNe] = useState('')
  const [editWaypoints, setEditWaypoints] = useState<[number, number][]>([])
  const [editOpenWaypointIdx, setEditOpenWaypointIdx] = useState<number | null>(null)

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

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<RouteForm>()
  const nameEnField = register('name_en', { required: t('routes.required') })
  const nameNeField = register('name_ne')

  // Auto-compose name_en as "{start} — {end}" once both are set, but never
  // clobber a name the operator has already typed themselves. name_ne gets
  // a best-effort phonetic transliteration of the same composed name as a
  // starting suggestion -- there's no API that returns a place's actual
  // Nepali name (Baato's search is English-only, confirmed by testing
  // lang=ne, which changes nothing), so this is a guess the operator can
  // freely correct, never an authoritative value.
  useEffect(() => {
    if (!nameEdited && routeStart && routeEnd) {
      const composedEn = `${routeStart.name} — ${routeEnd.name}`
      setValue('name_en', composedEn)
      if (!nameNeEdited) setValue('name_ne', suggestNepaliName(composedEn))
    }
  }, [routeStart, routeEnd, nameEdited, nameNeEdited, setValue])

  // Once both Start and End are set, fetch every road-path alternative
  // Baato's router can find (not just the single shortest one) and pre-fill
  // the first as the waypoints. The operator can switch to another option
  // below, or still add/undo/clear points on top of it -- a bus's real path
  // often isn't the fastest driving route Directions would compute.
  useEffect(() => {
    if (!routeStart || !routeEnd) return
    let cancelled = false
    setDirectionsLoading(true)
    getDirections([routeStart.lat, routeStart.lon], [routeEnd.lat, routeEnd.lon])
      .then((results) => {
        if (cancelled) return
        if (results.length > 0) {
          setRouteOptions(results)
          setSelectedOptionIdx(0)
          setWaypoints(results[0].points)
        } else {
          setRouteOptions([])
          toast.error('Could not find a road route between those two points — draw the path manually on the map.')
        }
      })
      .finally(() => { if (!cancelled) setDirectionsLoading(false) })
    return () => { cancelled = true }
  }, [routeStart, routeEnd])

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
        // When both Start and End were picked via search, the backend creates
        // real Stops for them and locks them as this route's fixed first/last
        // stop -- every stop added afterwards inserts between them, so a fare
        // chart built from this route's stops runs all the way from the named
        // start to the named end, not just between the manually-added stops.
        ...(routeStart && routeEnd
          ? {
              route_start: { name_en: routeStart.name, latitude: routeStart.lat, longitude: routeStart.lon },
              route_end: { name_en: routeEnd.name, latitude: routeEnd.lat, longitude: routeEnd.lon },
            }
          : {}),
      })
    },
    onSuccess: () => {
      toast.success(t('routes.toasts.created'))
      setShowCreate(false)
      resetRouteDraft()
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

  useEffect(() => {
    if (!editTarget) return
    setEditCode(editTarget.route_code)
    setEditNameEn(editTarget.name_en)
    setEditNameNe(editTarget.name_ne ?? '')
    setEditWaypoints(parseRouteGeoJSON(editTarget.geojson_path))
    setEditOpenWaypointIdx(null)
  }, [editTarget])

  const handleEditMapClick = useCallback((lat: number, lng: number) => {
    setEditWaypoints((prev) => {
      const idx = insertionIndexFor([lat, lng], prev)
      const next = [...prev]
      next.splice(idx, 0, [lat, lng])
      return next
    })
    setEditOpenWaypointIdx(null)
  }, [])

  const handleEditWaypointDragEnd = useCallback((index: number, lat: number, lng: number) => {
    setEditWaypoints((prev) => prev.map((pt, i) => (i === index ? [lat, lng] : pt)))
  }, [])

  const editDistKm = totalDistance(editWaypoints).toFixed(2)
  const editPolylineGeoJSON = editWaypoints.length >= 2 ? {
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates: editWaypoints.map(([lat, lng]) => [lng, lat]) },
    properties: {},
  } : null
  const editMapCenter = editWaypoints.length > 0 ? editWaypoints[0] : KATHMANDU

  const updateRouteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/platform/routes/${id}/`, {
        route_code: editCode,
        name_en: editNameEn,
        name_ne: editNameNe,
        ...(editWaypoints.length >= 2
          ? {
              distance_km: parseFloat(totalDistance(editWaypoints).toFixed(2)),
              geojson_path: JSON.stringify({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: editWaypoints.map(([lat, lng]) => [lng, lat]) },
              }),
            }
          : {}),
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
    setWaypoints((prev) => {
      const idx = insertionIndexFor([lat, lng], prev)
      const next = [...prev]
      next.splice(idx, 0, [lat, lng])
      return next
    })
    setOpenWaypointIdx(null)
  }, [])

  const handleUndo = () => setWaypoints((prev) => prev.slice(0, -1))
  const handleClear = () => setWaypoints([])

  // Start/End stay fixed -- they're what Route Start/Route End actually
  // named this route's two locked bookable stops from; only the shape of
  // the path in between is ever draggable.
  const handleWaypointDragEnd = useCallback((index: number, lat: number, lng: number) => {
    setWaypoints((prev) => prev.map((pt, i) => (i === index ? [lat, lng] : pt)))
  }, [])

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
          {/* Approval is a Super Admin review gate, not something a tenant
              grants itself -- this is status-only, no action here. */}
          {r.status === 'APPROVED' ? (
            <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
              <CheckCircle className="h-3 w-3" />
              {t('routes.approved')}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
              <Clock className="h-3 w-3" />
              {t('routes.pendingApproval', { defaultValue: 'Pending Approval' })}
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

      {/* ── Edit Route Modal — map editor, same layout as Create ────────────── */}
      {editTarget && (
        <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={`${t('routes.editRoute')} — ${editTarget.route_code}`} size="screen">
          <div className="flex h-full">
            {/* Left sidebar */}
            <div className="flex w-96 shrink-0 flex-col overflow-y-auto border-r border-gray-100 bg-gray-50">
              <div className="space-y-4 border-b border-gray-100 p-5">
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
                <NepaliInput
                  label={t('routes.editNameNeLabel')}
                  value={editNameNe}
                  onChange={(e) => setEditNameNe(e.target.value)}
                  placeholder="e.g. रत्नपार्क — कलंकी"
                />
              </div>

              {/* Waypoints */}
              <div className="flex flex-1 flex-col p-5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-700">{t('routes.waypoints')}</p>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setEditWaypoints((prev) => prev.slice(0, -1))}
                      disabled={editWaypoints.length === 0}
                      title="Undo last point"
                      className={cn('rounded-lg p-1.5 text-gray-500 hover:bg-gray-100', editWaypoints.length === 0 && 'opacity-30 cursor-not-allowed')}
                    >
                      <Undo2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditWaypoints([])}
                      disabled={editWaypoints.length === 0}
                      title="Clear all"
                      className={cn('rounded-lg p-1.5 text-red-400 hover:bg-red-50', editWaypoints.length === 0 && 'opacity-30 cursor-not-allowed')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mb-3 rounded-lg bg-primary-50 p-3 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">{t('routes.points')}</span>
                    <span className="font-semibold text-primary-700">{editWaypoints.length}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">{t('routes.distanceLabel')}</span>
                    <span className="font-semibold text-primary-700">{editDistKm} {t('routes.distanceUnit')}</span>
                  </div>
                </div>

                {editTarget.route_stops?.length > 0 && (
                  <div className="mb-3 rounded-lg bg-blue-50 p-3">
                    <p className="mb-2 text-xs font-semibold text-blue-600">{t('routes.stopsOnRoute')}</p>
                    <div className="max-h-32 space-y-1 overflow-y-auto">
                      {editTarget.route_stops.map((rs) => (
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

                <div className="max-h-64 flex-1 overflow-y-auto space-y-1 text-xs">
                  {editWaypoints.length === 0 ? (
                    <p className="text-center text-gray-400 mt-6 italic text-xs">{t('routes.clickToStart')}</p>
                  ) : (
                    editWaypoints.map((pt, i) => (
                      <div
                        key={i}
                        className={cn(
                          'flex items-center gap-2 rounded-lg px-2.5 py-1.5',
                          i === 0 ? 'bg-green-50' : i === editWaypoints.length - 1 ? 'bg-red-50' : 'bg-gray-50'
                        )}
                      >
                        <span className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white',
                          i === 0 ? 'bg-green-500' : i === editWaypoints.length - 1 ? 'bg-red-500' : 'bg-blue-500'
                        )}>
                          {i + 1}
                        </span>
                        <p className="text-gray-400">{pt[0].toFixed(4)}, {pt[1].toFixed(4)}</p>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-4 border-t border-gray-100 pt-4 space-y-2">
                  <Button
                    className="w-full"
                    loading={updateRouteMutation.isPending}
                    disabled={!editCode.trim() || !editNameEn.trim()}
                    onClick={() => updateRouteMutation.mutate(editTarget.id)}
                  >
                    {t('routes.saveChanges')}
                  </Button>
                  <Button variant="secondary" className="w-full" onClick={() => setEditTarget(null)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            </div>

            {/* Map */}
            <div className="relative flex-1 h-full">
              <Map
                initialViewState={{ latitude: editMapCenter[0], longitude: editMapCenter[1], zoom: editWaypoints.length > 0 ? 13 : 12 }}
                style={{ height: '100%', width: '100%' }}
                mapStyle={BAATO_STYLE_URL}
                cursor="crosshair"
                onClick={(e) => { setEditOpenWaypointIdx(null); handleEditMapClick(e.lngLat.lat, e.lngLat.lng) }}
              >
                <MapResizeHandler />

                {editPolylineGeoJSON && (
                  <Source id="edit-waypoint-route" type="geojson" data={editPolylineGeoJSON}>
                    <Layer
                      id="edit-waypoint-route-line"
                      type="line"
                      paint={{ 'line-color': '#2563eb', 'line-width': 4, 'line-opacity': 0.85 }}
                      layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                    />
                  </Source>
                )}

                {editWaypoints.map((pt, i) => {
                  const isLocked = i === 0 || i === editWaypoints.length - 1
                  const color = i === 0 ? '#22c55e' : i === editWaypoints.length - 1 ? '#ef4444' : '#2563eb'
                  return (
                    <Marker
                      key={i}
                      latitude={pt[0]}
                      longitude={pt[1]}
                      anchor="center"
                      draggable={!isLocked}
                      onDragEnd={(e) => handleEditWaypointDragEnd(i, e.lngLat.lat, e.lngLat.lng)}
                    >
                      <div
                        onClick={(e) => { e.stopPropagation(); setEditOpenWaypointIdx(i) }}
                        title={isLocked ? 'Fixed (Route Start/End)' : 'Drag to move'}
                        style={{
                          background: color, color: '#fff', borderRadius: '50%',
                          width: 26, height: 26, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', fontSize: 11, fontWeight: 700,
                          boxShadow: '0 2px 6px rgba(0,0,0,.3)', border: '2px solid #fff',
                          cursor: isLocked ? 'pointer' : 'grab',
                        }}
                      >
                        {i + 1}
                      </div>
                    </Marker>
                  )
                })}

                {/* Bus stops already on this route -- plotted for reference,
                    distinct purple pins so they read apart from the path's
                    own waypoint markers. */}
                {editTarget.route_stops?.map((rs) => (
                  <Marker
                    key={rs.id}
                    latitude={Number(rs.stop_detail.latitude)}
                    longitude={Number(rs.stop_detail.longitude)}
                    anchor="bottom"
                  >
                    <div title={rs.stop_detail.name_en} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
                      <div style={{
                        background: '#7c3aed', color: '#fff', borderRadius: '9999px 9999px 9999px 0',
                        width: 20, height: 20, transform: 'rotate(45deg)',
                        boxShadow: '0 2px 4px rgba(0,0,0,.35)', border: '2px solid #fff',
                      }} />
                    </div>
                  </Marker>
                ))}

                {editOpenWaypointIdx !== null && editWaypoints[editOpenWaypointIdx] && (
                  <Popup
                    latitude={editWaypoints[editOpenWaypointIdx][0]}
                    longitude={editWaypoints[editOpenWaypointIdx][1]}
                    onClose={() => setEditOpenWaypointIdx(null)}
                    closeButton
                  >
                    <div className="text-xs p-1">
                      <p className="font-semibold">Point {editOpenWaypointIdx + 1}</p>
                      <p className="text-gray-500">
                        {editWaypoints[editOpenWaypointIdx][0].toFixed(5)}, {editWaypoints[editOpenWaypointIdx][1].toFixed(5)}
                      </p>
                    </div>
                  </Popup>
                )}
              </Map>

              <div className="absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-xl bg-white/90 px-4 py-2 shadow text-sm font-medium text-gray-700 backdrop-blur-sm whitespace-nowrap pointer-events-none">
                <MapIcon className="inline h-4 w-4 mr-1.5 text-primary-500" />
                {t('routes.mapInstruction')}
              </div>
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
        onClose={() => { setShowCreate(false); resetRouteDraft(); reset() }}
        title={t('routes.addRoute')}
        size="screen"
      >
        <div className="flex h-full">
          {/* Left sidebar — all inputs, waypoints, and actions */}
          <div className="flex w-96 shrink-0 flex-col overflow-y-auto border-r border-gray-100 bg-gray-50">
            <form
              id="route-form"
              onSubmit={handleSubmit((d) => {
                if (!routeStart || !routeEnd) {
                  toast.error('Pick a Route Start and Route End before saving.')
                  return
                }
                createMutation.mutate(d)
              })}
              className="space-y-4 border-b border-gray-100 p-5"
            >
              <PlaceSearchInput
                label="Route Start *"
                placeholder="Search a starting place..."
                biasLat={KATHMANDU[0]}
                biasLon={KATHMANDU[1]}
                onSelect={(place) => { setRouteStart(place); setFlyTarget([place.lat, place.lon]) }}
              />
              <PlaceSearchInput
                label="Route End *"
                placeholder="Search an ending place..."
                biasLat={KATHMANDU[0]}
                biasLon={KATHMANDU[1]}
                onSelect={(place) => { setRouteEnd(place); setFlyTarget([place.lat, place.lon]) }}
              />
              {!routeStart || !routeEnd ? (
                <p className="-mt-2 text-xs text-amber-600">
                  Route Start and Route End are required — each becomes a real, bookable stop at the
                  two ends of this route, so every fare leg can run the full route rather than
                  stopping short of its actual start/end point.
                </p>
              ) : null}
              <Input
                label={`${t('routes.editCodeLabel')} *`}
                placeholder="e.g. 23, 37A"
                error={errors.route_code?.message}
                {...register('route_code', { required: t('routes.required') })}
              />
              <Input
                label={`${t('routes.editNameEnLabel')} *`}
                placeholder="e.g. Ratnapark — Kalanki"
                error={errors.name_en?.message}
                {...nameEnField}
                onChange={(e) => {
                  nameEnField.onChange(e)
                  setNameEdited(true)
                  if (!nameNeEdited) setValue('name_ne', suggestNepaliName(e.target.value))
                }}
              />
              <NepaliInput
                label={t('routes.editNameNeLabel')}
                placeholder="e.g. रत्नपार्क — कलंकी"
                {...nameNeField}
                onChange={(e) => { nameNeField.onChange(e); setNameNeEdited(true) }}
              />
            </form>

            {/* Suggested route alternatives -- Baato's router only returns
                driving paths, never a bus-aware one, so the operator picks
                whichever alternative actually matches a bus-usable road. */}
            {routeOptions.length > 1 && (
              <div className="border-b border-gray-100 p-5 space-y-2">
                <p className="text-sm font-semibold text-gray-700">Suggested Routes</p>
                <p className="text-xs text-gray-400 -mt-1">
                  Pick whichever option matches a real bus route — these are road-routing
                  suggestions, not verified bus paths.
                </p>
                {routeOptions.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setSelectedOptionIdx(i); setWaypoints(opt.points) }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                      i === selectedOptionIdx
                        ? 'border-primary-400 bg-primary-50 text-primary-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    )}
                  >
                    <span className="font-medium">Option {i + 1}</span>
                    <span>{opt.distanceKm.toFixed(2)} {t('routes.distanceUnit')}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Waypoints */}
            <div className="flex flex-1 flex-col p-5">
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
              <div className="max-h-64 flex-1 overflow-y-auto space-y-1 text-xs">
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
                  disabled={waypoints.length < 2 || !routeStart || !routeEnd}
                  leftIcon={<Plus className="h-4 w-4" />}
                >
                  {t('routes.saveRoute')}
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  className="w-full"
                  onClick={() => { setShowCreate(false); resetRouteDraft(); reset() }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          </div>

          {/* Map — takes all remaining space */}
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
              <MapFlyTo target={flyTarget} />

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

              {/* Waypoint markers -- every point but the first/last can be
                  dragged to reshape the path; Start/End stay put since
                  they're what the Route Start/Route End search actually
                  named this route's two locked stops from. */}
              {waypoints.map((pt, i) => {
                const isLocked = i === 0 || i === waypoints.length - 1
                const color = i === 0 ? '#22c55e' : i === waypoints.length - 1 ? '#ef4444' : '#2563eb'
                return (
                  <Marker
                    key={i}
                    latitude={pt[0]}
                    longitude={pt[1]}
                    anchor="center"
                    draggable={!isLocked}
                    onDragEnd={(e) => handleWaypointDragEnd(i, e.lngLat.lat, e.lngLat.lng)}
                  >
                    <div
                      onClick={(e) => { e.stopPropagation(); setOpenWaypointIdx(i) }}
                      title={isLocked ? 'Fixed (Route Start/End)' : 'Drag to move'}
                      style={{
                        background: color, color: '#fff', borderRadius: '50%',
                        width: 26, height: 26, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 11, fontWeight: 700,
                        boxShadow: '0 2px 6px rgba(0,0,0,.3)', border: '2px solid #fff',
                        cursor: isLocked ? 'pointer' : 'grab',
                      }}
                    >
                      {i + 1}
                    </div>
                  </Marker>
                )
              })}

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
              {directionsLoading ? 'Finding a suggested route…' : t('routes.mapInstruction')}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
