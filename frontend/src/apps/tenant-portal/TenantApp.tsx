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

// Role-based page guards
const ROLE_ACCESS: Record<string, string[]> = {
  '/tenant/fleet': ['COMPANY_ADMIN', 'COMPANY_MANAGER', 'DISPATCHER'],
  '/tenant/routes': ['COMPANY_ADMIN', 'COMPANY_MANAGER', 'DISPATCHER'],
  '/tenant/stops': ['COMPANY_ADMIN', 'COMPANY_MANAGER', 'DISPATCHER'],
  '/tenant/drivers': ['COMPANY_ADMIN', 'COMPANY_MANAGER', 'HR_OFFICER', 'DISPATCHER'],
  '/tenant/conductors': ['COMPANY_ADMIN', 'COMPANY_MANAGER', 'HR_OFFICER', 'DISPATCHER'],
  '/tenant/scheduling': ['COMPANY_ADMIN', 'COMPANY_MANAGER', 'DISPATCHER'],
  '/tenant/live-tracking': ['COMPANY_ADMIN', 'COMPANY_MANAGER', 'DISPATCHER'],
  '/tenant/operations': ['COMPANY_ADMIN', 'COMPANY_MANAGER', 'DISPATCHER'],
  '/tenant/dispatch': ['COMPANY_ADMIN', 'COMPANY_MANAGER', 'DISPATCHER'],
  '/tenant/ticketing': ['COMPANY_ADMIN', 'COMPANY_MANAGER', 'CONDUCTOR', 'FINANCE_OFFICER'],
  '/tenant/maintenance': ['COMPANY_ADMIN', 'MAINTENANCE_OFFICER'],
  '/tenant/analytics': ['COMPANY_ADMIN', 'COMPANY_MANAGER'],
  '/tenant/accounting': ['COMPANY_ADMIN', 'COMPANY_MANAGER', 'FINANCE_OFFICER'],
}

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
