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
import StaffHistory from '@/pages/staff/History'

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
function RequireAuth({ children, adminOnly = false }) {
  const { user, loading, isAdmin } = useAuth()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && !isAdmin) return <Navigate to="/log/new" replace />
  return children
}

function PublicOnly({ children }) {
  const { user, loading, isAdmin } = useAuth()
  if (loading) return <Spinner />
  if (user) return <Navigate to={isAdmin ? '/admin/dashboard' : '/log/new'} replace />
  return children
}

// ─── App ───────────────────────────────────────────────────────
export default function App() {
  return (
    <Routes>
      {/* Auth */}
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />

      {/* App Shell */}
      <Route path="/" element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<Navigate to="/log/new" replace />} />

        {/* Staff Routes */}
        <Route path="log/new"     element={<StaffNewEntry />} />
        <Route path="log/history" element={<StaffHistory />} />

        {/* Admin Routes */}
        <Route path="admin/dashboard"       element={<RequireAuth adminOnly><AdminDashboard /></RequireAuth>} />
        <Route path="admin/clients"         element={<RequireAuth adminOnly><AdminClients /></RequireAuth>} />
        <Route path="admin/clients/:id"     element={<RequireAuth adminOnly><AdminClientDetail /></RequireAuth>} />
        <Route path="admin/staff"           element={<RequireAuth adminOnly><AdminStaff /></RequireAuth>} />
        <Route path="admin/logs"            element={<RequireAuth adminOnly><AdminLogs /></RequireAuth>} />
        <Route path="admin/logs/:id"        element={<RequireAuth adminOnly><AdminLogDetail /></RequireAuth>} />
        <Route path="admin/reports"         element={<RequireAuth adminOnly><AdminReports /></RequireAuth>} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
