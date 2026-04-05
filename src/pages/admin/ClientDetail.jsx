import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  ArrowLeft, Plus, Building2, Pencil, Trash2,
  ToggleRight, ToggleLeft, Zap, Save, Percent,
} from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { format } from 'date-fns'

function useClientDetail(id) {
  return useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const [clientRes, buildingsRes, logsRes] = await Promise.all([
        supabase.from('laundry_clients').select('*').eq('id', id).single(),
        supabase.from('laundry_buildings').select('*').eq('client_id', id).order('sort_order').order('name'),
        supabase.from('laundry_logs')
          .select('id, log_date, status, laundry_buildings(name), laundry_log_rows(*)')
          .eq('client_id', id)
          .order('log_date', { ascending: false })
          .limit(20),
      ])
      return {
        client: clientRes.data,
        buildings: buildingsRes.data || [],
        logs: logsRes.data || [],
      }
    },
    enabled: !!id,
  })
}

// ── Building form ─────────────────────────────────────────────
function BuildingForm({ building, clientId, onClose }) {
  const qc = useQueryClient()
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: building || { sort_order: 0, bag_color: '', reject_pct: 0 },
  })

  const mutation = useMutation({
    mutationFn: async (values) => {
      const payload = {
        name:        values.name,
        description: values.description,
        bag_color:   values.bag_color,
        reject_pct:  parseFloat(values.reject_pct) || 0,
        sort_order:  parseInt(values.sort_order) || 0,
      }
      if (building?.id) {
        const { error } = await supabase.from('laundry_buildings').update(payload).eq('id', building.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('laundry_buildings').insert({ ...payload, client_id: clientId })
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client', clientId] })
      toast.success(building ? 'Building updated' : 'Building added')
      onClose()
    },
    onError: err => toast.error(err.message),
  })

  return (
    <form onSubmit={handleSubmit(v => mutation.mutate(v))} className="space-y-4">
      <div>
        <label className="label">Building Name *</label>
        <input className="input" placeholder="e.g. Paykel Building" {...register('name', { required: 'Required' })} />
        {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
      </div>
      <div>
        <label className="label">Description</label>
        <input className="input" placeholder="Optional description or notes" {...register('description')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Bag Colour</label>
          <input className="input" placeholder="e.g. Black, Red, Blue" {...register('bag_color')} />
        </div>
        <div>
          <label className="label">Sort Order</label>
          <input className="input" type="number" {...register('sort_order', { valueAsNumber: true })} />
        </div>
      </div>
      <div>
        <label className="label flex items-center gap-1.5">
          <Percent size={13} className="text-purple-500" />
          Reject / Repair Distribution %
        </label>
        <input
          className="input"
          type="number"
          min="0"
          max="100"
          step="0.1"
          placeholder="e.g. 50 for 50%"
          {...register('reject_pct')}
        />
        <p className="text-xs text-gray-400 mt-1">
          The % of total daily rejects &amp; process repairs attributed to this building. All buildings should sum to 100%.
        </p>
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" disabled={mutation.isPending} className="btn-primary">
          {mutation.isPending ? 'Saving…' : building ? 'Update Building' : 'Add Building'}
        </button>
      </div>
    </form>
  )
}

// ── Productivity Settings ─────────────────────────────────────
function ProductivitySettings({ client, clientId }) {
  const qc = useQueryClient()
  const [staffCount, setStaffCount]             = useState(client?.staff_count ?? 3)
  const [targetGowns, setTargetGowns]           = useState(client?.target_gowns_per_hour ?? 60)

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('laundry_clients').update({
        staff_count: parseInt(staffCount) || 3,
        target_gowns_per_hour: parseInt(targetGowns) || 60,
      }).eq('id', clientId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client', clientId] })
      toast.success('Productivity settings saved')
    },
    onError: err => toast.error(err.message),
  })

  const expectedHourly = (parseInt(staffCount) || 1) * (parseInt(targetGowns) || 60)

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
        <Zap size={16} className="text-gold-600" />
        <h2 className="font-semibold text-gray-800">Productivity Settings</h2>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Default Staff Count</label>
            <input
              type="number" min="1" max="50"
              className="input"
              value={staffCount}
              onChange={e => setStaffCount(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">Typical number of staff per shift</p>
          </div>
          <div>
            <label className="label">Target Gowns / Hour / Person</label>
            <input
              type="number" min="1" max="500"
              className="input"
              value={targetGowns}
              onChange={e => setTargetGowns(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">Expected output per staff member per hour</p>
          </div>
        </div>

        {/* Live preview */}
        <div className="bg-navy-50 rounded-xl p-4 text-sm space-y-1 border border-navy-100">
          <p className="text-xs font-semibold text-navy-600 uppercase tracking-wide mb-2">Target Calculation Preview</p>
          <div className="flex justify-between">
            <span className="text-gray-600">{staffCount} staff × {targetGowns} gowns/hr</span>
            <span className="font-bold text-navy-700">{expectedHourly.toLocaleString()} gowns/hr total</span>
          </div>
          <div className="flex justify-between text-gray-500">
            <span>8-hour shift target</span>
            <span className="font-semibold">{(expectedHourly * 8).toLocaleString()} gowns</span>
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="btn-gold">
            <Save size={14} /> {saveMutation.isPending ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────
export default function AdminClientDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { data, isLoading } = useClientDetail(id)
  const [bldgModal, setBldgModal] = useState(false)
  const [editingBldg, setEditingBldg] = useState(null)

  async function toggleBuilding(b) {
    const { error } = await supabase.from('laundry_buildings').update({ active: !b.active }).eq('id', b.id)
    if (error) toast.error(error.message)
    else {
      qc.invalidateQueries({ queryKey: ['client', id] })
      toast.success(`Building ${b.active ? 'deactivated' : 'activated'}`)
    }
  }

  async function deleteBuilding(b) {
    if (!confirm(`Delete "${b.name}"? This will also delete all logs for this building.`)) return
    const { error } = await supabase.from('laundry_buildings').delete().eq('id', b.id)
    if (error) toast.error(error.message)
    else {
      qc.invalidateQueries({ queryKey: ['client', id] })
      toast.success('Building deleted')
    }
  }

  if (isLoading) return <div className="p-6 animate-pulse"><div className="h-8 w-48 bg-gray-200 rounded mb-4" /><div className="h-64 bg-gray-200 rounded-xl" /></div>

  const { client, buildings, logs } = data || {}

  // Total reject_pct across all buildings
  const totalPct = buildings?.reduce((s, b) => s + (parseFloat(b.reject_pct) || 0), 0) || 0

  return (
    <div className="p-6 space-y-6">
      {/* Breadcrumb */}
      <div>
        <Link to="/admin/clients" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-navy-600 transition-colors mb-3">
          <ArrowLeft size={15} /> Back to Clients
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{client?.name}</h1>
            <div className="flex flex-wrap gap-3 mt-1 text-sm text-gray-500">
              {client?.contact_name  && <span>{client.contact_name}</span>}
              {client?.contact_phone && <span>· {client.contact_phone}</span>}
              {client?.contact_email && <span>· {client.contact_email}</span>}
              {client?.address       && <span>· {client.address}</span>}
            </div>
          </div>
          <span className={client?.active ? 'badge-green' : 'badge-gray'}>{client?.active ? 'Active' : 'Inactive'}</span>
        </div>
      </div>

      {/* Buildings */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 size={16} />
            <h2 className="font-semibold text-gray-800">Buildings ({buildings?.length})</h2>
            {totalPct > 0 && totalPct !== 100 && (
              <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">
                Distribution = {totalPct.toFixed(0)}% (should be 100%)
              </span>
            )}
            {totalPct === 100 && (
              <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full">
                Distribution = 100% ✓
              </span>
            )}
          </div>
          <button
            onClick={() => { setEditingBldg(null); setBldgModal(true) }}
            className="btn-primary btn-sm"
          >
            <Plus size={14} /> Add Building
          </button>
        </div>
        <div className="divide-y divide-gray-50">
          {buildings?.map(b => (
            <div key={b.id} className={`flex items-center gap-4 px-5 py-3 ${!b.active ? 'opacity-60' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 text-sm">{b.name}</p>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                  {b.bag_color && <span>{b.bag_color} bags</span>}
                  {parseFloat(b.reject_pct) > 0 && (
                    <span className="flex items-center gap-0.5 text-purple-600 font-semibold">
                      <Percent size={10} />{parseFloat(b.reject_pct).toFixed(0)} distribution
                    </span>
                  )}
                  {b.description && <span>{b.description}</span>}
                </div>
                {/* Distribution bar */}
                {parseFloat(b.reject_pct) > 0 && (
                  <div className="mt-1 h-1.5 bg-gray-100 rounded-full w-40 overflow-hidden">
                    <div className="h-full bg-purple-400 rounded-full" style={{ width: `${Math.min(parseFloat(b.reject_pct), 100)}%` }} />
                  </div>
                )}
              </div>
              <span className={b.active ? 'badge-green' : 'badge-gray'}>{b.active ? 'Active' : 'Inactive'}</span>
              <div className="flex items-center gap-1.5">
                <button onClick={() => toggleBuilding(b)} className="btn-secondary btn-sm p-1.5">
                  {b.active ? <ToggleRight size={15} className="text-green-600" /> : <ToggleLeft size={15} />}
                </button>
                <button onClick={() => { setEditingBldg(b); setBldgModal(true) }} className="btn-secondary btn-sm p-1.5">
                  <Pencil size={14} />
                </button>
                <button onClick={() => deleteBuilding(b)} className="btn-danger btn-sm p-1.5">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {buildings?.length === 0 && (
            <p className="text-center text-gray-400 text-sm py-8">No buildings yet — add one above</p>
          )}
        </div>
      </div>

      {/* Productivity Settings */}
      {client && <ProductivitySettings client={client} clientId={id} />}

      {/* Recent Logs */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Recent Log Entries</h2>
          <Link to={`/admin/logs?client=${id}`} className="text-xs text-navy-600 hover:underline">View all →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-header">Date</th>
                <th className="table-header">Building</th>
                <th className="table-header text-right">Packed</th>
                <th className="table-header text-right">Rejects</th>
                <th className="table-header text-right">Repairs</th>
                <th className="table-header">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {logs?.map(log => {
                const rows = log.laundry_log_rows || []
                const p   = rows.reduce((s, r) => s + (r.qty_packed || 0), 0)
                const rej = rows.reduce((s, r) => s + (r.ink_stain || 0) + (r.large_holes || 0), 0)
                const rep = rows.reduce((s, r) => s + (r.to_repair || 0), 0)
                return (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="table-cell font-medium">{format(new Date(log.log_date), 'dd MMM yyyy')}</td>
                    <td className="table-cell">{log.laundry_buildings?.name}</td>
                    <td className="table-cell text-right font-semibold">{p.toLocaleString()}</td>
                    <td className="table-cell text-right text-red-600">{rej || '—'}</td>
                    <td className="table-cell text-right text-amber-600">{rep || '—'}</td>
                    <td className="table-cell">
                      <Link to={`/admin/logs/${log.id}`} className="text-xs text-navy-600 hover:underline">
                        {log.status} →
                      </Link>
                    </td>
                  </tr>
                )
              })}
              {!logs?.length && (
                <tr><td colSpan={6} className="table-cell text-center text-gray-400 py-6">No logs yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Building Modal */}
      <Modal
        open={bldgModal}
        onClose={() => setBldgModal(false)}
        title={editingBldg ? `Edit Building — ${editingBldg.name}` : 'Add Building'}
      >
        <BuildingForm
          building={editingBldg}
          clientId={id}
          onClose={() => setBldgModal(false)}
        />
      </Modal>
    </div>
  )
}
