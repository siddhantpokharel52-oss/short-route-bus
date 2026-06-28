import { ReactNode, useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Bus, Users, Ticket,
  Wrench, UserCheck, BarChart3, Settings, Menu, X,
  Bell, LogOut, Route, MapPin, BookOpen,
  Zap, Activity, ShieldCheck,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@store/authStore'
import { useUiStore } from '@store/uiStore'
import { LanguageToggle } from '@components/shared/LanguageToggle'
import { KeyboardToggle } from '@components/shared/KeyboardToggle'
import { CalendarToggle } from '@components/shared/DateDisplay'
import { cn } from '@utils/cn'
import authService from '@services/authService'
import apiClient from '@services/api'
import toast from 'react-hot-toast'

// Extract a browser-accessible path from DRF's absolute logo URL
function getMediaPath(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).pathname   // "http://django:8000/media/..." → "/media/..."
  } catch {
    return url.startsWith('/') ? url : `/${url}`  // ensure leading slash for Vite proxy
  }
}

interface TenantLayoutProps {
  children: ReactNode
}

export default function TenantLayout({ children }: TenantLayoutProps) {
  const { user, logout: storeLogout, refreshToken } = useAuthStore()
  const { sidebarOpen, toggleSidebar, theme } = useUiStore()
  const { t } = useTranslation('tenant')
  const navigate = useNavigate()
  const [logoError, setLogoError] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type NavItem = { to: string; icon: any; label: string }
  const navItems: NavItem[] = [
    { to: '/tenant/live-tracking', icon: LayoutDashboard, label: t('nav.dashboard') },
    { to: '/tenant/operations', icon: Activity, label: t('nav.todaysTrips') },
    { to: '/tenant/dispatch', icon: Zap, label: t('nav.scheduler') },
    { to: '/tenant/routes', icon: Route, label: t('nav.routes') },
    { to: '/tenant/stops', icon: MapPin, label: t('nav.busStops') },
    { to: '/tenant/fleet', icon: Bus, label: t('nav.fleetManagement') },
    { to: '/tenant/drivers', icon: UserCheck, label: t('nav.drivers') },
    { to: '/tenant/conductors', icon: Users, label: t('nav.collectors') },
    { to: '/tenant/ticketing', icon: Ticket, label: t('nav.ticketing') },
    { to: '/tenant/maintenance', icon: Wrench, label: t('nav.maintenance') },
    { to: '/tenant/analytics', icon: BarChart3, label: t('nav.analytics') },
    { to: '/tenant/accounting', icon: BookOpen, label: t('nav.accounting') },
    { to: '/tenant/roles', icon: ShieldCheck, label: t('nav.rolesPermissions') },
    { to: '/tenant/settings', icon: Settings, label: t('nav.settings') },
  ]

  // Company info — same query key as Settings page so it's served from cache
  const { data: companyInfo } = useQuery({
    queryKey: ['company-info'],
    queryFn: async () => {
      const { data } = await apiClient.get('/operator/company/')
      return data.data
    },
    staleTime: 5 * 60 * 1000,
  })
  const logoSrc = getMediaPath(companyInfo?.logo)
  useEffect(() => { setLogoError(false) }, [logoSrc])
  const showLogo = logoSrc && !logoError

  const handleLogout = async () => {
    try {
      if (refreshToken) await authService.logout(refreshToken)
    } catch {}
    storeLogout()
    navigate('/login')
    toast.success('Logged out successfully')
  }

  return (
    <div className={cn('flex min-h-screen', theme === 'dark' ? 'dark' : '')}>
      {/* Sidebar */}
      <aside
        className={cn(
          'sidebar z-40 transition-transform duration-200',
          !sidebarOpen && '-translate-x-full'
        )}
      >
        {/* Logo / company name */}
        <div className="flex h-[var(--header-height)] items-center gap-3 border-b border-gray-200 px-4 dark:border-gray-700">
          {/* Show uploaded logo; fall back to blue Bus icon */}
          {showLogo ? (
            <img
              src={logoSrc}
              alt="Company logo"
              className="h-9 w-9 rounded-xl object-contain bg-white border border-gray-200 p-0.5"
              onError={() => setLogoError(true)}
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-600 text-white flex-shrink-0">
              <Bus className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-gray-900 dark:text-white">
              {companyInfo?.company_name
                ?? user?.tenantSchema?.replace(/_/g, ' ').toUpperCase()
                ?? 'Operator'}
            </p>
            <p className="text-xs text-gray-400">{user?.role?.replace(/_/g, ' ')}</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 p-3 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium',
                  'transition-colors duration-150',
                  isActive
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                )
              }
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* User info */}
        <div className="border-t border-gray-200 p-4 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xs font-bold dark:bg-primary-900 dark:text-primary-300">
              {user?.fullName.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs font-medium text-gray-900 dark:text-white">
                {user?.fullName}
              </p>
              <p className="truncate text-xs text-gray-400">{user?.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className={cn('flex-1 flex flex-col', sidebarOpen && 'lg:ml-[var(--sidebar-width)]')}>
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-[var(--header-height)] items-center gap-4 border-b border-gray-200 bg-white/80 px-4 backdrop-blur-sm dark:border-gray-700 dark:bg-gray-900/80">
          <button
            onClick={toggleSidebar}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="flex-1" />
          <CalendarToggle />
          <KeyboardToggle />
          <LanguageToggle />
          <button className="relative rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <Bell className="h-5 w-5" />
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={toggleSidebar} />
      )}
    </div>
  )
}
