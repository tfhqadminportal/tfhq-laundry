import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { format, startOfWeek, endOfWeek, parseISO } from 'date-fns'
import { FileDown, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

const SIZES = ['XS', 'M', 'XL', '3XL', '5XL', '7XL', '9XL']

// ─── Data hooks ────────────────────────────────────────────────

function useClients() {
  return useQuery({
    queryKey: ['wr-clients'],
    queryFn: async () => {
      const { data } = await supabase.from('laundry_clients').select('id, name').eq('active', true).order('name')
      return data || []
    },
  })
}

function useBuildings(clientId) {
  return useQuery({
    queryKey: ['wr-buildings', clientId],
    queryFn: async () => {
      if (!clientId) return []
      const { data } = await supabase
        .from('laundry_buildings')
        .select('id, name, bag_color, reject_pct')
        .eq('client_id', clientId).eq('active', true).order('sort_order')
      return data || []
    },
    enabled: !!clientId,
  })
}

function useWeeklyLogs(clientId, from, to) {
  return useQuery({
    queryKey: ['wr-logs', clientId, from, to],
    queryFn: async () => {
      if (!clientId || !from || !to) return []
      const { data, error } = await supabase
        .from('laundry_logs')
        .select(`
          id, log_date, building_id,
          laundry_log_rows(size_label, sort_order, blue_gowns, white_gowns, grey_gowns, qty_packed, ink_stain, large_holes, to_repair)
        `)
        .eq('client_id', clientId)
        .gte('log_date', from).lte('log_date', to)
        .order('log_date')
      if (error) throw error
      return data || []
    },
    enabled: !!clientId && !!from && !!to,
  })
}

function useWeeklyExtras(clientId, from, to) {
  return useQuery({
    queryKey: ['wr-extras', clientId, from, to],
    queryFn: async () => {
      if (!clientId || !from || !to) return []
      const { data } = await supabase
        .from('laundry_daily_extras')
        .select('log_date, labelling, sleeve_repair, general_repair, fp_inject, bag_counts')
        .eq('client_id', clientId)
        .gte('log_date', from).lte('log_date', to)
        .order('log_date')
      return data || []
    },
    enabled: !!clientId && !!from && !!to,
  })
}

// ─── Data processor ────────────────────────────────────────────

function processData(logs, buildings) {
  // Returns { [date]: { [size]: { packed: {[bid]: n}, ink: n, holes: n, repair: n } } }
  const result = {}
  logs.forEach(log => {
    const date = log.log_date
    const bid  = log.building_id
    if (!result[date]) result[date] = {}
    ;(log.laundry_log_rows || []).forEach(row => {
      const size = row.size_label
      if (!result[date][size]) result[date][size] = { packed: {}, ink: 0, holes: 0, repair: 0 }
      result[date][size].packed[bid] = (row.blue_gowns || 0) + (row.white_gowns || 0) + (row.grey_gowns || 0) || row.qty_packed || 0
      result[date][size].ink    += row.ink_stain   || 0
      result[date][size].holes  += row.large_holes || 0
      result[date][size].repair += row.to_repair   || 0
    })
  })
  return result
}

function dayTotals(dayData, buildings) {
  return SIZES.reduce((acc, size) => {
    const s = dayData[size] || { packed: {}, ink: 0, holes: 0, repair: 0 }
    buildings.forEach(b => { acc.packed[b.id] = (acc.packed[b.id] || 0) + (s.packed[b.id] || 0) })
    acc.totalPacked += buildings.reduce((x, b) => x + (s.packed[b.id] || 0), 0)
    acc.ink    += s.ink
    acc.holes  += s.holes
    acc.repair += s.repair
    return acc
  }, { packed: {}, totalPacked: 0, ink: 0, holes: 0, repair: 0 })
}

// ─── Excel export ──────────────────────────────────────────────

function exportExcel(dates, dayDataMap, buildings, extras, clientName) {
  const wb = XLSX.utils.book_new()
  const rows = []

  const bNames = buildings.map(b => b.name)
  const dataHeader = ['Size', 'Total Packed', ...bNames, 'Ink Stain', 'Large/Burnt Holes', 'To Repair']

  rows.push(['TFHQ-LAUNDRY DATA'])
  rows.push([])

  const weeklyTot = { packed: {}, totalPacked: 0, ink: 0, holes: 0, repair: 0 }
  buildings.forEach(b => { weeklyTot.packed[b.id] = 0 })

  dates.forEach(date => {
    const dayData = dayDataMap[date] || {}
    rows.push([dataHeader[0], ...dataHeader.slice(1)])  // re-use header each day

    SIZES.forEach(size => {
      const s = dayData[size] || { packed: {}, ink: 0, holes: 0, repair: 0 }
      const bPacked = buildings.map(b => s.packed[b.id] || null)
      const totalP  = bPacked.reduce((x, v) => x + (v || 0), 0)
      rows.push([size, totalP || null, ...bPacked, s.ink || null, s.holes || null, s.repair || null])
    })

    const dt = dayTotals(dayData, buildings)
    rows.push([
      'Totals',
      dt.totalPacked,
      ...buildings.map(b => dt.packed[b.id] || null),
      dt.ink || null, dt.holes || null, dt.repair || null,
      format(parseISO(date), 'dd-MMM'),
    ])

    // Accumulate weekly
    dt.totalPacked && (weeklyTot.totalPacked += dt.totalPacked)
    buildings.forEach(b => { weeklyTot.packed[b.id] = (weeklyTot.packed[b.id] || 0) + (dt.packed[b.id] || 0) })
    weeklyTot.ink    += dt.ink
    weeklyTot.holes  += dt.holes
    weeklyTot.repair += dt.repair

    rows.push([])
  })

  // Weekly totals row
  rows.push([
    'Weekly Total', weeklyTot.totalPacked,
    ...buildings.map(b => weeklyTot.packed[b.id] || null),
    weeklyTot.ink || null, weeklyTot.holes || null, weeklyTot.repair || null,
  ])
  rows.push([])

  // Bags + extras section
  // general = weekly To Repair total; fp = weekly Ink + Holes total
  const totalExtras = extras.reduce((acc, e) => {
    acc.labelling += e.labelling     || 0
    acc.sleeve    += e.sleeve_repair || 0
    buildings.forEach(b => {
      const bc = e.bag_counts || {}
      acc.bags[b.id] = (acc.bags[b.id] || 0) + (bc[b.id] || 0)
    })
    return acc
  }, { labelling: 0, sleeve: 0, bags: {} })
  totalExtras.general = weeklyTot.repair
  totalExtras.fp      = weeklyTot.ink + weeklyTot.holes

  rows.push(['Bags', 'Quantities', ...bNames, 'Total'])
  buildings.forEach(b => {
    rows.push([`${b.name}${b.bag_color ? ` - ${b.bag_color}` : ''}`, totalExtras.bags[b.id] || null])
  })
  rows.push([])

  // Labelling split
  const labSplit = buildings.map(b => totalExtras.labelling ? Math.ceil(totalExtras.labelling * ((b.reject_pct || 0) / 100)) : null)
  rows.push(['Labelling', totalExtras.labelling || null, ...labSplit, totalExtras.labelling || null])

  rows.push(['Sleeve repair', totalExtras.sleeve || null])

  // General repair split
  const genSplit = buildings.map(b => totalExtras.general ? Math.ceil(totalExtras.general * ((b.reject_pct || 0) / 100)) : null)
  rows.push(['General Repair', totalExtras.general || null, ...genSplit, totalExtras.general || null])

  rows.push(['Fisher and Paykel to Inject', totalExtras.fp || null])

  const ws = XLSX.utils.aoa_to_sheet(rows)

  // Basic column widths
  ws['!cols'] = [{ wch: 22 }, { wch: 14 }, ...buildings.map(() => ({ wch: 12 })), { wch: 12 }, { wch: 18 }, { wch: 12 }]

  XLSX.utils.book_append_sheet(wb, ws, 'Weekly Report')

  const dateLabel = dates.length ? `${format(parseISO(dates[0]), 'dd-MMM')}_${format(parseISO(dates[dates.length - 1]), 'dd-MMM-yyyy')}` : 'week'
  XLSX.writeFile(wb, `TFHQ-Laundry-${clientName}-${dateLabel}.xlsx`)
}

// ─── Day block ─────────────────────────────────────────────────

function DayBlock({ date, dayData, buildings }) {
  const tot = dayTotals(dayData, buildings)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-navy-700 text-white">
            <th className="px-2 py-1.5 text-left font-bold border border-navy-600 w-14">Size</th>
            <th className="px-2 py-1.5 text-right font-bold border border-navy-600">Total Packed</th>
            {buildings.map(b => (
              <th key={b.id} className="px-2 py-1.5 text-right font-bold border border-navy-600">{b.name}</th>
            ))}
            <th className="px-2 py-1.5 text-right font-bold border border-red-400 bg-red-800">Ink Stain</th>
            <th className="px-2 py-1.5 text-right font-bold border border-orange-400 bg-orange-800">Large/Burnt Holes</th>
            <th className="px-2 py-1.5 text-right font-bold border border-amber-400 bg-amber-800">To Repair</th>
          </tr>
        </thead>
        <tbody>
          {SIZES.map((size, si) => {
            const s = dayData[size] || { packed: {}, ink: 0, holes: 0, repair: 0 }
            const bPacked = buildings.map(b => s.packed[b.id] || 0)
            const totalP  = bPacked.reduce((a, v) => a + v, 0)
            return (
              <tr key={size} className={si % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-2 py-1 border border-gray-200 font-semibold text-navy-700">{size}</td>
                <td className="px-2 py-1 border border-gray-200 text-right font-semibold text-navy-700">{totalP || 0}</td>
                {buildings.map((b, bi) => (
                  <td key={b.id} className="px-2 py-1 border border-gray-200 text-right">{bPacked[bi] || 0}</td>
                ))}
                <td className="px-2 py-1 border border-gray-200 text-right text-red-600">{s.ink || 0}</td>
                <td className="px-2 py-1 border border-gray-200 text-right text-orange-600">{s.holes || 0}</td>
                <td className="px-2 py-1 border border-gray-200 text-right text-amber-600">{s.repair || 0}</td>
              </tr>
            )
          })}
          {/* Totals */}
          <tr className="bg-navy-100 font-bold border-t-2 border-navy-400">
            <td className="px-2 py-1.5 border border-navy-200 text-navy-800">Totals</td>
            <td className="px-2 py-1.5 border border-navy-200 text-right text-navy-800">{tot.totalPacked || '—'}</td>
            {buildings.map(b => (
              <td key={b.id} className="px-2 py-1.5 border border-navy-200 text-right text-navy-700">{tot.packed[b.id] || '—'}</td>
            ))}
            <td className="px-2 py-1.5 border border-navy-200 text-right text-red-700">{tot.ink || '—'}</td>
            <td className="px-2 py-1.5 border border-navy-200 text-right text-orange-700">{tot.holes || '—'}</td>
            <td className="px-2 py-1.5 border border-navy-200 text-right text-amber-700">{tot.repair || '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────

export default function WeeklyReport() {
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const weekEnd   = format(endOfWeek(new Date(),   { weekStartsOn: 1 }), 'yyyy-MM-dd')

  const [clientId, setClientId] = useState('')
  const [from,     setFrom]     = useState(weekStart)
  const [to,       setTo]       = useState(weekEnd)

  const { data: clients  = [] }  = useClients()
  const { data: buildings = [] } = useBuildings(clientId)
  const { data: logs      = [], isLoading } = useWeeklyLogs(clientId, from, to)
  const { data: extras    = [] } = useWeeklyExtras(clientId, from, to)

  // Sorted unique dates that have data
  const dates = useMemo(() => [...new Set(logs.map(l => l.log_date))].sort(), [logs])

  const dayDataMap = useMemo(() => processData(logs, buildings), [logs, buildings])

  // Weekly totals across all days
  const weeklyTot = useMemo(() => {
    const acc = { packed: {}, totalPacked: 0, ink: 0, holes: 0, repair: 0 }
    buildings.forEach(b => { acc.packed[b.id] = 0 })
    dates.forEach(date => {
      const dt = dayTotals(dayDataMap[date] || {}, buildings)
      acc.totalPacked += dt.totalPacked
      buildings.forEach(b => { acc.packed[b.id] += dt.packed[b.id] || 0 })
      acc.ink    += dt.ink
      acc.holes  += dt.holes
      acc.repair += dt.repair
    })
    return acc
  }, [dates, dayDataMap, buildings])

  // Extras totals for the period
  // general = sum of To Repair from log_rows (not daily_extras)
  // fp      = sum of Ink Stain + Large Holes from log_rows (not daily_extras)
  const extTot = useMemo(() => {
    const acc = { labelling: 0, sleeve: 0, bags: {} }
    buildings.forEach(b => { acc.bags[b.id] = 0 })
    extras.forEach(e => {
      acc.labelling += e.labelling     || 0
      acc.sleeve    += e.sleeve_repair || 0
      const bc = e.bag_counts || {}
      buildings.forEach(b => { acc.bags[b.id] += bc[b.id] || 0 })
    })
    // Derive general repair and F&P directly from the log_rows weekly totals
    acc.general = weeklyTot.repair
    acc.fp      = weeklyTot.ink + weeklyTot.holes
    return acc
  }, [extras, buildings, weeklyTot.repair, weeklyTot.ink, weeklyTot.holes])

  const clientName = clients.find(c => c.id === clientId)?.name || ''
  const [exporting, setExporting] = useState(false)

  // Build a payload matching WeeklyUpload shape and call the server-side xlsx generator
  // so the download is byte-for-byte identical to what staff upload produces.
  const handleExport = async () => {
    if (!clientId || !dates.length) return
    setExporting(true)
    try {
      // Build "days" array in the same shape that /api/build-weekly-xlsx expects
      const days = dates.slice(0, 5).map(date => {
        const dayData = dayDataMap[date] || {}
        const sizes = {}
        SIZES.forEach(size => {
          const s = dayData[size] || { packed: {}, ink: 0, holes: 0, repair: 0 }
          const row = { ink_stain: s.ink || 0, large_holes: s.holes || 0, to_repair: s.repair || 0 }
          buildings.forEach(b => {
            const bName = (b.name || '').toLowerCase().trim()
            if (['paykel','fisher paykel','fisher & paykel','fisher and paykel'].includes(bName)) {
              row.paykel  = s.packed[b.id] || 0
            } else if (bName === 'daniel') {
              row.daniel  = s.packed[b.id] || 0
            } else if (bName === 'stewart') {
              row.stewart = s.packed[b.id] || 0
            }
          })
          row.paykel  = row.paykel  || 0
          row.daniel  = row.daniel  || 0
          row.stewart = row.stewart || 0
          sizes[size] = row
        })
        return { date, date_label: format(parseISO(date), 'd/M'), sizes }
      })

      const weeklyPayload = {
        bag_counts: {
          paykel:  0,
          daniel:  0,
          stewart: 0,
        },
        labelling:      extTot.labelling || 0,
        sleeve_repair:  extTot.sleeve    || 0,
        general_repair: extTot.general   || 0,
        fp_inject:      extTot.fp        || 0,
      }
      // Pull actual bag counts from extras
      extras.forEach(e => {
        const bc = e.bag_counts || {}
        buildings.forEach(b => {
          const bName = (b.name || '').toLowerCase().trim()
          const cnt   = bc[b.id] || 0
          if (['paykel','fisher paykel'].includes(bName)) weeklyPayload.bag_counts.paykel  += cnt
          else if (bName === 'daniel')                    weeklyPayload.bag_counts.daniel  += cnt
          else if (bName === 'stewart')                   weeklyPayload.bag_counts.stewart += cnt
        })
      })

      const weekStart = dates[0]
      const res = await fetch('/api/build-weekly-xlsx', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ weekStart, days, weekly: weeklyPayload }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error(err.error || 'Download failed')
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `TFHQ-Laundry-${clientName.replace(/\s+/g,'-')}-${weekStart}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Downloaded!')
    } catch (err) {
      toast.error(err.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-5">

      {/* ── Filters ── */}
      <div className="card p-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="col-span-2 lg:col-span-1">
            <label className="label text-xs">Client</label>
            <select className="input" value={clientId} onChange={e => setClientId(e.target.value)}>
              <option value="">Select client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">From</label>
            <input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label text-xs">To</label>
            <input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={handleExport}
              disabled={!clientId || !dates.length || exporting}
              className="btn-primary flex items-center gap-2 w-full justify-center disabled:opacity-40"
            >
              {exporting
                ? <><Loader2 size={15} className="animate-spin" /> Downloading…</>
                : <><FileDown size={15} /> Download Excel</>}
            </button>
          </div>
        </div>

        {/* Quick week preset buttons */}
        <div className="flex gap-2 mt-3 flex-wrap">
          {[-3, -2, -1, 0].map(offset => {
            const d    = new Date()
            d.setDate(d.getDate() + offset * 7)
            const wS   = format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')
            const wE   = format(endOfWeek(d,   { weekStartsOn: 1 }), 'yyyy-MM-dd')
            const lbl  = offset === 0 ? 'This Week' : offset === -1 ? 'Last Week' : `${Math.abs(offset)} Weeks Ago`
            return (
              <button key={offset} onClick={() => { setFrom(wS); setTo(wE) }}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors
                  ${from === wS && to === wE ? 'bg-navy-600 text-white border-navy-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                {lbl}
              </button>
            )
          })}
        </div>
      </div>

      {!clientId && (
        <div className="card p-8 text-center text-gray-400">Select a client to view the weekly report.</div>
      )}

      {clientId && isLoading && (
        <div className="card p-8 text-center text-gray-400 animate-pulse">Loading…</div>
      )}

      {clientId && !isLoading && dates.length === 0 && (
        <div className="card p-8 text-center text-gray-400">No data found for this period.</div>
      )}

      {clientId && !isLoading && dates.length > 0 && (
        <>
          {/* ── Per-day tables ── */}
          {dates.map(date => (
            <div key={date} className="card overflow-hidden">
              <div className="bg-navy-800 text-white px-4 py-2.5 font-bold text-sm">
                {format(parseISO(date), 'EEEE, dd MMM yyyy')}
              </div>
              <div className="p-3">
                <DayBlock date={date} dayData={dayDataMap[date] || {}} buildings={buildings} />
              </div>
            </div>
          ))}

          {/* ── Weekly Totals ── */}
          <div className="card overflow-hidden">
            <div className="bg-navy-900 text-gold-400 px-4 py-2.5 font-bold text-sm uppercase tracking-wider">
              Weekly Total — {dates.length} {dates.length === 1 ? 'day' : 'days'}
            </div>
            <div className="overflow-x-auto p-3">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-navy-900 text-white">
                    <th className="px-3 py-2 text-left border border-navy-700">—</th>
                    <th className="px-3 py-2 text-right border border-navy-700">Total Packed</th>
                    {buildings.map(b => (
                      <th key={b.id} className="px-3 py-2 text-right border border-navy-700">{b.name}</th>
                    ))}
                    <th className="px-3 py-2 text-right border border-navy-700 text-red-300">Ink Stain</th>
                    <th className="px-3 py-2 text-right border border-navy-700 text-orange-300">Large/Burnt Holes</th>
                    <th className="px-3 py-2 text-right border border-navy-700 text-amber-300">To Repair</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-navy-50 font-bold border-2 border-navy-300">
                    <td className="px-3 py-2.5 border border-navy-200 text-navy-800">Weekly Total</td>
                    <td className="px-3 py-2.5 border border-navy-200 text-right text-navy-900">{weeklyTot.totalPacked.toLocaleString()}</td>
                    {buildings.map(b => (
                      <td key={b.id} className="px-3 py-2.5 border border-navy-200 text-right text-navy-700">
                        {(weeklyTot.packed[b.id] || 0).toLocaleString()}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 border border-navy-200 text-right text-red-700">{weeklyTot.ink || '—'}</td>
                    <td className="px-3 py-2.5 border border-navy-200 text-right text-orange-700">{weeklyTot.holes || '—'}</td>
                    <td className="px-3 py-2.5 border border-navy-200 text-right text-amber-700">{weeklyTot.repair || '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Bags + Extras section — always shown, matches rows 49–56 of the March/April xlsx ── */}
          {true && (
            <div className="card overflow-hidden">
              <div className="bg-amber-700 text-white px-4 py-2.5 font-bold text-sm">
                Bags, Labelling &amp; Process — Weekly Summary
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-amber-50 border-b border-amber-200">
                      <th className="px-3 py-2 text-left border border-amber-100 font-semibold text-amber-900">Item</th>
                      <th className="px-3 py-2 text-right border border-amber-100 font-semibold text-amber-900">Total</th>
                      {buildings.map(b => (
                        <th key={b.id} className="px-3 py-2 text-right border border-amber-100 font-semibold text-amber-800">
                          {b.name}{b.bag_color ? ` (${b.bag_color})` : ''} {b.reject_pct > 0 ? `${b.reject_pct}%` : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-50">

                    {/* Bags */}
                    {buildings.map(b => extTot.bags[b.id] > 0 ? (
                      <tr key={b.id} className="hover:bg-amber-50/40">
                        <td className="px-3 py-2 border border-amber-100 text-gray-700">
                          {b.name}{b.bag_color ? ` — ${b.bag_color} Bags` : ' Bags'}
                        </td>
                        <td className="px-3 py-2 border border-amber-100 text-right font-bold">{extTot.bags[b.id]}</td>
                        {buildings.map(b2 => (
                          <td key={b2.id} className="px-3 py-2 border border-amber-100 text-right text-gray-500">
                            {b2.id === b.id ? extTot.bags[b.id] : '—'}
                          </td>
                        ))}
                      </tr>
                    ) : null)}

                    {/* Labelling (split by %) */}
                    {extTot.labelling > 0 && (
                      <tr className="bg-white hover:bg-amber-50/40">
                        <td className="px-3 py-2 border border-amber-100 font-medium text-gray-800">Labelling</td>
                        <td className="px-3 py-2 border border-amber-100 text-right font-bold">{extTot.labelling}</td>
                        {buildings.map(b => (
                          <td key={b.id} className="px-3 py-2 border border-amber-100 text-right text-amber-700 font-semibold">
                            {b.reject_pct > 0 ? Math.ceil(extTot.labelling * b.reject_pct / 100) : '—'}
                          </td>
                        ))}
                      </tr>
                    )}

                    {/* Sleeve Repair */}
                    {extTot.sleeve > 0 && (
                      <tr className="bg-white hover:bg-amber-50/40">
                        <td className="px-3 py-2 border border-amber-100 font-medium text-gray-800">Sleeve Repair</td>
                        <td className="px-3 py-2 border border-amber-100 text-right font-bold">{extTot.sleeve}</td>
                        {buildings.map(b => (
                          <td key={b.id} className="px-3 py-2 border border-amber-100 text-right text-gray-400">—</td>
                        ))}
                      </tr>
                    )}

                    {/* General Repair (split by %) */}
                    {extTot.general > 0 && (
                      <tr className="bg-white hover:bg-amber-50/40">
                        <td className="px-3 py-2 border border-amber-100 font-medium text-gray-800">General Repair</td>
                        <td className="px-3 py-2 border border-amber-100 text-right font-bold">{extTot.general}</td>
                        {buildings.map(b => (
                          <td key={b.id} className="px-3 py-2 border border-amber-100 text-right text-amber-700 font-semibold">
                            {b.reject_pct > 0 ? Math.ceil(extTot.general * b.reject_pct / 100) : '—'}
                          </td>
                        ))}
                      </tr>
                    )}

                    {/* F&P to Inject */}
                    {extTot.fp > 0 && (
                      <tr className="bg-white hover:bg-amber-50/40">
                        <td className="px-3 py-2 border border-amber-100 font-medium text-gray-800">Fisher &amp; Paykel to Inject</td>
                        <td className="px-3 py-2 border border-amber-100 text-right font-bold">{extTot.fp}</td>
                        {buildings.map(b => (
                          <td key={b.id} className="px-3 py-2 border border-amber-100 text-right text-gray-400">—</td>
                        ))}
                      </tr>
                    )}

                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
