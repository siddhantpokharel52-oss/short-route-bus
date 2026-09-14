/**
 * NotificationBell — Super Admin's in-app inbox for things a tenant did
 * that need review: a new route, or a new stop added to an already-approved
 * route (see backend AdminNotification). Polls rather than a live socket --
 * "something needs review" isn't time-critical the way live vehicle
 * tracking is, and polling reuses the same pattern already used elsewhere
 * in this app instead of adding a second realtime channel.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Route as RouteIcon, MapPin, Check } from 'lucide-react'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { cn } from '@utils/cn'

interface AdminNotification {
  id: string
  event_type: 'ROUTE_SUBMITTED' | 'STOP_SUBMITTED'
  title: string
  message: string
  route: string | null
  route_code: string | null
  route_name: string | null
  route_stop: string | null
  tenant_name: string | null
  is_read: boolean
  created_at: string
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function NotificationBell() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const seenIds = useRef<Set<string> | null>(null)

  const { data } = useQuery({
    queryKey: ['admin-notifications'],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/notifications/')
      return data.data as { results: AdminNotification[]; unread_count: number }
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

  const notifications = data?.results ?? []
  const unreadCount = data?.unread_count ?? 0

  // Toast the ones that showed up since the last successful poll -- skipped
  // on the very first load (that would toast the whole backlog at once).
  useEffect(() => {
    if (!data) return
    if (seenIds.current === null) {
      seenIds.current = new Set(notifications.map((n) => n.id))
      return
    }
    const fresh = notifications.filter((n) => !seenIds.current!.has(n.id))
    fresh.forEach((n) => {
      toast(n.title, { icon: n.event_type === 'ROUTE_SUBMITTED' ? '🛣️' : '📍' })
    })
    seenIds.current = new Set(notifications.map((n) => n.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const markRead = async (id: string) => {
    await apiClient.post(`/platform/notifications/${id}/mark-read/`)
    qc.invalidateQueries({ queryKey: ['admin-notifications'] })
  }

  const markAllRead = async () => {
    await apiClient.post('/platform/notifications/mark-all-read/')
    qc.invalidateQueries({ queryKey: ['admin-notifications'] })
  }

  const handleClickNotification = (n: AdminNotification) => {
    if (!n.is_read) markRead(n.id)
    setOpen(false)
    if (n.route) navigate('/super-admin/routes')
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-96 rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Notifications</p>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline"
              >
                <Check className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400">
                Nothing needs your attention right now.
              </p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClickNotification(n)}
                  className={cn(
                    'flex w-full items-start gap-3 border-b border-gray-50 px-4 py-3 text-left last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800',
                    !n.is_read && 'bg-primary-50/50 dark:bg-primary-900/10'
                  )}
                >
                  <div className={cn(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                    n.event_type === 'ROUTE_SUBMITTED' ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600'
                  )}>
                    {n.event_type === 'ROUTE_SUBMITTED'
                      ? <RouteIcon className="h-4 w-4" />
                      : <MapPin className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm text-gray-800 dark:text-gray-200', !n.is_read && 'font-semibold')}>
                      {n.title}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{n.message}</p>
                    <p className="mt-1 text-[11px] text-gray-400">{timeAgo(n.created_at)}</p>
                  </div>
                  {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-500" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
