import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  ArrowLeft, CheckCircle, Pencil, Trash2, Save,
  Package, Wrench, TrendingUp, Clock, Users, Percent,
} from 'lucide-react'
import RosterHoursWidget from '@/components/ui/RosterHoursWidget'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

const SIZES = ['XS', 'M', 'XL', '3XL', '5XL', '7XL', '9XL']

// ─── Data hooks ────────────────────────────────────────────────
function useLog(id) {
  return useQuery({
    queryKey: ['log', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('laundry_logs')
        .select(`
          *,
          laundry_clients(id, name, staff_count, target_gowns_per_hour),
          laundry_buildings(id, name, bag_color),
          laundry_log_rows(*)
        `)
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}

function useSubmitterProfile(userId) {
  return useQuery({
    queryKey: ['submitter-profile', userId],
    queryFn: async () => {
      if (!userId) return null
      const { data } = await supabase
        .from('laundry_profiles')
        .select('full_name, email')
        .eq('id', userId)
        .maybeSingle()
      return data
    },
    enabled: !!userId,
  })
}

function useDailyExtras(clientId, logDate) {
  return useQuery({
    queryKey: ['daily-extras', clientId, logDate],
    queryFn: async () => {
      if (!clientId || !logDate) return null
      const { data } = await supabase
        .from('laundry_daily_extras')
        .select('*')
        .eq('client_id', clientId)
        .eq('log_date', logDate)
        .maybeSingle()
      return data
    },
    enabled: !!clientId && !!logDate,
  })
}

function useClientBuildings(clientId) {
  return useQuery({
    queryKey: ['buildings', clientId],
    queryFn: async () => {
      if (!clientId) return []
      const { data } = await supabase
        .from('laundry_buildings')
        .select('id, name, bag_color, reject_pct')
        .eq('client_id', clientId)
        .eq('active', true)
        .order('name')
      return data || []
    },
    enabled: !!clientId,
  })
}

// All logs for this client on this date (to compute facility-wide totals for distribution)
function useDayLogs(clientId, logDate) {
  return useQuery({
    queryKey: ['day-logs', clientId, logDate],
    queryFn: async () => {
      if (!clientId || !logDate) return []
      const { data } = await supabase
        .from('laundry_logs')
        .select('id, building_id, laundry_buildings(name, reject_pct), laundry_log_rows(*)')
        .eq('client_id', clientId)
        .eq('log_date', logDate)
      return data || []
    },
    enabled: !!clientId && !!logDate,
  })
}

// ─── Editable number cell ──────────────────────────────────────
function NumCell({ value, onChange, field }) {
  return (
    <input
      type="number" min="0"
      className="input-number w-20 text-sm"
      value={value || ''}
      placeholder="0"
      onChange={e => onChange(field, parseInt(e.target.value) || 0)}
    />
  )
}

// ─── Productivity panel ────────────────────────────────────────
function ProductivityPanel({ extras, client, totalGowns }) {
  const sh = parseFloat(extras?.shift_hours) || 0
  const sc = parseInt(extras?.staff_on_shift) || parseInt(client?.staff_count) || 3
  const tr = parseInt(client?.target_gowns_per_hour) || 60

  const hasShiftData    = sh > 0
  const actualRate      = hasShiftData && sc > 0 ? Math.round(totalGowns / sh / sc) : null
  const expectedHours   = sc > 0 && tr > 0 && totalGowns > 0 ? (totalGowns / (sc * tr)).toFixed(1) : null
  const efficiency      = actualRate ? Math.round((actualRate / tr) * 100) : null
  const isGood          = (efficiency || 0) >= 100
  const isOk            = (efficiency || 0) >= 80

  const colourClass = isGood
    ? 'bg-green-50 border-green-200'
    : isOk
    ? 'bg-amber-50 border-amber-200'
    : 'bg-red-50 border-red-200'

  const indicatorColour = isGood ? 'text-green-600' : isOk ? 'text-amber-500' : 'text-red-500'

  return (
    <div className={`card overflow-hidden border ${hasShiftData ? colourClass : 'border-gray-200'}`}>
      <div className="px-5 py-4 border-b border-inherit flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className={hasShiftData ? indicatorColour : 'text-gray-400'} />
          <h2 className="font-semibold text-gray-800">Productivity</h2>
        </div>
        {efficiency !== null && (
          <span className={`text-lg font-bold ${indicatorColour}`}>{efficiency}%</span>
        )}
      </div>
      <div className="p-5">
        {/* Shift inputs row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          {[
            { icon: Users,  label: 'Staff on Shift', value: extras?.staff_on_shift ?? sc,   sub: `Default: ${client?.staff_count || 3}` },
            { icon: Clock,  label: 'Hours Worked',   value: sh ? `${sh} hrs` : '—',         sub: 'Actual shift length' },
            { icon: TrendingUp, label: 'Target Rate', value: `${tr}/hr`,                     sub: 'Per person' },
            { icon: TrendingUp, label: 'Actual Rate', value: actualRate ? `${actualRate}/hr` : '—', sub: 'Per person' },
          ].map(({ icon: Icon, label, value, sub }) => (
            <div key={label} className="text-center">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">{label}</p>
              <p className="text-xl font-bold text-gray-900 mt-0.5">{value}</p>
              <p className="text-xs text-gray-400">{sub}</p>
            </div>
          ))}
        </div>

        {hasShiftData && (
          <>
            {/* Efficiency bar */}
            <div className="mb-3">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Efficiency vs target</span>
                <span className={`font-bold ${indicatorColour}`}>{efficiency}%</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${isGood ? 'bg-green-500' : isOk ? 'bg-amber-400' : 'bg-red-400'}`}
                  style={{ width: `${Math.min(efficiency || 0, 100)}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                <p className="text-xs text-gray-500">Expected hours</p>
                <p className="text-lg font-bold text-navy-700">{expectedHours} hrs</p>
                <p className="text-xs text-gray-400">at {sc} staff × {tr} gowns/hr</p>
              </div>
              <div className={`rounded-xl border p-3 text-center ${isGood ? 'bg-green-50 border-green-200' : isOk ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
                <p className="text-xs text-gray-500">Actual hours</p>
                <p className={`text-lg font-bold ${isGood ? 'text-green-700' : isOk ? 'text-amber-700' : 'text-red-700'}`}>{sh} hrs</p>
                <p className="text-xs text-gray-400">{sh > expectedHours ? 'Took longer than expected' : sh < expectedHours ? 'Faster than expected 🎉' : 'On target'}</p>
              </div>
            </div>
          </>
        )}

        {!hasShiftData && (
          <p className="text-sm text-gray-400 text-center py-2">
            No shift hours recorded for this day. Staff can add shift details when submitting.
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Reject distribution panel ─────────────────────────────────
function DistributionPanel({ dayLogs, buildings, extras }) {
  // Compute facility-wide totals for the day across all buildings
  const allRows = dayLogs.flatMap(l => l.laundry_log_rows || [])
  const totalRejects = allRows.reduce((s, r) => s + (r.ink_stain || 0) + (r.large_holes || 0), 0)
  const totalRepairs = allRows.reduce((s, r) => s + (r.to_repair || 0), 0)

  const extraRepairTotal = extras
    ? (extras.labelling || 0) + (extras.sleeve_repair || 0) + (extras.general_repair || 0) + (extras.fp_inject || 0)
    : 0

  const hasPct     = buildings.some(b => parseFloat(b.reject_pct) > 0)
  const totalPct   = buildings.reduce((s, b) => s + (parseFloat(b.reject_pct) || 0), 0)

  if (!hasPct) return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-2">
        <Percent size={16} className="text-gray-400" />
        <h2 className="font-semibold text-gray-800">Reject & Repair Distribution</h2>
      </div>
      <p className="text-sm text-gray-400">
        No distribution percentages set. Go to Admin → Clients → [Client] → edit each building to set reject %.
      </p>
    </div>
  )

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Percent size={16} className="text-purple-600" />
          <h2 className="font-semibold text-gray-800">Reject &amp; Repair Distribution — Facility Day Total</h2>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${Math.abs(totalPct - 100) < 0.5 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
          {totalPct.toFixed(0)}% assigned
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="table-header">Building</th>
              <th className="table-header text-right">Share %</th>
              <th className="table-header text-right text-red-600">Rejects ({totalRejects})</th>
              <th className="table-header text-right text-amber-600">Repairs ({totalRepairs})</th>
              <th className="table-header text-right text-purple-600">Process Jobs ({extraRepairTotal})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {buildings.map(b => {
              const pct       = parseFloat(b.reject_pct) || 0
              const rejShare  = Math.round(totalRejects   * pct / 100)
              const repShare  = Math.round(totalRepairs   * pct / 100)
              const procShare = Math.round(extraRepairTotal * pct / 100)
              return (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="table-cell font-medium text-gray-900">{b.name}</td>
                  <td className="table-cell text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-purple-400 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <span className="text-sm font-bold text-purple-700 w-10 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="table-cell text-right font-semibold text-red-600">{rejShare || '—'}</td>
                  <td className="table-cell text-right font-semibold text-amber-600">{repShare || '—'}</td>
                  <td className="table-cell text-right font-semibold text-purple-700">{procShare || '—'}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-navy-50">
            <tr className="font-semibold">
              <td className="table-cell font-bold text-navy-800">FACILITY TOTAL</td>
              <td className="table-cell text-right text-navy-700">{totalPct.toFixed(0)}%</td>
              <td className="table-cell text-right text-red-700">{totalRejects || '—'}</td>
              <td className="table-cell text-right text-amber-700">{totalRepairs || '—'}</td>
              <td className="table-cell text-right text-purple-800">{extraRepairTotal || '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────
export default function AdminLogDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: log, isLoading } = useLog(id)
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState(null)

  const clientId  = log?.laundry_clients?.id
  const logDate   = log?.log_date

  const { data: extras }        = useDailyExtras(clientId, logDate)
  const { data: buildings = [] } = useClientBuildings(clientId)
  const { data: dayLogs = [] }   = useDayLogs(clientId, logDate)
  const { data: submitter }      = useSubmitterProfile(log?.submitted_by)

  function startEdit() {
    setRows(
      SIZES.map(size => {
        const existing = log.laundry_log_rows.find(r => r.size_label === size)
        return {
          size_label:  size,
          blue_gowns:  existing?.blue_gowns  || 0,
          white_gowns: existing?.white_gowns || 0,
          grey_gowns:  existing?.grey_gowns  || 0,
          ink_stain:   existing?.ink_stain   || 0,
          large_holes: existing?.large_holes || 0,
          to_repair:   existing?.to_repair   || 0,
        }
      })
    )
    setEditing(true)
  }

  function updateRow(idx, field, value) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      await supabase.from('laundry_log_rows').delete().eq('log_id', id)
      const inserts = rows
        .filter(r => r.blue_gowns > 0 || r.white_gowns > 0 || r.grey_gowns > 0 || r.ink_stain > 0 || r.large_holes > 0 || r.to_repair > 0)
        .map((r, i) => ({
          ...r,
          qty_packed: (r.blue_gowns || 0) + (r.white_gowns || 0) + (r.grey_gowns || 0),
          log_id: id,
          sort_order: i,
        }))
      if (inserts.length) {
        const { error } = await supabase.from('laundry_log_rows').insert(inserts)
        if (error) throw error
      }
      const total = rows.reduce((s, r) => s + (r.blue_gowns || 0) + (r.white_gowns || 0) + (r.grey_gowns || 0), 0)
      await supabase.from('laundry_logs').update({ total_packed: total, updated_at: new Date().toISOString() }).eq('id', id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['log', id] })
      toast.success('Log updated')
      setEditing(false)
    },
    onError: err => toast.error(err.message),
  })

  const markReviewed = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('laundry_logs').update({ status: 'reviewed' }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['log', id] })
      toast.success('Marked as reviewed')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('laundry_logs').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Log deleted')
      navigate('/admin/logs')
    },
  })

  if (isLoading) return (
    <div className="p-6 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-64 mb-4" />
      <div className="h-96 bg-gray-200 rounded-xl" />
    </div>
  )
  if (!log) return <div className="p-6"><p className="text-gray-500">Log not found</p></div>

  const displayRows = editing ? rows : SIZES.map(size => {
    const r = log.laundry_log_rows?.find(r => r.size_label === size)
    return {
      size_label:  size,
      blue_gowns:  r?.blue_gowns  || 0,
      white_gowns: r?.white_gowns || 0,
      grey_gowns:  r?.grey_gowns  || 0,
      ink_stain:   r?.ink_stain   || 0,
      large_holes: r?.large_holes || 0,
      to_repair:   r?.to_repair   || 0,
    }
  })

  const totalBlue    = displayRows.reduce((s, r) => s + r.blue_gowns, 0)
  const totalWhite   = displayRows.reduce((s, r) => s + r.white_gowns, 0)
  const totalGrey    = displayRows.reduce((s, r) => s + r.grey_gowns, 0)
  const totalPacked  = totalBlue + totalWhite + totalGrey
  const totalInk     = displayRows.reduce((s, r) => s + r.ink_stain, 0)
  const totalHoles   = displayRows.reduce((s, r) => s + r.large_holes, 0)
  const totalRepairs = displayRows.reduce((s, r) => s + r.to_repair, 0)
  const totalRejects = totalInk + totalHoles

  const bagCounts     = extras?.bag_counts || {}
  const extraRepairs  = extras ? [
    { label: 'Labelling',     value: extras.labelling      || 0 },
    { label: 'Sleeve Repair', value: extras.sleeve_repair  || 0 },
    { label: 'General Repair',value: extras.general_repair || 0 },
    { label: 'F&P to Inject', value: extras.fp_inject      || 0 },
  ] : []
  const totalExtraRepairs = extraRepairs.reduce((s, r) => s + r.value, 0)

  const client = log.laundry_clients

  return (
    <div className="p-6 space-y-6">
      {/* Back */}
      <Link to="/admin/logs" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-navy-600 transition-colors">
        <ArrowLeft size={15} /> Back to Logs
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {client?.name} — {log.laundry_buildings?.name}
          </h1>
          <p className="text-gray-500 mt-0.5">
            {format(new Date(log.log_date), 'EEEE, d MMMM yyyy')}
            &nbsp;·&nbsp;Submitted by {submitter?.full_name || submitter?.email || 'Unknown'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={log.status === 'reviewed' ? 'badge-green' : log.status === 'submitted' ? 'badge-blue' : 'badge-gray'}>
            {log.status}
          </span>
          {log.status !== 'reviewed' && (
            <button onClick={() => markReviewed.mutate()} className="btn-gold btn-sm" disabled={markReviewed.isPending}>
              <CheckCircle size={14} /> Mark Reviewed
            </button>
          )}
          {!editing && (
            <button onClick={startEdit} className="btn-secondary btn-sm">
              <Pencil size={14} /> Edit
            </button>
          )}
          {editing && (
            <>
              <button onClick={() => saveMutation.mutate()} className="btn-primary btn-sm" disabled={saveMutation.isPending}>
                <Save size={14} /> {saveMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)} className="btn-secondary btn-sm">Cancel</button>
            </>
          )}
          <button
            onClick={() => { if (confirm('Delete this log entry?')) deleteMutation.mutate() }}
            className="btn-danger btn-sm"
            disabled={deleteMutation.isPending}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Total Gowns',   value: totalPacked.toLocaleString(), cls: 'text-navy-700' },
          { label: 'Blue',          value: totalBlue,    cls: 'text-blue-600'   },
          { label: 'White',         value: totalWhite,   cls: 'text-gray-700'   },
          { label: 'Grey',          value: totalGrey,    cls: 'text-gray-500'   },
          { label: 'Rejects',       value: totalRejects, cls: 'text-red-600'    },
          { label: 'To Repair',     value: totalRepairs, cls: 'text-amber-600'  },
          { label: 'Process Jobs',  value: totalExtraRepairs, cls: 'text-purple-600' },
        ].map(({ label, value, cls }) => (
          <div key={label} className="card p-3 text-center">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${cls}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Gown Breakdown Table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Gown Breakdown by Size — {log.laundry_buildings?.name}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-header">Size</th>
                <th className="table-header text-right text-blue-700">Blue</th>
                <th className="table-header text-right text-gray-600">White</th>
                <th className="table-header text-right text-gray-500">Grey</th>
                <th className="table-header text-right">Total</th>
                <th className="table-header text-right text-red-600">Ink Stain</th>
                <th className="table-header text-right text-orange-600">Holes</th>
                <th className="table-header text-right text-amber-600">Repair</th>
                <th className="table-header text-right text-red-700">Rejects</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {displayRows.map((row, idx) => {
                const total   = row.blue_gowns + row.white_gowns + row.grey_gowns
                const rejects = row.ink_stain + row.large_holes
                return (
                  <tr key={row.size_label} className="hover:bg-gray-50">
                    <td className="table-cell">
                      <span className="badge badge-blue font-bold">{row.size_label}</span>
                    </td>
                    {editing ? (
                      <>
                        <td className="table-cell text-right"><NumCell value={row.blue_gowns}  onChange={(f,v) => updateRow(idx, f, v)} field="blue_gowns" /></td>
                        <td className="table-cell text-right"><NumCell value={row.white_gowns} onChange={(f,v) => updateRow(idx, f, v)} field="white_gowns" /></td>
                        <td className="table-cell text-right"><NumCell value={row.grey_gowns}  onChange={(f,v) => updateRow(idx, f, v)} field="grey_gowns" /></td>
                        <td className="table-cell text-right font-semibold text-navy-700">{total || '—'}</td>
                        <td className="table-cell text-right"><NumCell value={row.ink_stain}   onChange={(f,v) => updateRow(idx, f, v)} field="ink_stain" /></td>
                        <td className="table-cell text-right"><NumCell value={row.large_holes} onChange={(f,v) => updateRow(idx, f, v)} field="large_holes" /></td>
                        <td className="table-cell text-right"><NumCell value={row.to_repair}   onChange={(f,v) => updateRow(idx, f, v)} field="to_repair" /></td>
                        <td className="table-cell text-right text-red-600 font-semibold">{rejects || '—'}</td>
                      </>
                    ) : (
                      <>
                        <td className="table-cell text-right text-blue-700 font-medium">{row.blue_gowns || '—'}</td>
                        <td className="table-cell text-right text-gray-600">{row.white_gowns || '—'}</td>
                        <td className="table-cell text-right text-gray-500">{row.grey_gowns || '—'}</td>
                        <td className="table-cell text-right font-semibold text-navy-700">{total || '—'}</td>
                        <td className="table-cell text-right text-red-600">{row.ink_stain || '—'}</td>
                        <td className="table-cell text-right text-orange-600">{row.large_holes || '—'}</td>
                        <td className="table-cell text-right text-amber-600">{row.to_repair || '—'}</td>
                        <td className="table-cell text-right text-red-700 font-semibold">{rejects || '—'}</td>
                      </>
                    )}
                  </tr>
                )
              })}
              <tr className="bg-navy-50 font-semibold">
                <td className="table-cell font-bold text-navy-800">TOTALS</td>
                <td className="table-cell text-right text-blue-700">{totalBlue || '—'}</td>
                <td className="table-cell text-right text-gray-700">{totalWhite || '—'}</td>
                <td className="table-cell text-right text-gray-500">{totalGrey || '—'}</td>
                <td className="table-cell text-right text-navy-700">{totalPacked.toLocaleString()}</td>
                <td className="table-cell text-right text-red-600">{totalInk || '—'}</td>
                <td className="table-cell text-right text-orange-600">{totalHoles || '—'}</td>
                <td className="table-cell text-right text-amber-600">{totalRepairs || '—'}</td>
                <td className="table-cell text-right text-red-700">{totalRejects || '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Productivity Panel */}
      <ProductivityPanel extras={extras} client={client} totalGowns={totalPacked} />

      {/* Daily Extras: Bags + Process/Repairs */}
      {extras && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Bags per Building */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Package size={16} className="text-gray-500" />
              <h2 className="font-semibold text-gray-800">Bag Quantities</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {buildings.map(b => {
                const count = bagCounts[b.id] || 0
                return (
                  <div key={b.id} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">{b.name}</span>
                      {b.bag_color && (
                        <span className="text-xs text-gray-400 font-medium">({b.bag_color} bag)</span>
                      )}
                    </div>
                    <span className={`text-lg font-bold ${count > 0 ? 'text-navy-700' : 'text-gray-300'}`}>
                      {count || '—'}
                    </span>
                  </div>
                )
              })}
              {buildings.length === 0 && (
                <p className="px-5 py-4 text-sm text-gray-400">No buildings found</p>
              )}
            </div>
          </div>

          {/* Process & Repairs */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Wrench size={16} className="text-gray-500" />
              <h2 className="font-semibold text-gray-800">Process &amp; Repairs</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {extraRepairs.map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm font-medium text-gray-800">{label}</span>
                  <span className={`text-lg font-bold ${value > 0 ? 'text-purple-700' : 'text-gray-300'}`}>
                    {value || '—'}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between px-5 py-3 bg-gray-50">
                <span className="text-sm font-bold text-gray-700">Total Process Jobs</span>
                <span className="text-lg font-bold text-purple-700">{totalExtraRepairs || '—'}</span>
              </div>
            </div>
            {extras.notes && (
              <div className="px-5 py-4 border-t border-gray-100">
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">{extras.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Roster Hours for this date */}
      <RosterHoursWidget mode="date" date={logDate} />

      {/* Reject Distribution Panel */}
      {dayLogs.length > 0 && buildings.length > 0 && (
        <DistributionPanel dayLogs={dayLogs} buildings={buildings} extras={extras} />
      )}

      {/* Log-level notes */}
      {log.notes && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Notes</h3>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{log.notes}</p>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Log ID: {log.id} · Created: {format(new Date(log.created_at), 'dd MMM yyyy HH:mm')}
        {log.updated_at !== log.created_at && ` · Updated: ${format(new Date(log.updated_at), 'dd MMM yyyy HH:mm')}`}
      </p>
    </div>
  )
}
