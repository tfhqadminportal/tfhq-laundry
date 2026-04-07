import { useState, useMemo, Fragment } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  format, startOfMonth, getISOWeek, parseISO,
} from 'date-fns'
import {
  Calculator, ClipboardList, DollarSign, Plus, Pencil, Trash2,
  FileDown, Building2, AlertCircle, Package,
} from 'lucide-react'
import Modal from '@/components/ui/Modal'
import toast from 'react-hot-toast'

// ─── Helpers ───────────────────────────────────────────────────

function calcPacked(rows) {
  return rows.reduce((s, r) => {
    const fromColors = (r.blue_gowns || 0) + (r.white_gowns || 0) + (r.grey_gowns || 0)
    return s + (fromColors || r.qty_packed || 0)
  }, 0)
}

function fmtN(n) {
  return n ? n.toLocaleString() : '—'
}

function fmtMoney(n) {
  return `$${Number(n).toFixed(2)}`
}

// ─── Data hooks ────────────────────────────────────────────────

function useClients() {
  return useQuery({
    queryKey: ['clients-accounts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('laundry_clients')
        .select('id, name')
        .eq('active', true)
        .order('name')
      return data || []
    },
  })
}

function useBuildings(clientId) {
  return useQuery({
    queryKey: ['buildings-accounts', clientId],
    queryFn: async () => {
      if (!clientId) return []
      const { data } = await supabase
        .from('laundry_buildings')
        .select('id, name, bag_color, reject_pct')
        .eq('client_id', clientId)
        .eq('active', true)
        .order('sort_order')
      return data || []
    },
    enabled: !!clientId,
  })
}

