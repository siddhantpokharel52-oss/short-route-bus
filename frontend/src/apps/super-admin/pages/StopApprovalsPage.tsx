/**
 * StopApprovalsPage (super-admin) — every stop across every route still
 * awaiting its own review (see backend RouteStop.status), in one place.
 * The Routes page still surfaces a quick "N pending" badge per route for
 * in-context access, but reviewing them one route at a time via that badge
 * doesn't give a platform-wide view of what's actually waiting -- this page
 * is that view, with per-stop Approve/Reject and a per-route "Approve all".
 */
import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, XCircle, MapPin, Sparkles } from 'lucide-react'
import { Button } from '@components/shared/Button'
import apiClient from '@services/api'
import toast from 'react-hot-toast'

interface RouteStopRow {
  id: string
  sequence_no: number
  status: 'PENDING_APPROVAL' | 'APPROVED'
  stop_detail: { name_en: string; name_ne: string }
}

interface RouteOperator {
  tenant_id: string
  tenant_name: string
}

interface RouteRow {
  id: string
  route_code: string
  name_en: string
  route_stops: RouteStopRow[]
  operators: RouteOperator[]
}

export default function StopApprovalsPage() {
  const qc = useQueryClient()

  const { data: routes, isLoading } = useQuery({
    queryKey: ['routes-oversight-all'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/routes/', { params: { page_size: 200 } })
      return (Array.isArray(data.data) ? data.data : []) as RouteRow[]
    },
  })

  const routesWithPending = useMemo(
    () =>
      (routes ?? [])
        .map((r) => ({ ...r, pending: r.route_stops.filter((rs) => rs.status === 'PENDING_APPROVAL') }))
        .filter((r) => r.pending.length > 0),
    [routes]
  )

  const totalPending = useMemo(
    () => routesWithPending.reduce((sum, r) => sum + r.pending.length, 0),
    [routesWithPending]
  )

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['routes-oversight-all'] })
    qc.invalidateQueries({ queryKey: ['routes-oversight'] })
    qc.invalidateQueries({ queryKey: ['admin-notifications'] })
  }

  const approveMutation = useMutation({
    mutationFn: ({ routeId, routeStopId }: { routeId: string; routeStopId: string }) =>
      apiClient.post(`/platform/routes/${routeId}/approve-stop/`, { route_stop_id: routeStopId }),
    onSuccess: () => { toast.success('Stop approved.'); invalidate() },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to approve stop.')
    },
  })

  const rejectMutation = useMutation({
    mutationFn: ({ routeId, routeStopId }: { routeId: string; routeStopId: string }) =>
      apiClient.post(`/platform/routes/${routeId}/reject-stop/`, { route_stop_id: routeStopId }),
    onSuccess: () => { toast.success('Stop rejected.'); invalidate() },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to reject stop.')
    },
  })

  const approveAllMutation = useMutation({
    mutationFn: (routeId: string) => apiClient.post(`/platform/routes/${routeId}/approve-all-stops/`),
    onSuccess: (res) => { toast.success(res.data?.message || 'All pending stops approved.'); invalidate() },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to approve all stops.')
    },
  })

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Stop Approvals</h1>
          <p className="page-subtitle">
            {totalPending > 0
              ? `${totalPending} stop(s) across ${routesWithPending.length} route(s) awaiting review`
              : 'Stops tenants added to already-approved routes, awaiting review'}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="card flex items-center justify-center py-16 text-sm text-gray-400">Loading…</div>
      ) : routesWithPending.length === 0 ? (
        <div className="card py-16 text-center">
          <CheckCircle className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">All caught up — nothing pending.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {routesWithPending.map((route) => (
            <div key={route.id} className="card overflow-hidden p-0">
              <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800/50">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-900/30 dark:text-blue-300">
                    {route.route_code}
                  </span>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{route.name_en}</span>
                  {route.operators[0] && (
                    <span className="text-xs text-gray-400">· {route.operators[0].tenant_name}</span>
                  )}
                </div>
                {route.pending.length > 1 && (
                  <Button
                    size="sm"
                    variant="outline"
                    leftIcon={<CheckCircle className="h-3.5 w-3.5" />}
                    loading={approveAllMutation.isPending}
                    onClick={() => approveAllMutation.mutate(route.id)}
                  >
                    Approve all ({route.pending.length})
                  </Button>
                )}
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {route.pending.map((rs) => (
                  <div key={rs.id} className="flex items-center gap-3 px-4 py-2.5">
                    <MapPin className="h-4 w-4 shrink-0 text-amber-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                        {rs.stop_detail.name_en}
                        {rs.stop_detail.name_ne && (
                          <span className="ml-1.5 font-normal text-gray-400">{rs.stop_detail.name_ne}</span>
                        )}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-amber-600">
                        <Sparkles className="h-3 w-3" /> Awaiting approval
                      </p>
                    </div>
                    <Button
                      size="sm"
                      leftIcon={<CheckCircle className="h-3.5 w-3.5" />}
                      loading={approveMutation.isPending}
                      onClick={() => approveMutation.mutate({ routeId: route.id, routeStopId: rs.id })}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      leftIcon={<XCircle className="h-3.5 w-3.5" />}
                      loading={rejectMutation.isPending}
                      onClick={() => rejectMutation.mutate({ routeId: route.id, routeStopId: rs.id })}
                    >
                      Reject
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
