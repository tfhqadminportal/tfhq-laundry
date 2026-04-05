import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { format, subDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns'
import { FileDown, BarChart2, Calendar, Building2 } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, LineChart, Line
} from 'recharts'
import toast from 'react-hot-toast'

const PRESETS = [
  { label: 'This Week',  from: format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'), to: format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd') },
  { label: 'Last 7 Days',  from: format(subDays(new Date(), 6), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') },
  { label: 'Last 30 Days', from: format(subDays(new Date(), 29), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') },
  { label: 'This Month',   from: format(startOfMonth(new Date()), 'yyyy-MM-dd'), to: format(endOfMonth(new Date()), 'yyyy-MM-dd') },
]

function useReportData(filters) {
  return useQuery({
    queryKey: ['reports', filters],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('laundry_logs')
        .select(`
          id, log_date, status,
          laundry_clients(id, name),
          laundry_buildings(id, name),
          laundry_log_rows(size_label, qty_packed, ink_stain, large_holes, to_repair)
        `)
        .gte('log_date', filters.from)
        .lte('log_date', filters.to)
        .eq(filters.client ? 'client_id' : 'status', filters.client || (filters.status || 'submitted'))
        .order('log_date')

      if (error) {
        // Try without status filter
        const { data: d2, error: e2 } = await supabase
          .from('laundry_logs')
          .select(`id, log_date, status, laundry_clients(id, name), laundry_buildings(id, name), laundry_log_rows(size_label, qty_packed, ink_stain, large_holes, to_repair)`)
          .gte('log_date', filters.from)
          .lte('log_date', filters.to)
          .order('log_date')
        if (e2) throw e2
        return d2 || []
      }
      return data || []
    },
  })
}

function useClients() {
  return useQuery({
    queryKey: ['clients-simple'],
    queryFn: async () => {
      const { data } = await supabase.from('laundry_clients').select('id, name').eq('active', true).order('name')
      return data || []
    },
  })
}

function processData(logs) {
  const daily = {}
  const byBuilding = {}
  const bySize = {}
  let totalPacked = 0, totalRejects = 0, totalRepairs = 0

  logs.forEach(log => {
    const d = log.log_date
    const bName = log.laundry_buildings?.name || 'Unknown'

    if (!daily[d]) daily[d] = { date: d, packed: 0, rejects: 0, repairs: 0, logs: 0 }
    if (!byBuilding[bName]) byBuilding[bName] = { name: bName, packed: 0, rejects: 0, repairs: 0 }

    const rows = log.laundry_log_rows || []
    rows.forEach(r => {
      const p   = r.qty_packed   || 0
      const rej = (r.ink_stain || 0) + (r.large_holes || 0)
      const rep = r.to_repair || 0

      totalPacked  += p
      totalRejects += rej
      totalRepairs += rep

      daily[d].packed  += p
      daily[d].rejects += rej
      daily[d].repairs += rep
      daily[d].logs++

      byBuilding[bName].packed  += p
      byBuilding[bName].rejects += rej
      byBuilding[bName].repairs += rep

      const sz = r.size_label || 'Unknown'
      if (!bySize[sz]) bySize[sz] = { size: sz, packed: 0, rejects: 0, repairs: 0 }
      bySize[sz].packed  += p
      bySize[sz].rejects += rej
      bySize[sz].repairs += rep
    })
  })

  const SIZE_ORDER = ['XS', 'M', 'XL', '3XL', '5XL', '7XL', '9XL']
  const sizeData = SIZE_ORDER
    .filter(s => bySize[s])
    .map(s => bySize[s])

  return {
    totalPacked, totalRejects, totalRepairs,
    rejectRate: totalPacked ? ((totalRejects / totalPacked) * 100).toFixed(1) : '0.0',
    dailyData: Object.values(daily).map(d => ({
      ...d,
      date: format(new Date(d.date), 'dd MMM'),
    })),
    buildingData: Object.values(byBuilding).sort((a, b) => b.packed - a.packed),
    sizeData,
    rawLogs: logs,
  }
}

function exportCSV(logs) {
  const rows = [
    ['Date', 'Client', 'Building', 'Size', 'Qty Packed', 'Ink Stain', 'Large/Burnt Holes', 'To Repair', 'Total Rejects', 'Status']
  ]
  logs.forEach(log => {
    const logRows = log.laundry_log_rows || []
    if (logRows.length === 0) {
      rows.push([log.log_date, log.laundry_clients?.name || '', log.laundry_buildings?.name || '', '', '', '', '', '', '', log.status])
    }
    logRows.forEach(r => {
      rows.push([
        log.log_date,
        log.laundry_clients?.name || '',
        log.laundry_buildings?.name || '',
        r.size_label,
        r.qty_packed || 0,
        r.ink_stain || 0,
        r.large_holes || 0,
        r.to_repair || 0,
        (r.ink_stain || 0) + (r.large_holes || 0),
        log.status,
      ])
    })
  })

  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `laundry-report-${format(new Date(), 'yyyy-MM-dd')}.csv`
  a.click()
  URL.revokeObjectURL(url)
  toast.success('Report exported!')
}

export default function AdminReports() {
  const { data: clients = [] } = useClients()
  const [filters, setFilters] = useState({
    from: format(subDays(new Date(), 29), 'yyyy-MM-dd'),
    to:   format(new Date(), 'yyyy-MM-dd'),
    client: '',
  })

  const { data: logs = [], isLoading } = useReportData(filters)

  const stats = processData(logs)

  function applyPreset(preset) {
    setFilters(f => ({ ...f, from: preset.from, to: preset.to }))
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports & Export</h1>
          <p className="text-sm text-gray-500 mt-0.5">Analyse and export laundry data</p>
        </div>
        <button
          onClick={() => exportCSV(logs)}
          disabled={isLoading || logs.length === 0}
          className="btn-gold"
        >
          <FileDown size={16} /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 space-y-3">
        {/* Presets */}
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              className="btn-secondary btn-sm"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={filters.to}   onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
          </div>
          <div>
            <label className="label">Client</label>
            <select className="input" value={filters.client} onChange={e => setFilters(f => ({ ...f, client: e.target.value }))}>
              <option value="">All Clients</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {isLoading && <div className="card p-10 text-center text-gray-400 animate-pulse">Generating report…</div>}

      {!isLoading && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Gowns Processed', value: stats.totalPacked.toLocaleString(), cls: 'text-navy-700' },
              { label: 'Total Rejects',          value: stats.totalRejects.toLocaleString(), cls: 'text-red-600' },
              { label: 'Reject Rate',            value: `${stats.rejectRate}%`, cls: 'text-orange-600' },
              { label: 'For Repair',             value: stats.totalRepairs.toLocaleString(), cls: 'text-amber-600' },
            ].map(({ label, value, cls }) => (
              <div key={label} className="card p-4 text-center">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
                <p className={`text-2xl font-bold mt-1 ${cls}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Daily Volume */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <Calendar size={15} /> Daily Volume
              </h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.dailyData} barSize={12} margin={{ top: 0, right: 5, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="packed"  name="Packed"  fill="#1B3A5C" radius={[2,2,0,0]} />
                  <Bar dataKey="rejects" name="Rejects" fill="#ef4444" radius={[2,2,0,0]} />
                  <Bar dataKey="repairs" name="Repairs" fill="#B8952A" radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* By Size */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <BarChart2 size={15} /> Volume by Size
              </h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.sizeData} barSize={20} margin={{ top: 0, right: 5, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="size" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="packed"  name="Packed"  fill="#1B3A5C" radius={[3,3,0,0]} />
                  <Bar dataKey="rejects" name="Rejects" fill="#ef4444" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Building Breakdown Table */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Building2 size={15} />
              <h2 className="font-semibold text-gray-800">Building Performance</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-header">Building</th>
                    <th className="table-header text-right">Packed</th>
                    <th className="table-header text-right">Rejects</th>
                    <th className="table-header text-right">Reject Rate</th>
                    <th className="table-header text-right">Repairs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {stats.buildingData.map(b => (
                    <tr key={b.name} className="hover:bg-gray-50">
                      <td className="table-cell font-medium">{b.name}</td>
                      <td className="table-cell text-right font-semibold">{b.packed.toLocaleString()}</td>
                      <td className="table-cell text-right text-red-600">{b.rejects || '—'}</td>
                      <td className="table-cell text-right text-orange-600">
                        {b.packed ? `${((b.rejects / b.packed) * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td className="table-cell text-right text-amber-600">{b.repairs || '—'}</td>
                    </tr>
                  ))}
                  {stats.buildingData.length === 0 && (
                    <tr><td colSpan={5} className="table-cell text-center py-6 text-gray-400">No data for this period</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