function useProcessingLogs(filters) {
  return useQuery({
    queryKey: ['accounts-logs', filters],
    queryFn: async () => {
      let q = supabase
        .from('laundry_logs')
        .select(`
          id, log_date, client_id, building_id,
          laundry_clients(id, name),
          laundry_buildings(id, name, bag_color),
          laundry_log_rows(
            blue_gowns, white_gowns, grey_gowns,
            qty_packed, ink_stain, large_holes, to_repair
          )
        `)
        .gte('log_date', filters.from)
        .lte('log_date', filters.to)
        .order('log_date')

      if (filters.client) q = q.eq('client_id', filters.client)

      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })
}

function useDailyExtras(filters) {
  return useQuery({
    queryKey: ['accounts-extras', filters],
    queryFn: async () => {
      let q = supabase
        .from('laundry_daily_extras')
        .select('client_id, log_date, labelling, sleeve_repair, general_repair, fp_inject, bag_counts')
        .gte('log_date', filters.from)
        .lte('log_date', filters.to)
        .order('log_date')

      if (filters.client) q = q.eq('client_id', filters.client)

      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })
}

function usePricingItems() {
  return useQuery({
    queryKey: ['pricing-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('laundry_pricing_items')
        .select('*')
        .order('sort_order')
      if (error) throw error
      return data || []
    },
  })
}

// ─── PROCESSING LOG TAB ────────────────────────────────────────

function ProcessingLog() {
  const today      = format(new Date(), 'yyyy-MM-dd')
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')

  const [filters, setFilters] = useState({
    from:   monthStart,
    to:     today,
    client: '',
  })

  const { data: clients = [] }                       = useClients()
  const { data: buildings = [] }                     = useBuildings(filters.client)
  const { data: logs = [], isLoading, error }        = useProcessingLogs(filters)
  const { data: extras = [] }                        = useDailyExtras(filters)

  // ── Aggregate logs by date → building ──────────────────────
  const byDate = useMemo(() => {
    const map = {}
    logs.forEach(log => {
      const d = log.log_date
      if (!map[d]) map[d] = { date: d, buildings: [] }
      const rows    = log.laundry_log_rows || []
      const packed  = calcPacked(rows)
      const ink     = rows.reduce((s, r) => s + (r.ink_stain   || 0), 0)
      const holes   = rows.reduce((s, r) => s + (r.large_holes || 0), 0)
      const repairs = rows.reduce((s, r) => s + (r.to_repair   || 0), 0)
      map[d].buildings.push({
        id:       log.building_id,
        name:     log.laundry_buildings?.name || '—',
        bagColor: log.laundry_buildings?.bag_color || '',
        packed, ink, holes, repairs,
        total: packed + ink + holes + repairs,
      })
    })
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date))
  }, [logs])

  // ── Group dates into ISO-week buckets ──────────────────────
  const weeklyGroups = useMemo(() => {
    const groups = {}
    byDate.forEach(d => {
      const wk = getISOWeek(parseISO(d.date))
      if (!groups[wk]) groups[wk] = []
      groups[wk].push(d)
    })
    return groups
  }, [byDate])

  const weekNums = Object.keys(weeklyGroups).map(Number).sort()

  // ── Weekly totals ──────────────────────────────────────────
  const weekTotals = useMemo(() => {
    const t = {}
    Object.entries(weeklyGroups).forEach(([wk, days]) => {
      t[wk] = { packed: 0, ink: 0, holes: 0, repairs: 0, total: 0 }
      days.forEach(d => d.buildings.forEach(b => {
        t[wk].packed  += b.packed
        t[wk].ink     += b.ink
        t[wk].holes   += b.holes
        t[wk].repairs += b.repairs
        t[wk].total   += b.total
      }))
    })
    return t
  }, [weeklyGroups])

  // ── Extras grouped by ISO week (for per-building split) ───
  const weekExtras = useMemo(() => {
    const t = {}
    extras.forEach(e => {
      const wk = getISOWeek(parseISO(e.log_date))
      if (!t[wk]) t[wk] = { labelling: 0, general: 0 }
      t[wk].labelling += e.labelling      || 0
      t[wk].general   += e.general_repair || 0
    })
    return t
  }, [extras])

  // ── Grand total ────────────────────────────────────────────
  const grand = useMemo(() => byDate.reduce((acc, d) => {
    d.buildings.forEach(b => {
      acc.packed  += b.packed
      acc.ink     += b.ink
      acc.holes   += b.holes
      acc.repairs += b.repairs
      acc.total   += b.total
    })
    return acc
  }, { packed: 0, ink: 0, holes: 0, repairs: 0, total: 0 }), [byDate])

  // ── Extras totals ──────────────────────────────────────────
  const extrasTotals = useMemo(() => extras.reduce((acc, e) => {
    acc.labelling += e.labelling     || 0
    acc.sleeve    += e.sleeve_repair || 0
    acc.general   += e.general_repair || 0
    acc.fpInject  += e.fp_inject     || 0
    return acc
  }, { labelling: 0, sleeve: 0, general: 0, fpInject: 0 }), [extras])

  return (
    <div className="space-y-5">
      {/* ── Filters ── */}
      <div className="card p-4">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
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
          <div className="col-span-2 lg:col-span-1">
            <label className="label">Client</label>
            <select className="input" value={filters.client}
              onChange={e => setFilters(f => ({ ...f, client: e.target.value }))}>
              <option value="">All Clients</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ── KPI Summary ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Packed',      value: grand.packed.toLocaleString(),               cls: 'text-navy-700' },
          { label: 'Ink Stain + Holes', value: (grand.ink + grand.holes).toLocaleString(),  cls: 'text-red-600' },
          { label: 'To Repair',         value: grand.repairs.toLocaleString(),               cls: 'text-amber-600' },
          { label: 'Total Laundered',   value: grand.total.toLocaleString(),                 cls: 'text-green-700' },
        ].map(({ label, value, cls }) => (
          <div key={label} className="card p-4 text-center">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${cls}`}>{value}</p>
          </div>
        ))}
      </div>

      {isLoading && (
        <div className="card p-10 text-center text-gray-400 animate-pulse">Loading data…</div>
      )}

      {error && (
        <div className="card p-5 flex items-start gap-3 bg-red-50 border border-red-200">
          <AlertCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{error.message}</p>
        </div>
      )}

      {!isLoading && !error && (
        <>
          {/* ── Weekly tables ── */}
          {weekNums.map((wk, wi) => {
            const days    = weeklyGroups[wk]
            const tot     = weekTotals[wk]
            const sorted  = [...days].sort((a, b) => a.date.localeCompare(b.date))
            const dateRange = `${format(parseISO(sorted[0].date), 'dd MMM')} – ${format(parseISO(sorted[sorted.length - 1].date), 'dd MMM yyyy')}`

            return (
              <div key={wk} className="card overflow-hidden">
                {/* Week header */}
                <div className="bg-navy-800 text-white px-5 py-3 flex items-center justify-between">
                  <span className="font-bold">
                    Week {wi + 1}
                    <span className="text-navy-300 font-normal text-sm ml-3">{dateRange}</span>
                  </span>
                  <span className="text-sm text-navy-300">{tot.total.toLocaleString()} total laundered</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="table-header">Date</th>
                        <th className="table-header">Building</th>
                        <th className="table-header text-right">Packed</th>
                        <th className="table-header text-right">Ink Stain</th>
                        <th className="table-header text-right">Lg / Burnt Holes</th>
                        <th className="table-header text-right">To Repair</th>
                        <th className="table-header text-right bg-green-50 text-green-700">Total Laundered</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {sorted.map(d => {
                        const dayPacked  = d.buildings.reduce((s, b) => s + b.packed,  0)
                        const dayInk     = d.buildings.reduce((s, b) => s + b.ink,     0)
                        const dayHoles   = d.buildings.reduce((s, b) => s + b.holes,   0)
                        const dayRepairs = d.buildings.reduce((s, b) => s + b.repairs, 0)
                        const dayTotal   = d.buildings.reduce((s, b) => s + b.total,   0)

                        return (
                          <Fragment key={d.date}>
                            {/* Building rows */}
                            {d.buildings.map((b, bi) => (
                              <tr key={b.id || bi} className="hover:bg-gray-50">
                                {bi === 0 && (
                                  <td
                                    className="table-cell font-semibold text-navy-700 whitespace-nowrap align-top pt-3"
                                    rowSpan={d.buildings.length + (d.buildings.length > 1 ? 1 : 0)}
                                  >
                                    {format(parseISO(d.date), 'EEE dd MMM')}
                                  </td>
                                )}
                                <td className="table-cell">
                                  <span className="inline-flex items-center gap-1.5">
                                    <Building2 size={13} className="text-gray-400 shrink-0" />
                                    {b.name}
                                    {b.bagColor && (
                                      <span className="text-xs text-gray-400 ml-1">({b.bagColor} bags)</span>
                                    )}
                                  </span>
                                </td>
                                <td className="table-cell text-right font-semibold">{fmtN(b.packed)}</td>
                                <td className="table-cell text-right text-red-600">{fmtN(b.ink)}</td>
                                <td className="table-cell text-right text-orange-600">{fmtN(b.holes)}</td>
                                <td className="table-cell text-right text-amber-600">{fmtN(b.repairs)}</td>
                                <td className="table-cell text-right font-bold text-green-700 bg-green-50/40">{fmtN(b.total)}</td>
                              </tr>
                            ))}

                            {/* Day sub-total (only when multiple buildings) */}
                            {d.buildings.length > 1 && (
                              <tr className="bg-gray-100 text-xs font-semibold">
                                {/* Date cell is already covered by rowSpan above */}
                                <td className="table-cell text-gray-500 italic">Day Total</td>
                                <td className="table-cell text-right text-gray-700">{fmtN(dayPacked)}</td>
                                <td className="table-cell text-right text-red-500">{fmtN(dayInk)}</td>
                                <td className="table-cell text-right text-orange-500">{fmtN(dayHoles)}</td>
                                <td className="table-cell text-right text-amber-500">{fmtN(dayRepairs)}</td>
                                <td className="table-cell text-right text-green-600 bg-green-50/60">{fmtN(dayTotal)}</td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}

                      {/* Week total row — spans all 7 columns */}
                      <tr className="bg-navy-50 border-t-2 border-navy-200 font-bold">
                        <td className="table-cell text-navy-700" colSpan={2}>Week {wi + 1} Total</td>
                        <td className="table-cell text-right text-navy-700">{fmtN(tot.packed)}</td>
                        <td className="table-cell text-right text-red-600">{fmtN(tot.ink)}</td>
                        <td className="table-cell text-right text-orange-600">{fmtN(tot.holes)}</td>
                        <td className="table-cell text-right text-amber-600">{fmtN(tot.repairs)}</td>
                        <td className="table-cell text-right text-green-700 bg-green-50">{tot.total.toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* ── Labelling & General Repair split by building allocation % ── */}
                {filters.client && buildings.length > 0 &&
                  (weekExtras[wk]?.labelling > 0 || weekExtras[wk]?.general > 0) && (
                  <div className="border-t border-amber-200 bg-amber-50/50 px-5 py-3">
                    <p className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-2">
                      Labelling &amp; General Repair — Building Split
                    </p>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {weekExtras[wk]?.labelling > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1.5">
                            Garment Labelling <span className="font-semibold text-gray-700">({weekExtras[wk].labelling} total)</span>
                          </p>
                          <div className="space-y-1">
                            {buildings.map(b => {
                              const qty = Math.ceil(weekExtras[wk].labelling * ((b.reject_pct || 0) / 100))
                              if (!qty) return null
                              return (
                                <div key={b.id} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-1.5 border border-amber-100">
                                  <span className="text-gray-600">{b.name} <span className="text-gray-400">({b.reject_pct}%)</span></span>
                                  <span className="font-bold text-amber-700">{qty}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      {weekExtras[wk]?.general > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1.5">
                            General Repair <span className="font-semibold text-gray-700">({weekExtras[wk].general} total)</span>
                          </p>
                          <div className="space-y-1">
                            {buildings.map(b => {
                              const qty = Math.ceil(weekExtras[wk].general * ((b.reject_pct || 0) / 100))
                              if (!qty) return null
                              return (
                                <div key={b.id} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-1.5 border border-amber-100">
                                  <span className="text-gray-600">{b.name} <span className="text-gray-400">({b.reject_pct}%)</span></span>
                                  <span className="font-bold text-amber-700">{qty}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* ── Additional Services (Extras) ── */}
          {(extrasTotals.labelling > 0 || extrasTotals.sleeve > 0 ||
            extrasTotals.general > 0  || extrasTotals.fpInject > 0) && (
            <div className="card overflow-hidden">
              <div className="bg-amber-700 text-white px-5 py-3 font-bold">
                Additional Services
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="table-header">Service</th>
                    <th className="table-header text-right">Total Quantity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {[
                    { label: 'Garment Labelling',    qty: extrasTotals.labelling },
                    { label: 'Sleeve Repair',         qty: extrasTotals.sleeve    },
                    { label: 'General Repair',        qty: extrasTotals.general   },
                    { label: 'F&P to Inject / Dispose', qty: extrasTotals.fpInject },
                  ].filter(r => r.qty > 0).map(r => (
                    <tr key={r.label} className="hover:bg-gray-50">
                      <td className="table-cell font-medium">{r.label}</td>
                      <td className="table-cell text-right font-bold text-navy-700">{r.qty.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Period Total banner ── */}
          {byDate.length > 0 && (
            <div className="card p-5 bg-navy-800 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-lg">Period Total</p>
                  <p className="text-navy-300 text-sm">{filters.from} → {filters.to}</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-gold-400">{grand.total.toLocaleString()}</p>
                  <p className="text-navy-300 text-sm">gowns laundered (billable)</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-4 text-center border-t border-navy-700 pt-4">
                {[
                  { label: 'Packed', value: grand.packed.toLocaleString(), cls: 'text-white' },
                  { label: 'Ink Stain', value: (grand.ink).toLocaleString(), cls: 'text-red-400' },
                  { label: 'Lg / Holes', value: (grand.holes).toLocaleString(), cls: 'text-orange-400' },
                  { label: 'Repairs', value: grand.repairs.toLocaleString(), cls: 'text-amber-400' },
                ].map(({ label, value, cls }) => (
                  <div key={label}>
                    <p className="text-navy-300 text-xs uppercase tracking-wider">{label}</p>
                    <p className={`font-bold text-lg ${cls}`}>{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {byDate.length === 0 && (
            <div className="card p-12 text-center text-gray-400">
              <ClipboardList size={32} className="mx-auto mb-2 text-gray-300" />
              <p>No data found for the selected period.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── PRICING CATALOG TAB ───────────────────────────────────────

function PricingCatalog() {
  const qc = useQueryClient()
  const { data: items = [], isLoading, error } = usePricingItems()

  const [modal,         setModal]         = useState(null)   // null | 'add' | item
  const [form,          setForm]          = useState({ name: '', description: '', unit: 'per item', unit_price: '', active: true })
  const [saving,        setSaving]        = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  function openAdd() {
    setForm({ name: '', description: '', unit: 'per item', unit_price: '', active: true })
    setModal('add')
  }

  function openEdit(item) {
    setForm({
      name:        item.name,
      description: item.description || '',
      unit:        item.unit || 'per item',
      unit_price:  String(item.unit_price),
      active:      item.active,
    })
    setModal(item)
  }

  async function save() {
    if (!form.name.trim()) { toast.error('Item name is required'); return }
    const price = parseFloat(form.unit_price)
    if (isNaN(price) || price < 0) { toast.error('A valid unit price is required'); return }

    setSaving(true)
    try {
      if (modal === 'add') {
        const { error: err } = await supabase.from('laundry_pricing_items').insert({
          name:        form.name.trim(),
          description: form.description.trim() || null,
          unit:        form.unit.trim() || 'per item',
          unit_price:  price,
          active:      form.active,
        })
        if (err) throw err
        toast.success('Pricing item added')
      } else {
        const { error: err } = await supabase
          .from('laundry_pricing_items')
          .update({
            name:        form.name.trim(),
            description: form.description.trim() || null,
            unit:        form.unit.trim() || 'per item',
            unit_price:  price,
            active:      form.active,
          })
          .eq('id', modal.id)
        if (err) throw err
        toast.success('Pricing item updated')
      }
      qc.invalidateQueries({ queryKey: ['pricing-items'] })
      setModal(null)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete(item) {
    const { error: err } = await supabase.from('laundry_pricing_items').delete().eq('id', item.id)
    if (err) { toast.error(err.message); return }
    qc.invalidateQueries({ queryKey: ['pricing-items'] })
    toast.success('Item deleted')
    setDeleteConfirm(null)
  }

  // Table not yet set up
  if (error) {
    return (
      <div className="card p-6 border border-amber-200 bg-amber-50">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-gray-800">Pricing table not yet set up</p>
            <p className="text-sm text-gray-600 mt-1">
              Run <code className="bg-white border border-gray-200 px-1.5 py-0.5 rounded text-xs font-mono">supabase-schema-v4.sql</code> in your Supabase SQL editor to create the pricing items table, then refresh.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {items.filter(i => i.active).length} active items · Prices drive Xero quote calculations
        </p>
        <button onClick={openAdd} className="btn-gold">
          <Plus size={16} /> Add Item
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="table-header">Item Name</th>
              <th className="table-header">Description</th>
              <th className="table-header">Unit</th>
              <th className="table-header text-right">Unit Price</th>
              <th className="table-header text-center">Status</th>
              <th className="table-header text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && (
              <tr>
                <td colSpan={6} className="table-cell text-center py-8 text-gray-400 animate-pulse">
                  Loading pricing items…
                </td>
              </tr>
            )}
            {!isLoading && items.map(item => (
              <tr key={item.id} className={`hover:bg-gray-50 transition-colors ${!item.active ? 'opacity-60' : ''}`}>
                <td className="table-cell font-medium">{item.name}</td>
                <td className="table-cell text-sm text-gray-500 max-w-xs truncate">
                  {item.description || '—'}
                </td>
                <td className="table-cell text-sm text-gray-500">{item.unit}</td>
                <td className="table-cell text-right font-bold text-navy-700 text-base">
                  {fmtMoney(item.unit_price)}
                </td>
                <td className="table-cell text-center">
                  <span className={item.active ? 'badge-green' : 'badge-gray'}>
                    {item.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="table-cell">
                  <div className="flex items-center justify-end gap-1.5">
                    <button onClick={() => openEdit(item)} className="btn-secondary btn-sm">
                      <Pencil size={13} /> Edit
                    </button>
                    <button onClick={() => setDeleteConfirm(item)} className="btn-danger btn-sm p-1.5">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="table-cell text-center py-12">
                  <DollarSign size={32} className="text-gray-200 mx-auto mb-2" />
                  <p className="text-gray-400">No pricing items yet</p>
                  <button onClick={openAdd} className="btn-gold mt-3 btn-sm">Add First Item</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit modal */}
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal === 'add' ? 'Add Pricing Item' : 'Edit Pricing Item'}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Item Name *</label>
            <input
              className="input"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Laundry, Repairs, Garment Labelling"
            />
          </div>
          <div>
            <label className="label">Description</label>
            <input
              className="input"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Short description (optional)"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Unit</label>
              <input
                className="input"
                value={form.unit}
                onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                placeholder="per gown, per item…"
              />
            </div>
            <div>
              <label className="label">Unit Price ($) *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input"
                value={form.unit_price}
                onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))}
                placeholder="0.00"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-gray-300 text-navy-600"
              checked={form.active}
              onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
            />
            <span className="text-sm font-medium text-gray-700">
              Active (included in quote calculations)
            </span>
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <button className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn-gold" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : modal === 'add' ? 'Add Item' : 'Save Changes'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-bold text-gray-900 text-lg mb-2">Delete "{deleteConfirm.name}"?</h3>
            <p className="text-sm text-gray-500 mb-5">
              This pricing item will be permanently deleted and removed from future quotes.
            </p>
            <div className="flex gap-3 justify-end">
              <button className="btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => confirmDelete(deleteConfirm)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── QUOTE BUILDER TAB ─────────────────────────────────────────

function QuoteBuilder() {
  const today      = format(new Date(), 'yyyy-MM-dd')
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')

  const [filters, setFilters] = useState({
    from:     monthStart,
    to:       today,
    client:   '',
    building: '',
  })

  const { data: clients = [] }                             = useClients()
  const { data: buildings = [] }                           = useBuildings(filters.client)
  const { data: allLogs = [], isLoading: logsLoading }     = useProcessingLogs(
    // Only fetch when client is selected
    { from: filters.from, to: filters.to, client: filters.client }
  )
  const { data: extras = [] }                              = useDailyExtras(
    { from: filters.from, to: filters.to, client: filters.client }
  )
  const { data: pricingItems = [], error: pricingError }   = usePricingItems()

  // ── Pricing lookup (name → price, case-insensitive) ────────
  const pricing = useMemo(() => {
    const map = {}
    pricingItems.forEach(p => {
      if (p.active) map[p.name.toLowerCase().trim()] = parseFloat(p.unit_price) || 0
    })
    return map
  }, [pricingItems])

  const getPrice = (name) => pricing[name.toLowerCase().trim()] ?? 0

  // ── Compute weekly line items for selected building ─────────
  const weeklyLineItems = useMemo(() => {
    if (!filters.building) return []

    // Only this building's logs
    const bldLogs = allLogs.filter(l => l.building_id === filters.building)

    // Group by ISO week number
    const weekMap = {}
    bldLogs.forEach(log => {
      const wk = getISOWeek(parseISO(log.log_date))
      if (!weekMap[wk]) weekMap[wk] = { wk, dates: [], packed: 0, ink: 0, holes: 0, repairs: 0 }
      weekMap[wk].dates.push(log.log_date)
      const rows = log.laundry_log_rows || []
      weekMap[wk].packed  += calcPacked(rows)
      weekMap[wk].ink     += rows.reduce((s, r) => s + (r.ink_stain   || 0), 0)
      weekMap[wk].holes   += rows.reduce((s, r) => s + (r.large_holes || 0), 0)
      weekMap[wk].repairs += rows.reduce((s, r) => s + (r.to_repair   || 0), 0)
    })

    return Object.values(weekMap)
      .sort((a, b) => a.wk - b.wk)
      .map((w, i) => {
        const sortedDates = [...w.dates].sort()
        const dateRange   = sortedDates.length > 0
          ? `${format(parseISO(sortedDates[0]), 'dd MMM')} – ${format(parseISO(sortedDates[sortedDates.length - 1]), 'dd MMM yyyy')}`
          : ''
        // Total laundered = packed + all rejects + all repairs
        // (user confirmed: rejects & repairs all count as laundered)
        const laundryQty = w.packed + w.ink + w.holes + w.repairs
        const repairsQty = w.repairs
        return { label: `Week ${i + 1}`, dateRange, laundryQty, repairsQty }
      })
  }, [allLogs, filters.building])

  // ── Extras for the period ───────────────────────────────────
  const extrasTotals = useMemo(() => {
    let labelling = 0, sleeve = 0, general = 0, fpInject = 0, bags = 0

    extras.forEach(e => {
      labelling += e.labelling      || 0
      sleeve    += e.sleeve_repair  || 0
      general   += e.general_repair || 0
      fpInject  += e.fp_inject      || 0

      // Bags: stored as JSON { building_id: count }
      if (filters.building && e.bag_counts && typeof e.bag_counts === 'object') {
        bags += parseInt(e.bag_counts[filters.building] || 0)
      }
    })

    return { labelling, sleeve, general, fpInject, bags }
  }, [extras, filters.building])

  // ── Build all invoice lines ─────────────────────────────────
  const invoiceLines = useMemo(() => {
    const lines = []
    const laundryP = getPrice('laundry')
    const repairsP = getPrice('repairs')

    weeklyLineItems.forEach(wk => {
      if (wk.laundryQty > 0) {
        lines.push({
          description: `${wk.label} – Laundry (${wk.dateRange})`,
          qty:         wk.laundryQty,
          unitPrice:   laundryP,
          amount:      wk.laundryQty * laundryP,
          type:        'laundry',
        })
      }
      if (wk.repairsQty > 0) {
        lines.push({
          description: `${wk.label} – Repairs`,
          qty:         wk.repairsQty,
          unitPrice:   repairsP,
          amount:      wk.repairsQty * repairsP,
          type:        'repairs',
        })
      }
    })

    const { labelling, sleeve, fpInject, bags } = extrasTotals

    if (labelling > 0) {
      const p = getPrice('garment labelling')
      lines.push({ description: 'Garment Labelling', qty: labelling, unitPrice: p, amount: labelling * p, type: 'extra' })
    }
    if (sleeve > 0) {
      const p = getPrice('sleeve repair')
      lines.push({ description: 'Sleeve Repair', qty: sleeve, unitPrice: p, amount: sleeve * p, type: 'extra' })
    }
    if (fpInject > 0) {
      // Flat monthly fee for disposal, regardless of quantity
      const p = getPrice('reject gowns disposal')
      lines.push({ description: 'Reject Gowns Disposal', qty: 1, unitPrice: p, amount: p, type: 'extra' })
    }
    if (bags > 0) {
      const p = getPrice('linen bags')
      lines.push({ description: 'Linen Bags', qty: bags, unitPrice: p, amount: bags * p, type: 'extra' })
    }

    return lines
  }, [weeklyLineItems, extrasTotals, pricing])

  const subtotal = invoiceLines.reduce((s, l) => s + l.amount, 0)
  const gst      = subtotal * 0.15
  const total    = subtotal + gst

  const selectedClientName   = clients.find(c => c.id === filters.client)?.name       || ''
  const selectedBuildingName = buildings.find(b => b.id === filters.building)?.name   || ''

  function exportCSV() {
    if (invoiceLines.length === 0) { toast.error('No data to export'); return }
    const rows = [
      ['Description', 'Qty', 'Unit Price (NZD)', 'Amount ex GST', 'Tax Rate', 'GST Amount', 'Total inc GST'],
      ...invoiceLines.map(l => [
        l.description,
        l.qty,
        Number(l.unitPrice).toFixed(2),
        Number(l.amount).toFixed(2),
        '15%',
        Number(l.amount * 0.15).toFixed(2),
        Number(l.amount * 1.15).toFixed(2),
      ]),
      [],
      ['', '', '', `Subtotal (ex GST)`, '', '', `$${subtotal.toFixed(2)}`],
      ['', '', '', `GST (15%)`,          '', '', `$${gst.toFixed(2)}`],
      ['', '', '', `TOTAL (inc GST)`,    '', '', `$${total.toFixed(2)}`],
    ]

    const csv  = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `xero-quote-${selectedClientName.replace(/\s+/g, '-')}-${selectedBuildingName.replace(/\s+/g, '-')}-${filters.from}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Quote exported as CSV!')
  }

  const rowBg = (type) => ({
    laundry: '',
    repairs: 'bg-amber-50/50',
    extra:   'bg-blue-50/30',
  }[type] || '')

  return (
    <div className="space-y-5">
      {/* ── Selector panel ── */}
      <div className="card p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-700">Generate Xero Quote</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label">Client *</label>
            <select
              className="input"
              value={filters.client}
              onChange={e => setFilters(f => ({ ...f, client: e.target.value, building: '' }))}>
              <option value="">Select client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Building *</label>
            <select
              className="input"
              value={filters.building}
              onChange={e => setFilters(f => ({ ...f, building: e.target.value }))}
              disabled={!filters.client || buildings.length === 0}>
              <option value="">Select building…</option>
              {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
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
      </div>

      {pricingError && (
        <div className="card p-4 border border-amber-200 bg-amber-50 flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700">
            Pricing table not set up. Run <code className="bg-white px-1 rounded text-xs">supabase-schema-v4.sql</code> first.
          </p>
        </div>
      )}

      {(!filters.client || !filters.building) && !pricingError && (
        <div className="card p-10 text-center text-gray-400">
          <Calculator size={36} className="mx-auto mb-3 text-gray-300" />
          <p className="font-medium">Select a client and building above to generate a quote</p>
          <p className="text-sm mt-1">The quote will match your Xero invoice format</p>
        </div>
      )}

      {filters.client && filters.building && !pricingError && (
        <>
          {/* ── Invoice header ── */}
          <div className="card p-5 border-l-4 border-gold-500">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Laundered & Repaired · Quote</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{selectedClientName}</p>
                <p className="text-sm text-gray-600">{selectedBuildingName} Building</p>
                <p className="text-xs text-gray-400 mt-1">{filters.from} to {filters.to}</p>
              </div>
              <button
                onClick={exportCSV}
                disabled={invoiceLines.length === 0}
                className="btn-gold"
              >
                <FileDown size={16} /> Export CSV for Xero
              </button>
            </div>
          </div>

          {/* ── Line items ── */}
          {logsLoading ? (
            <div className="card p-8 text-center text-gray-400 animate-pulse">Computing quote…</div>
          ) : invoiceLines.length === 0 ? (
            <div className="card p-10 text-center text-gray-400">
              <Package size={32} className="mx-auto mb-2 text-gray-300" />
              <p>No log data found for this building and date range.</p>
              <p className="text-sm mt-1">Make sure log entries have been submitted for this period.</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-800 text-sm">Invoice Line Items</p>
                  <p className="text-xs text-gray-500">Amounts are tax exclusive · 15% GST on Income</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="table-header">Description</th>
                      <th className="table-header text-right">Qty</th>
                      <th className="table-header text-right">Unit Price</th>
                      <th className="table-header text-right text-gray-400">Account</th>
                      <th className="table-header text-right text-gray-400">Tax Rate</th>
                      <th className="table-header text-right">Amount NZD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {invoiceLines.map((line, i) => (
                      <tr key={i} className={`hover:bg-gray-50 ${rowBg(line.type)}`}>
                        <td className="table-cell font-medium">{line.description}</td>
                        <td className="table-cell text-right tabular-nums">{line.qty.toLocaleString()}</td>
                        <td className="table-cell text-right tabular-nums">{fmtMoney(line.unitPrice)}</td>
                        <td className="table-cell text-right text-gray-400 text-xs">200 – Sales</td>
                        <td className="table-cell text-right text-gray-400 text-xs">15% GST on Income</td>
                        <td className="table-cell text-right font-bold text-navy-700 tabular-nums">
                          {fmtMoney(line.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals footer */}
              <div className="border-t border-gray-200 px-5 py-5">
                <div className="ml-auto max-w-xs space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Subtotal (ex GST)</span>
                    <span className="font-semibold tabular-nums">{fmtMoney(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-400">
                    <span>GST (15%)</span>
                    <span className="tabular-nums">{fmtMoney(gst)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold pt-2 border-t border-gray-200">
                    <span className="text-gray-900">Total (inc GST)</span>
                    <span className="text-gold-600 tabular-nums">{fmtMoney(total)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── MAIN ACCOUNTS PAGE ────────────────────────────────────────

const TABS = [
  { id: 'log',     label: 'Processing Log',  icon: ClipboardList },
  { id: 'pricing', label: 'Pricing Catalog', icon: DollarSign    },
  { id: 'quote',   label: 'Quote Builder',   icon: Calculator    },
]

export default function Accounts() {
  const [tab, setTab] = useState('log')

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Processing data · Pricing management · Xero quote generation
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
              tab === id
                ? 'bg-white text-navy-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={15} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {tab === 'log'     && <ProcessingLog />}
      {tab === 'pricing' && <PricingCatalog />}
      {tab === 'quote'   && <QuoteBuilder />}
    </div>
  )
}
