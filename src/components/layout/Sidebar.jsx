import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import {
  LayoutDashboard, Building2, Users, ClipboardList,
  FileBarChart2, LogOut, PlusCircle, History,
  Shirt, Calculator,
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const adminNav = [
  { to: '/admin/dashboard', label: 'Dashboard',    icon: LayoutDashboard },
  { to: '/admin/logs',      label: 'All Logs',     icon: ClipboardList },
  { to: '/admin/clients',   label: 'Clients',      icon: Building2 },
  { to: '/admin/staff',     label: 'Staff',        icon: Users },
  { to: '/admin/reports',   label: 'Reports',      icon: FileBarChart2 },
]

const accountsNav = [
  { to: '/accounts', label: 'Accounts Panel', icon: Calculator },
]

const staffNav = [
  { to: '/log/new',     label: 'New Entry',  icon: PlusCircle },
  { to: '/log/history', label: 'My History', icon: History },
]

export default function Sidebar({ onClose }) {
  const { profile, isAdmin, isAccounts, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    try {
      await signOut()
      navigate('/login')
    } catch {
      toast.error('Sign out failed')
    }
  }

  // Determine primary nav based on role
  const navItems = isAdmin ? adminNav : isAccounts ? accountsNav : staffNav

  return (
    <div className="flex flex-col h-full bg-navy-800 text-white select-none">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-navy-700">
        <img src="/icon-192.png" alt="TFHQ" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-white leading-tight truncate">TFHQ Laundry</p>
          <p className="text-xs text-gold-400 font-medium truncate">Processing Log</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onClose}
            className={({ isActive }) =>
              clsx('sidebar-link', isActive && 'active')
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}

        {/* Admin: Accounts section */}
        {isAdmin && (
          <>
            <div className="pt-4 pb-1 px-2">
              <p className="text-xs text-navy-400 font-semibold uppercase tracking-wider">Accounts</p>
            </div>
            <NavLink
              to="/accounts"
              onClick={onClose}
              className={({ isActive }) => clsx('sidebar-link', isActive && 'active')}
            >
              <Calculator size={17} />
              Accounts Panel
            </NavLink>
          </>
        )}

        {/* Admin: Quick entry to log gowns */}
        {isAdmin && (
          <>
            <div className="pt-4 pb-1 px-2">
              <p className="text-xs text-navy-400 font-semibold uppercase tracking-wider">Quick Entry</p>
            </div>
            <NavLink
              to="/log/new"
              onClick={onClose}
              className={({ isActive }) => clsx('sidebar-link', isActive && 'active')}
            >
              <Shirt size={17} />
              Log Entry
            </NavLink>
          </>
        )}
      </nav>

      {/* User footer */}
      <div className="px-3 py-4 border-t border-navy-700 space-y-1">
        <div className="px-3 py-2">
          <p className="text-sm font-medium text-white truncate">
            {profile?.full_name || profile?.email || 'User'}
          </p>
          <p className="text-xs text-navy-400 capitalize">{profile?.role || 'staff'}</p>
        </div>
        <button
          onClick={handleSignOut}
          className="sidebar-link w-full text-left text-red-400 hover:text-red-300 hover:bg-navy-700"
        >
          <LogOut size={17} />
          Sign Out
        </button>
      </div>
    </div>
  )
}
