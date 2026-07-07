import { ReactNode, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard, Building2, CreditCard, Receipt,
  Users, Settings, Menu, X, Bell, LogOut, Bus, Moon, Sun,
} from 'lucide-react'
import { useAuthStore } from '@store/authStore'
import { useUiStore } from '@store/uiStore'
import { LanguageToggle } from '@components/shared/LanguageToggle'
import { KeyboardToggle } from '@components/shared/KeyboardToggle'
import { CalendarToggle } from '@components/shared/DateDisplay'
import { cn } from '@utils/cn'
import authService from '@services/authService'
import toast from 'react-hot-toast'

const navItems = [
  { to: '/super-admin/dashboard', icon: LayoutDashboard, labelKey: 'platform:nav.dashboard' },
  { to: '/super-admin/tenants', icon: Building2, labelKey: 'platform:nav.tenantsOnboarding' },
  { to: '/super-admin/billing', icon: Receipt, labelKey: 'platform:nav.billing' },
  { to: '/super-admin/smart-cards', icon: CreditCard, labelKey: 'platform:nav.smartCards' },
  { to: '/super-admin/users', icon: Users, labelKey: 'platform:nav.users' },
  { to: '/super-admin/settings', icon: Settings, labelKey: 'platform:nav.settings' },
]

interface SuperAdminLayoutProps {
  children: ReactNode
}

export default function SuperAdminLayout({ children }: SuperAdminLayoutProps) {
  const { t } = useTranslation(['common', 'platform'])
  const { user, logout: storeLogout, refreshToken } = useAuthStore()
  const { sidebarOpen, toggleSidebar, theme, toggleTheme } = useUiStore()
  const navigate = useNavigate()

  const handleLogout = async () => {
    try {
      if (refreshToken) await authService.logout(refreshToken)
    } catch {}
    storeLogout()
    navigate('/login')
    toast.success(t('platform:nav.logoutSuccess'))
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
        {/* Logo */}
        <div className="flex h-[var(--header-height)] items-center gap-3 border-b border-gray-200 px-4 dark:border-gray-700">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-600 text-white">
            <Bus className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900 dark:text-white">KVBMS</p>
            <p className="text-xs text-gray-400">{t('platform:nav.superAdmin')}</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium',
                  'transition-colors duration-150',
                  isActive
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                )
              }
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>

        {/* User info */}
        <div className="border-t border-gray-200 p-4 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-sm font-bold dark:bg-primary-900 dark:text-primary-300">
              {user?.fullName.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                {user?.fullName}
              </p>
              <p className="truncate text-xs text-gray-400">{t('platform:nav.superAdmin')}</p>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800"
              title={t('common:nav.logout')}
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
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <div className="flex-1" />

          <CalendarToggle />
          <KeyboardToggle />
          <LanguageToggle />

          <button
            onClick={toggleTheme}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>

          <button className="relative rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <Bell className="h-5 w-5" />
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={toggleSidebar}
        />
      )}
    </div>
  )
}
