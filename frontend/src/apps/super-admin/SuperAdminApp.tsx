import { Routes, Route, Navigate } from 'react-router-dom'
import SuperAdminLayout from './components/SuperAdminLayout'
import DashboardPage from './pages/DashboardPage'
import TenantsPage from './pages/TenantsPage'
import TenantDetailPage from './pages/TenantDetailPage'
import SmartCardsPage from './pages/SmartCardsPage'
import RoutesPage from './pages/RoutesPage'
import FaresPage from './pages/FaresPage'
import TicketTypesPage from './pages/TicketTypesPage'
import BillingPage from './pages/BillingPage'
import UsersPage from './pages/UsersPage'
import SettingsPage from './pages/SettingsPage'

export default function SuperAdminApp() {
  return (
    <SuperAdminLayout>
      <Routes>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="tenants" element={<TenantsPage />} />
        <Route path="tenants/:id" element={<TenantDetailPage />} />
        <Route path="smart-cards" element={<SmartCardsPage />} />
        <Route path="routes" element={<RoutesPage />} />
        <Route path="fares" element={<FaresPage />} />
        <Route path="ticket-types" element={<TicketTypesPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Routes>
    </SuperAdminLayout>
  )
}
