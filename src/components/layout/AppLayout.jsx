import { useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Building2, Users, ClipboardList,
  FileBarChart2, PlusCircle, History, Menu, Calculator,
} from 'lucide-react'
import Sidebar from './Sidebar'
import { useAuth } from '@/contexts/AuthContext'
import clsx from 'clsx'

const adminMobileNav = [
  { to: '/admin/dashboard', label: 'Home',      icon: LayoutDashboard },
  { to: '/admin/logs',      label: 'Logs',      icon: ClipboardList },
  { to: '/admin/clients',   label: 'Clients',   icon: Building2 },
  { to: '/admin/reports',   label: 'Reports',   icon: FileBarChart2 },
  { to: '/accounts',        label: 'Accounts',  icon: Calculator },
]

const accountsMobileNav = [
  { to: '/accounts', label: 'Accounts', icon: Calculator },
]

const staffMobileNav = [
  { to: '/log/new',     label: 'New Entry', icon: PlusCircle },
  { to: '/log/history', label: 'History',   icon: History },
]

export default function AppLayout() {
  const [open, setOpen] = useState(false)
  const { isAdmin, isAccounts } = useAuth()

  const mobileNavItems = isAdmin
    ? adminMobileNav
    : isAccounts
      ? accountsMobileNav
      : staffMobileNav

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="relative w-72 h-full">
            <Sidebar onClose={() => setOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-navy-800 border-b border-navy-700">
          <div className="flex items-center gap-2">
            <img src="/icon-192.png" alt="TFHQ" className="w-7 h-7 rounded-lg object-cover" />
            <span className="text-white font-semibold text-sm">TFHQ Laundry</span>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="text-navy-400 hover:text-white transition-colors p-1"
            aria-label="More options"
          >
            <Menu size={20} />
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-navy-800 border-t border-navy-700 flex">
        {mobileNavItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors',
                isActive
                  ? 'text-gold-400'
                  : 'text-navy-400 active:text-navy-200'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={22}
                  className={isActive ? 'text-gold-400' : 'text-navy-400'}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                <span className="leading-tight">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
