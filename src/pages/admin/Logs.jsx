import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Link, useSearchParams } from 'react-router-dom'
import { format, subDays } from 'date-fns'
import { Search, ChevronRight, Calendar, Trash2, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

function useLogs(filters) {
  return useQuery({
    queryKey: ['admin-logs', filters],
    queryFn: async () => {
      let q = supabase
        .from('laundry_logs')
        .select(`
          id, log_date, status, created_at, submitted_by,
          laundry_clients(id, name),
          laundry_buildings(id, name),
          laundry_log_rows(blue_gowns, white_gowns, grey_gowns, qty_packed, ink_stain, large_holes, to_repair)
        `)
        .order('log_date', { ascending: false })
        .limit(200)

      if (filters.client)   q = q.eq('client_id',   filters.client)
      if (filters.building) q = q.eq('building_id',  filters.building)
      if (filters.status)   q = q.eq('status',       filters.status)
      if (filters.from)     q = q.gte('log_date',    filters.from)
      if (filters.to)       q = q.lte('log_date',    filters.to)

      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })
}

function useClientsAndBuildings() {
  return useQuery({
    queryKey: ['filter-options'],
    queryFn: async () => {
      const [c, b] = await Promise.all([
        supabase.from('laundry_clients').select('id, name').eq('active', true).order('name'),
        supabase.from('laundry_buildings').select('id, name, client_id').eq('active', true).order('name'),
      ])
      return { clients: c.data || [], buildings: b.data || [] }
    },
  })
}

// Calculate total gowns from a log's rows — uses blue+white+grey if available, falls back to qty_packed
function calcPacked(rows) {
  return rows.reduce((s, r) => {
    const fromColors = (r.blue_gowns || 0) + (r.white_gowns || 0) + (r.grey_gowns || 0)
    return s + (fromColors || r.qty_packed || 0)
  }, 0)
}

export default function AdminLogs() {
  const [searchParams] = useSearchParams()
  const [search, setSearch]   = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)  // log id to confirm
  const [filters, setFilters] = useState({
    client:   searchParams.get('client') || '',
    building: '',
    status:   '',
    from:     format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    to:       format(new Date(), 'yyyy-MM-dd'),
  })

  const qc = useQueryClient()
  const { data: logs = [], isLoading, isError, error } = useLogs(filters)
  const { data: options } = useClientsAndBuildings()

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('laundry_logs').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-logs'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success('Log entry deleted')
      setConfirmDelete(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const filteredBuildings = filters.client
    ? (options?.buildings || []).filter(b => b.client_id === filters.client)
    : (options?.buildings || [])

  const displayed = logs.filter(l => {
    if (!search) return true
    const term = search.toLowerCase()
    return (
      l.laundry_clients?.name?.toLowerCase().includes(term) ||
      l.laundry_buildings?.name?.toLowerCase().includes(term) ||
      l.log_date?.includes(term)
    )
  })

  const totalPacked = displayed.reduce((s, log) => s + calcPacked(log.laundry_log_rows || []), 0)

  function resetFilters() {
    setFilters({
      client: '', building: '', status: '',
      from: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
      to:   format(new Date(), 'yyyy-MM-dd'),
    })
    setSearch('')
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Log Entries</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {displayed.length} entries · {totalPacked.toLocaleString()} gowns packed
          </p>
        </div>
        <button onClick={resetFilters} className="btn-secondary btn-sm text-xs">
          Reset Filters
        </button>
      </div>

      {/* Error banner */}
      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-700">Failed to load logs</p>
            <p className="text-xs text-red-600 mt-0.5">{error?.message}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="label">Client</label>
            <select className="input" value={filters.client}
              onChange={e => setFilters(f => ({ ...f, client: e.target.value, building: '' }))}>
              <option value="">All Clients</option>
              {options?.clients?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Building</label>
            <select className="input" value={filters.building}
              onChange={e => setFilters(f => ({ ...f, building: e.target.value }))}>
              <option value="">All Buildings</option>
              {filteredBuildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={filters.status}
              onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="reviewed">Reviewed</option>
            </select>
          </div>
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={filters.from}
              onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={filters.to}
              onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
          </div>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Search by client, building or date…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-bold text-gray-900 text-lg mb-2">Delete this log?</h3>
            <p className="text-sm text-gray-500 mb-5">
              This will permanently remove the log entry and all its gown rows. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(confirmDelete)}
                disabled={deleteMutation.isPending}
                className="btn-danger"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="table-header">Date</th>
                <th className="table-header">Client</th>
                <th className="table-header">Building</th>
                <th className="table-header text-right">Gowns</th>
                <th className="table-header text-right">Ink</th>
                <th className="table-header text-right">Holes</th>
                <th className="table-header text-right">Repairs</th>
                <th className="table-header">Status</th>
                <th className="table-header" colSpan={2}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading && (
                <tr>
                  <td colSpan={10} className="table-cell text-center py-10 text-gray-400">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && !isError && displayed.map(log => {
                const rows = log.laundry_log_rows || []
                const p    = calcPacked(rows)
                const ink  = rows.reduce((s, r) => s + (r.ink_stain   || 0), 0)
                const lh   = rows.reduce((s, r) => s + (r.large_holes || 0), 0)
                const rep  = rows.reduce((s, r) => s + (r.to_repair   || 0), 0)
                const rejects = ink + lh
                return (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell font-medium whitespace-nowrap">
                      {format(new Date(log.log_date), 'dd MMM yyyy')}
                    </td>
                    <td className="table-cell">{log.laundry_clients?.name || '—'}</td>
                    <td className="table-cell">{log.laundry_buildings?.name || '—'}</td>
                    <td className="table-cell text-right font-semibold text-navy-700">
                      {p.toLocaleString() || '—'}
                    </td>
                    <td className="table-cell text-right text-red-600">{ink  || '—'}</td>
                    <td className="table-cell text-right text-orange-600">{lh  || '—'}</td>
                    <td className="table-cell text-right text-amber-600">{rep || '—'}</td>
                    <td className="table-cell">
                      <span className={
                        log.status === 'reviewed' ? 'badge-green' :
                        log.status === 'submitted' ? 'badge-blue' : 'badge-gray'
                      }>
                        {log.status}
                      </span>
                    </td>
                    <td className="table-cell">
                      <Link to={`/admin/logs/${log.id}`} className="btn-secondary btn-sm">
                        View <ChevronRight size={13} />
                      </Link>
                    </td>
                    <td className="table-cell">
                      <button
                        onClick={() => setConfirmDelete(log.id)}
                        className="btn-danger btn-sm p-1.5"
                        title="Delete log"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {!isLoading && !isError && displayed.length === 0 && (
                <tr>
                  <td colSpan={10} className="table-cell text-center py-12">
                    <Calendar size={32} className="text-gray-300 mx-auto mb-2" />
                    <p className="text-gray-400 font-medium">No log entries found</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Try adjusting the date range or filters above
                    </p>
                    <button onClick={resetFilters} className="mt-3 text-xs text-navy-600 underline">
                      Reset all filters
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
