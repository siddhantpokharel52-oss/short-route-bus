import { Routes, Route, Navigate } from 'react-router-dom'
import TenantLayout from './components/TenantLayout'
import FleetPage from './pages/FleetPage'
import DriversPage from './pages/DriversPage'
import ConductorsPage from './pages/ConductorsPage'
import SchedulingPage from './pages/SchedulingPage'
import TicketingPage from './pages/TicketingPage'
import MaintenancePage from './pages/MaintenancePage'
import TenantAnalyticsPage from './pages/TenantAnalyticsPage'
import TenantSettingsPage from './pages/TenantSettingsPage'
import RoutesPage from './pages/RoutesPage'
import StopsPage from './pages/StopsPage'
import AccountingPage from './pages/AccountingPage'
// ── New operations modules ────────────────────────────────────────────────────
import LiveTrackingPage from './pages/LiveTrackingPage'
import DispatchPage from './pages/DispatchPage'
import OperationsDashboardPage from './pages/OperationsDashboardPage'
import RolesPermissionsPage from './pages/RolesPermissionsPage'


export default function TenantApp() {
  return (
    <TenantLayout>
      <Routes>
        <Route index element={<Navigate to="live-tracking" replace />} />

        {/* Fleet & Staff */}
        <Route path="fleet" element={<FleetPage />} />
        <Route path="drivers" element={<DriversPage />} />
        <Route path="conductors" element={<ConductorsPage />} />

        {/* Routes & Stops */}
        <Route path="routes" element={<RoutesPage />} />
        <Route path="stops" element={<StopsPage />} />

        {/* ── New: Fleet & Dispatch Operations ─────────────────────────── */}
        <Route path="live-tracking" element={<LiveTrackingPage />} />
        <Route path="dispatch" element={<DispatchPage />} />
        <Route path="operations" element={<OperationsDashboardPage />} />

        {/* Scheduling */}
        <Route path="scheduling" element={<SchedulingPage />} />

        {/* Other modules */}
        <Route path="ticketing" element={<TicketingPage />} />
        <Route path="maintenance" element={<MaintenancePage />} />
        <Route path="analytics" element={<TenantAnalyticsPage />} />
        <Route path="accounting" element={<AccountingPage />} />
        <Route path="settings" element={<TenantSettingsPage />} />
        <Route path="roles" element={<RolesPermissionsPage />} />
      </Routes>
    </TenantLayout>
  )
}
