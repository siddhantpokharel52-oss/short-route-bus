/**
 * DriverRosterPage -- doc section 5.7/15: "drivers see only their own
 * group, never the whole chart" -- this group's next seven days, read-only.
 */
import { useQuery } from '@tanstack/react-query'
import { CalendarDays } from 'lucide-react'
import rosterService from '@services/rosterService'

export default function DriverRosterPage() {
  const { data: duties = [], isLoading } = useQuery({
    queryKey: ['my-duties'],
    queryFn: () => rosterService.myDuties(),
  })

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2"><CalendarDays className="h-6 w-6 text-primary-600" /> My Roster</h1>
          <p className="page-subtitle">Your group's next seven days</p>
        </div>
      </div>

      {isLoading ? (
        <div className="card flex items-center justify-center py-16 text-sm text-gray-400">Loading…</div>
      ) : duties.length === 0 ? (
        <div className="card py-16 text-center text-sm text-gray-400">
          No published duties for the next seven days -- check with your dispatcher if you expect one.
        </div>
      ) : (
        <div className="space-y-2">
          {duties.map((d) => (
            <div key={d.id} className="card flex items-center justify-between p-4">
              <div>
                <p className="font-semibold text-gray-800">{d.route_name}</p>
                <p className="text-xs text-gray-400">{d.route_code} · slot {d.slot_index}</p>
              </div>
              <p className="text-sm text-gray-500">
                {new Date(d.service_date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
