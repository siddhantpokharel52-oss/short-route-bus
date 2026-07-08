import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore, isPlatformRole, isTenantRole } from '@store/authStore'
import { Suspense, lazy, Component, useEffect, type ReactNode, type ErrorInfo } from 'react'
import { useGlobalNepaliKeyboard } from '@hooks/useGlobalNepaliKeyboard'
import { getPortalContext, getMainLoginUrl, getTenantLoginUrl } from '@utils/portalContext'

// Lazy-load portals
const SuperAdminApp = lazy(() => import('@apps/super-admin/SuperAdminApp'))
const TenantApp = lazy(() => import('@apps/tenant-portal/TenantApp'))
const PublicApp = lazy(() => import('@apps/public/PublicApp'))
const LoginPage = lazy(() => import('./pages/LoginPage'))

// ─── Error Boundary ────────────────────────────────────────────────────────
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[KVBMS ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: 'monospace', background: '#fff1f2', minHeight: '100vh' }}>
          <h1 style={{ color: '#b91c1c', fontSize: 24, marginBottom: 16 }}>
            ⚠️ Application Error
          </h1>
          <pre style={{ background: '#fee2e2', padding: 16, borderRadius: 8, overflow: 'auto', fontSize: 13 }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            Try Again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── Loading Fallback ──────────────────────────────────────────────────────
function LoadingFallback() {
  return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 40, height: 40, border: '4px solid #bfdbfe', borderTopColor: '#2563eb',
          borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px'
        }} />
        <p style={{ color: '#6b7280', fontSize: 14 }}>Loading KVBMS...</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ─── Unauthorized Page ─────────────────────────────────────────────────────
function UnauthorizedPage() {
  const { logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLoginAgain = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold text-red-600">403</h1>
      <p className="text-lg text-gray-600">Access Denied</p>
      <p className="text-sm text-gray-400">Your session may have expired or you don't have permission.</p>
      <div className="flex gap-3 mt-2">
        <button
          onClick={handleLoginAgain}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Login Again
        </button>
        <a href="/" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
          Go Home
        </a>
      </div>
    </div>
  )
}

// ─── Portal Context Guard ──────────────────────────────────────────────────
// Ensures authenticated users are always on the domain that matches their role.
// An authenticated platform user on a tenant subdomain gets sent to the main
// domain, and an authenticated tenant user on the main domain gets sent to
// their company subdomain.
function PortalContextGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuthStore()
  const { isTenantPortal } = getPortalContext()

  useEffect(() => {
    if (!isAuthenticated || !user) return

    if (isTenantPortal && isPlatformRole(user.role)) {
      window.location.replace(getMainLoginUrl())
    } else if (!isTenantPortal && isTenantRole(user.role) && user.tenantSchema) {
      window.location.replace(
        getTenantLoginUrl(user.tenantSchema).replace('/login', '/tenant/live-tracking')
      )
    }
  }, [isAuthenticated, user, isTenantPortal])

  return <>{children}</>
}

// ─── Protected Route ───────────────────────────────────────────────────────
function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactNode
  allowedRoles?: string[]
}) {
  const { isAuthenticated, user } = useAuthStore()

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // Role mismatch — likely stale localStorage (e.g. PASSENGER from old session).
    // Send back to /login; LoginPage will detect and clear the invalid state on mount.
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

export default function App() {
  useGlobalNepaliKeyboard()

  return (
    <ErrorBoundary>
    <Suspense fallback={<LoadingFallback />}>
    <PortalContextGuard>
      <Routes>
        {/* Public portal — no auth */}
        <Route path="/*" element={<PublicApp />} />

        {/* Auth */}
        <Route path="/login" element={<LoginPage />} />

        {/* Super Admin portal */}
        <Route
          path="/super-admin/*"
          element={
            <ProtectedRoute
              allowedRoles={['SUPER_ADMIN', 'TRANSPORT_AUTHORITY', 'PLATFORM_ANALYST']}
            >
              <SuperAdminApp />
            </ProtectedRoute>
          }
        />

        {/* Tenant (operator) ERP portal */}
        <Route
          path="/tenant/*"
          element={
            <ProtectedRoute
              allowedRoles={[
                'COMPANY_ADMIN', 'COMPANY_MANAGER', 'DISPATCHER',
                'DRIVER', 'CONDUCTOR', 'FINANCE_OFFICER',
                'HR_OFFICER', 'MAINTENANCE_OFFICER', 'INVENTORY_OFFICER',
              ]}
            >
              <TenantApp />
            </ProtectedRoute>
          }
        />

        {/* Fallback */}
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
      </Routes>
    </PortalContextGuard>
    </Suspense>
    </ErrorBoundary>
  )
}
