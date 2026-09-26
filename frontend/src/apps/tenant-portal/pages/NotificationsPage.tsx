import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import apiClient from '@services/api'

interface NotificationPref {
  event_type: string
  is_active: boolean
}

// Maps each backend event_type to the i18n key that already existed for it
// (settings.notificationItems.*) -- same five categories the old, unwired
// UI showed, now backed by a real per-user row instead of a local-only
// defaultChecked box.
const EVENT_TYPE_LABEL_KEYS: Record<string, string> = {
  DOCUMENT_EXPIRY: 'settings.notificationItems.documentExpiry',
  LOW_STOCK: 'settings.notificationItems.lowStock',
  TRIP_CANCELLATION: 'settings.notificationItems.tripCancellation',
  MAINTENANCE_REMINDER: 'settings.notificationItems.maintenanceReminders',
  REVENUE_REPORT: 'settings.notificationItems.revenueReports',
}

/** "Notification" in the Profile menu -- the old TenantSettingsPage.tsx
 * card here was five checkboxes with defaultChecked and no save logic at
 * all. NotificationSubscription already existed as a model with no
 * endpoint; wired up (backend/apps/notifications/views.py,
 * MyNotificationSubscriptionViewSet) so this page is now genuinely real:
 * toggling a switch persists it, and reloading the page shows the saved
 * state, not just a default. */
export default function NotificationsPage() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()

  const { data: prefs = [], isLoading } = useQuery({
    queryKey: ['my-notification-prefs'],
    queryFn: async () => {
      const { data } = await apiClient.get('/notifications/my-subscriptions/defaults/')
      return data.data as NotificationPref[]
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ event_type, is_active }: NotificationPref) =>
      apiClient.post('/notifications/my-subscriptions/set/', { event_type, is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-notification-prefs'] }),
  })

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">{t('profile.notifications', { defaultValue: 'Notification' })}</h1>
      </div>

      <div className="card max-w-md">
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <Bell className="h-5 w-5 text-primary-600" />
          {t('settings.notifications')}
        </h2>
        {isLoading && <p className="text-sm text-gray-400">…</p>}
        {prefs.map((pref) => (
          <label key={pref.event_type} className="flex items-center justify-between border-b py-2 last:border-0">
            <span className="text-sm text-gray-700">
              {t(EVENT_TYPE_LABEL_KEYS[pref.event_type] ?? pref.event_type)}
            </span>
            <input
              type="checkbox"
              checked={pref.is_active}
              onChange={(e) => toggleMutation.mutate({ event_type: pref.event_type, is_active: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-primary-600"
            />
          </label>
        ))}
      </div>
    </div>
  )
}
