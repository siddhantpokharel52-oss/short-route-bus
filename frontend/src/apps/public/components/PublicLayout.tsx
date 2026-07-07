import { ReactNode } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bus, Map, MapPin, DollarSign, QrCode, MessageSquare, CreditCard, Menu, X } from 'lucide-react'
import { LanguageToggle } from '@components/shared/LanguageToggle'
import { cn } from '@utils/cn'
import { useState } from 'react'

const navItems = [
  { to: '/routes', icon: Map, labelKey: 'public:routes.title' },
  { to: '/stops', icon: MapPin, labelKey: 'public:stops.title' },
  { to: '/fares', icon: DollarSign, labelKey: 'public:fares.title' },
  { to: '/verify-ticket', icon: QrCode, labelKey: 'public:tickets.verifyTicket' },
  { to: '/complaints', icon: MessageSquare, labelKey: 'public:complaints.title' },
  { to: '/smart-card', icon: CreditCard, labelKey: 'public:smartCard.title' },
]

interface PublicLayoutProps {
  children: ReactNode
}

export default function PublicLayout({ children }: PublicLayoutProps) {
  const { t } = useTranslation(['common', 'public'])
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <nav className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur-sm shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-600 text-white">
                <Bus className="h-5 w-5" />
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-bold text-gray-900">KVBMS</p>
                <p className="text-xs text-gray-500">{t('public:layout.subtitleCity')}</p>
              </div>
            </Link>

            {/* Desktop nav */}
            <div className="hidden md:flex items-center gap-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    )
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {t(item.labelKey)}
                </NavLink>
              ))}
            </div>

            {/* Right */}
            <div className="flex items-center gap-3">
              <LanguageToggle className="hidden sm:flex" />
              <Link
                to="/login"
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                {t('auth.login')}
              </Link>
              {/* Mobile menu */}
              <button
                className="md:hidden rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                onClick={() => setMenuOpen(!menuOpen)}
              >
                {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile nav */}
        {menuOpen && (
          <div className="border-t border-gray-200 bg-white px-4 py-3 md:hidden">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
                    isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-600'
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {t(item.labelKey)}
              </NavLink>
            ))}
            <div className="mt-3 pt-3 border-t">
              <LanguageToggle />
            </div>
          </div>
        )}
      </nav>

      {/* Page */}
      <main>{children}</main>

      {/* Footer */}
      <footer className="mt-16 border-t border-gray-200 bg-white py-8">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-gray-400">
          <p>© 2081 BS / 2024 AD काठमाडौं उपत्यका सार्वजनिक यातायात व्यवस्थापन प्रणाली</p>
          <p className="mt-1">{t('public:layout.footerFullName')}</p>
        </div>
      </footer>
    </div>
  )
}
