import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'
import { ClipboardList, ChevronRight, Calendar } from 'lucide-react'

function useMyHistory(userId, isAdmin) {
  return useQuery({
    queryKey: ['my-history', userId, isAdmin],
    queryFn: async () => {
      let q = supabase
        .from('laundry_logs')
        .select(`
          id, log_date, status, created_at, total_packed,
          laundry_clients(name),
          laundry_buildings(name),
          laundry_log_rows(qty_packed, ink_stain, large_holes, to_repair)
        `)
        .order('log_date', { ascending: false })
        .limit(100)

      if (!isAdmin) q = q.eq('submitted_by', userId)

      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    enabled: !!userId,
  })
}

export default function StaffHistory() {
  const { user, isAdmin } = useAuth()
  const { data: logs = [], isLoading } = useMyHistory(user?.id, isAdmin)
  const [search, setSearch] = useState('')

  const filtered = logs.filter(l => {
    if (!search) return true
    const t = search.toLowerCase()
    return (
      l.laundry_clients?.name?.toLowerCase().includes(t) ||
      l.laundry_buildings?.name?.toLowerCase().includes(t) ||
      l.log_date?.includes(t)
    )
  })

  const totalPacked = filtered.reduce((s, l) =>
    s + (l.laundry_log_rows || []).reduce((r, row) => r + (row.qty_packed || 0), 0), 0)

  return (
    <div className="p-4 lg:p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {isAdmin ? 'All Log Entries' : 'My Submissions'}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {filtered.length} entries · {totalPacked.toLocaleString()} gowns total
        </p>
      </div>

      {/* Search */}
      <input
        className="input max-w-sm"
        placeholder="Search by client, building or date…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {/* List */}
      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(log => {
            const rows = log.laundry_log_rows || []
            const packed  = rows.reduce((s, r) => s + (r.qty_packed || 0), 0)
            const rejects = rows.reduce((s, r) => s + (r.ink_stain || 0) + (r.large_holes || 0), 0)
            const repairs = rows.reduce((s, r) => s + (r.to_repair || 0), 0)

            return (
              <div key={log.id} className="card p-4 flex items-center gap-4">
                {/* Date block */}
                <div className="flex-shrink-0 w-14 text-center bg-navy-50 rounded-xl py-2">
                  <p className="text-xs text-navy-500 font-medium leading-none">
                    {format(new Date(log.log_date), 'MMM')}
                  </p>
                  <p className="text-2xl font-bold text-navy-700 leading-tight">
                    {format(new Date(log.log_date), 'd')}
                  </p>
                  <p className="text-xs text-navy-400 leading-none">
                    {format(new Date(log.log_date), 'yyyy')}
                  </p>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-900 text-sm">
                      {log.laundry_clients?.name}
                    </p>
                    <span className="text-gray-400 text-sm">·</span>
                    <p className="text-gray-600 text-sm">{log.laundry_buildings?.name}</p>
                    <span className={log.status === 'reviewed' ? 'badge-green' : log.status === 'submitted' ? 'badge-blue' : 'badge-gray'}>
                      {log.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-1.5 text-sm">
                    <span className="text-navy-700 font-bold">{packed.toLocaleString()} packed</span>
                    {rejects > 0 && <span className="text-red-500">{rejects} rejects</span>}
                    {repairs > 0 && <span className="text-amber-500">{repairs} repairs</span>}
                  </div>
                </div>

                {/* Action */}
                {isAdmin ? (
                  <Link to={`/admin/logs/${log.id}`} className="btn-secondary btn-sm flex-shrink-0">
                    View <ChevronRight size={13} />
                  </Link>
                ) : (
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs text-gray-400">
                      {format(new Date(log.created_at), 'HH:mm')}
                    </p>
                  </div>
                )}
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div className="card p-12 text-center">
              <Calendar size={36} className="text-gray-200 mx-auto mb-3" />
              <p className="text-gray-400">No log entries found</p>
              <Link to="/log/new" className="btn-primary mt-4 inline-flex">
                Create your first entry →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
