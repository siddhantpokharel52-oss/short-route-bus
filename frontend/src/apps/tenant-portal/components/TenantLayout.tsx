import { Fragment, ReactNode, useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Menu as DropdownMenu, Transition } from '@headlessui/react'
import {
  LayoutDashboard, Bus, Users, Ticket,
  Wrench, UserCheck, BarChart3, Menu, X,
  Bell, LogOut, Route, MapPin, BookOpen,
  Zap, Activity, ShieldCheck, Wallet, Wallet2, Layers, Users2, CalendarRange, CalendarDays, CreditCard,
  UserCog, KeyRound, SlidersHorizontal, BellRing, Bug, ChevronsUpDown,
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
  // Either a standalone link or a labeled group of links. Groups exist
  // purely for visual organization of the general-staff nav below (19 flat
  // items was too much to scan) -- they carry no access-control meaning,
  // same as the rest of this array; backend permission_classes are what
  // actually gate page-level data.
  type NavEntry = NavItem | { section: string; items: NavItem[] }

  // Owner Dashboard (Team Implementation Guide §3.7): an owner sees "their
  // earnings, their trends, nothing else" -- so unlike every other role,
  // OWNER gets a dedicated one-item nav rather than flowing through the
  // general admin/ops array below (which is otherwise shown unfiltered to
  // every tenant role -- backend permission_classes are what actually gate
  // page-level data access, this array is nav-visibility only).
  const navItems: NavEntry[] = user?.role === 'OWNER'
    ? [{ to: '/tenant/my-earnings', icon: Wallet, label: t('nav.myEarnings', { defaultValue: 'My Earnings' }) }]
    : user?.role === 'CONDUCTOR'
    ? [
        // A conductor's whole job: see where buses are, sell/verify tickets.
        // Same reasoning as the OWNER cutout above -- the general admin/ops
        // array below shows everything to everyone, which is clutter (not a
        // security issue on its own, since every one of those pages is still
        // backend-gated to roles that exclude CONDUCTOR) but not the right
        // nav for this role.
        { to: '/tenant/live-tracking', icon: LayoutDashboard, label: t('nav.dashboard') },
        { to: '/tenant/ticketing', icon: Ticket, label: t('nav.ticketing') },
      ]
    : [
        // Pinned, ungrouped -- this is the landing page, not a peer of the
        // items inside Operations.
        { to: '/tenant/live-tracking', icon: LayoutDashboard, label: t('nav.dashboard') },

        // Owners/Drivers/Collectors share one real mechanic (an "Add"
        // record plus a separate "Create Login" step that issues a temp
        // password and forces a change on first sign-in) -- Enrollment
        // names that shared shape, rather than splitting Owners into a
        // vehicle-flavored group and Drivers/Collectors into a people-
        // flavored one.
        {
          section: t('nav.groups.enrollment', { defaultValue: 'Enrollment' }),
          items: [
            { to: '/tenant/owners', icon: Wallet2, label: t('nav.owners', { defaultValue: 'Owners' }) },
            { to: '/tenant/drivers', icon: UserCheck, label: t('nav.drivers') },
            { to: '/tenant/conductors', icon: Users, label: t('nav.collectors') },
          ],
        },
        {
          section: t('nav.groups.operations', { defaultValue: 'Operations' }),
          items: [
            { to: '/tenant/operations', icon: Activity, label: t('nav.todaysTrips') },
            { to: '/tenant/dispatch', icon: Zap, label: t('nav.scheduler') },
          ],
        },
        {
          section: t('nav.groups.network', { defaultValue: 'Network' }),
          items: [
            { to: '/tenant/routes', icon: Route, label: t('nav.routes') },
            { to: '/tenant/stops', icon: MapPin, label: t('nav.busStops') },
            { to: '/tenant/fares', icon: Wallet, label: t('nav.fares') },
          ],
        },
        {
          section: t('nav.groups.fleet', { defaultValue: 'Fleet' }),
          items: [
            { to: '/tenant/fleet', icon: Bus, label: t('nav.fleetManagement') },
            { to: '/tenant/vehicle-categories', icon: Layers, label: t('nav.vehicleCategories', { defaultValue: 'Vehicle Categories' }) },
            { to: '/tenant/vehicle-groups', icon: Users2, label: t('nav.vehicleGroups', { defaultValue: 'Vehicle Groups' }) },
            { to: '/tenant/maintenance', icon: Wrench, label: t('nav.maintenance') },
          ],
        },
        {
          section: t('nav.groups.roster', { defaultValue: 'Roster' }),
          items: [
            user?.role === 'DRIVER'
              ? { to: '/tenant/my-roster', icon: CalendarDays, label: t('nav.myRoster', { defaultValue: 'My Roster' }) }
              : { to: '/tenant/roster-periods', icon: CalendarRange, label: t('nav.rosterPeriods', { defaultValue: 'Roster Periods' }) },
          ],
        },
        {
          section: t('nav.groups.finance', { defaultValue: 'Finance' }),
          items: [
            { to: '/tenant/ticketing', icon: Ticket, label: t('nav.ticketing') },
            { to: '/tenant/accounting', icon: BookOpen, label: t('nav.accounting') },
            { to: '/tenant/payment-integration', icon: CreditCard, label: t('nav.paymentIntegration', { defaultValue: 'Payment Integration' }) },
          ],
        },

        // Pinned, ungrouped: Analytics cuts across every group above rather
        // than belonging to one; Roles & Permissions governs every existing
        // account platform-wide, not just newly-enrolled ones, so it stays
        // out of Enrollment on purpose. Settings/Change Profile/Change
        // Password/Preferences/Notification/Report Issue all moved into the
        // Profile dropdown below the nav (see the user-info block at the
        // bottom of the sidebar) -- no separate "Settings" nav item anymore.
        { to: '/tenant/analytics', icon: BarChart3, label: t('nav.analytics') },
        { to: '/tenant/roles', icon: ShieldCheck, label: t('nav.rolesPermissions') },
      ]

  // Company info — same query key as Settings page so it's served from cache.
  // This is a background header-logo fetch, gated to ops/admin roles on the
  // backend -- a 403 here for any other role (conductor, owner, driver...)
  // is expected and harmless (the header just shows no logo), not something
  // that should pop the global "Access denied" toast.
  const { data: companyInfo } = useQuery({
    queryKey: ['company-info'],
    queryFn: async () => {
      const { data } = await apiClient.get('/operator/company/', { suppressErrorToast: true })
      return data.data
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
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
    toast.success(t('nav.logoutSuccess'))
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
                ?? t('nav.operatorFallback')}
            </p>
            <p className="text-xs text-gray-400">{user?.role?.replace(/_/g, ' ')}</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 p-3 overflow-y-auto">
          {navItems.map((entry) => {
            if ('section' in entry) {
              return (
                <div key={entry.section} className="pt-3 first:pt-0">
                  <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    {entry.section}
                  </p>
                  {entry.items.map((item) => (
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
                </div>
              )
            }
            return (
              <NavLink
                key={entry.to}
                to={entry.to}
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
                <entry.icon className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1">{entry.label}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* User info + Profile dropdown */}
        <div className="border-t border-gray-200 p-3 dark:border-gray-700">
          <DropdownMenu as="div" className="relative">
            <div className="flex items-center gap-1">
              <DropdownMenu.Button className="flex flex-1 min-w-0 items-center gap-3 rounded-lg p-1 text-left hover:bg-gray-100 dark:hover:bg-gray-800">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xs font-bold dark:bg-primary-900 dark:text-primary-300">
                  {user?.fullName.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-medium text-gray-900 dark:text-white">
                    {user?.fullName}
                  </p>
                  <p className="truncate text-xs text-gray-400">{user?.email}</p>
                </div>
                <ChevronsUpDown className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
              </DropdownMenu.Button>
              <button
                onClick={handleLogout}
                title={t('nav.logout', { defaultValue: 'Log out' })}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>

            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <DropdownMenu.Items className="absolute bottom-full left-0 right-0 z-50 mb-2 origin-bottom overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg focus:outline-none dark:border-gray-700 dark:bg-gray-800">
                {/* Basic info -- name/email/role/company, already on file,
                    same data the sidebar header and this trigger already
                    show, surfaced again here so the menu reads standalone. */}
                <div className="border-b border-gray-100 p-4 dark:border-gray-700">
                  <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{user?.fullName}</p>
                  <p className="truncate text-xs text-gray-400">{user?.email}</p>
                  <p className="mt-1 text-xs text-gray-400">{user?.role?.replace(/_/g, ' ')}</p>
                </div>

                <div className="p-1.5">
                  {[
                    { to: '/tenant/profile', icon: UserCog, label: t('profile.changeProfile', { defaultValue: 'Change Profile' }) },
                    { to: '/tenant/profile/password', icon: KeyRound, label: t('profile.changePassword', { defaultValue: 'Change Password' }) },
                    { to: '/tenant/profile/preferences', icon: SlidersHorizontal, label: t('profile.preferences', { defaultValue: 'Preferences' }) },
                    { to: '/tenant/profile/notifications', icon: BellRing, label: t('profile.notifications', { defaultValue: 'Notification' }) },
                    { to: '/tenant/profile/report-issue', icon: Bug, label: t('profile.reportIssue', { defaultValue: 'Report Issue' }) },
                    { to: '/tenant/roles', icon: ShieldCheck, label: t('nav.rolesPermissions') },
                  ].map((item) => (
                    <DropdownMenu.Item key={item.to}>
                      {({ active }) => (
                        <NavLink
                          to={item.to}
                          className={cn(
                            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200',
                            active && 'bg-gray-100 dark:bg-gray-700'
                          )}
                        >
                          <item.icon className="h-4 w-4 flex-shrink-0" />
                          {item.label}
                        </NavLink>
                      )}
                    </DropdownMenu.Item>
                  ))}
                </div>
              </DropdownMenu.Items>
            </Transition>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main */}
      <div className={cn('flex-1 flex flex-col min-w-0', sidebarOpen && 'lg:ml-[var(--sidebar-width)]')}>
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

        {/* Page content -- min-w-0 lets a wide table's own overflow-x-auto
            actually engage, instead of a flex child refusing to shrink
            below its content's natural width and pushing the whole page
            (title, primary button, tabs) off-screen with it. */}
        <main className="flex-1 min-w-0 p-6">
          {children}
        </main>
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={toggleSidebar} />
      )}
    </div>
  )
}
