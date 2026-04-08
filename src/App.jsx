import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import AppLayout from '@/components/layout/AppLayout'
import Login from '@/pages/Login'
import AdminDashboard from '@/pages/admin/Dashboard'
import AdminClients from '@/pages/admin/Clients'
import AdminClientDetail from '@/pages/admin/ClientDetail'
import AdminStaff from '@/pages/admin/Staff'
import AdminLogs from '@/pages/admin/Logs'
import AdminLogDetail from '@/pages/admin/LogDetail'
import AdminReports from '@/pages/admin/Reports'
import StaffNewEntry from '@/pages/staff/NewEntry'
import StaffWeeklyUpload from '@/pages/staff/WeeklyUpload'
import StaffHistory from '@/pages/staff/History'
import Accounts from '@/pages/accounts/Accounts'

// ─── Spinner ──────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-navy-800">
      <div className="flex flex-col items-center gap-3">
        <img src="/icon-192.png" alt="TFHQ" className="w-16 h-16 rounded-2xl animate-pulse" />
        <div className="w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  )
}

// ─── Guards ────────────────────────────────────────────────────

/** Any authenticated user */
function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  return children
}

/** Admin role only */
function RequireAdmin({ children }) {
  const { user, loading, isAdmin } = useAuth()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/log/new" replace />
  return children
}

/** Admin OR accounts role */
function RequireAccounts({ children }) {
  const { user, loading, isAdmin, isAccounts } = useAuth()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  if (!isAdmin && !isAccounts) return <Navigate to="/log/new" replace />
  return children
}

function PublicOnly({ children }) {
  const { user, loading, isAdmin, isAccounts } = useAuth()
  if (loading) return <Spinner />
  if (user) {
    if (isAdmin)    return <Navigate to="/admin/dashboard" replace />
    if (isAccounts) return <Navigate to="/accounts"        replace />
    return <Navigate to="/log/new" replace />
  }
  return children
}

/** Redirects "/" to the right home page based on role */
function DefaultRedirect() {
  const { isAdmin, isAccounts } = useAuth()
  if (isAdmin)    return <Navigate to="/admin/dashboard" replace />
  if (isAccounts) return <Navigate to="/accounts"        replace />
  return <Navigate to="/log/new" replace />
}

// ─── App ───────────────────────────────────────────────────────
export default function App() {
  return (
    <Routes>
      {/* Auth */}
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />

      {/* App Shell */}
      <Route path="/" element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<DefaultRedirect />} />

        {/* Staff Routes */}
        {/* Default /log/new is now the weekly photo upload flow.
            The old per-day manual form stays reachable at /log/manual for admins. */}
        <Route path="log/new"     element={<StaffWeeklyUpload />} />
        <Route path="log/manual"  element={<StaffNewEntry />} />
        <Route path="log/history" element={<StaffHistory />} />

        {/* Admin Routes */}
        <Route path="admin/dashboard"   element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
        <Route path="admin/clients"     element={<RequireAdmin><AdminClients /></RequireAdmin>} />
        <Route path="admin/clients/:id" element={<RequireAdmin><AdminClientDetail /></RequireAdmin>} />
        <Route path="admin/staff"       element={<RequireAdmin><AdminStaff /></RequireAdmin>} />
        <Route path="admin/logs"        element={<RequireAdmin><AdminLogs /></RequireAdmin>} />
        <Route path="admin/logs/:id"    element={<RequireAdmin><AdminLogDetail /></RequireAdmin>} />
        <Route path="admin/reports"     element={<RequireAdmin><AdminReports /></RequireAdmin>} />

        {/* Accounts Routes — admin AND accounts role */}
        <Route path="accounts" element={<RequireAccounts><Accounts /></RequireAccounts>} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
