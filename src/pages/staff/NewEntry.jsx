import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { format } from 'date-fns'
import {
  Save, Trash2, CheckCircle, ChevronLeft, ChevronRight,
  Package, Clock, TrendingUp, Users, CalendarClock, Settings,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useRosterForDate } from '@/hooks/useRosterHours'

// ─── Constants ─────────────────────────────────────────────────
const SIZES       = ['XS', 'M', 'XL', '3XL', '5XL', '7XL', '9XL']
const STORAGE_KEY = 'tfhq-laundry-v3-draft'
const todayStr    = () => format(new Date(), 'yyyy-MM-dd')

const REPAIR_FIELDS = [
  { key: 'labelling',      label: 'Labelling' },
  { key: 'sleeve_repair',  label: 'Sleeve Repair' },
  { key: 'general_repair', label: 'General Repair' },
  { key: 'fp_inject',      label: 'F&P to Inject' },
]

// Packed gowns only — ink/holes/repair are now global, not per-building
function emptyGownRow()   { return { blue: '', white: '', grey: '' } }
// Global rejects/repairs entered once, then split across buildings by allocation %
function emptyRejectRow() { return { ink: '', holes: '', repair: '' } }
function emptyRepairs()   { return { labelling: '', sleeve_repair: '', general_repair: '', fp_inject: '' } }

function emptyState(buildings = []) {
  return {
    gowns:        Object.fromEntries(buildings.map(b => [b.id, Object.fromEntries(SIZES.map(s => [s, emptyGownRow()]))])),
    bags:         Object.fromEntries(buildings.map(b => [b.id, ''])),
    rejectGowns:  Object.fromEntries(SIZES.map(s => [s, emptyRejectRow()])),
    repairs:      emptyRepairs(),
  }
}

// Default equal-split allocation for a list of buildings
function defaultAlloc(buildings) {
  if (!buildings.length) return {}
  const base = Math.floor(100 / buildings.length)
  const rem  = 100 - base * buildings.length
  return Object.fromEntries(buildings.map((b, i) => [b.id, base + (i === 0 ? rem : 0)]))
}

// ─── LocalStorage helpers ──────────────────────────────────────
const lsSave  = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
const lsLoad  = (k)    => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }
const lsClear = (k)    => { try { localStorage.removeItem(k) } catch {} }
const allocKey = (cid) => `tfhq-alloc-v1-${cid}`

// ─── Number input ──────────────────────────────────────────────
function N({ value, onChange, accent, small }) {
  const colours = {
    blue:   'border-blue-200   bg-blue-50   text-blue-800   focus:ring-blue-400',
    white:  'border-gray-300   bg-white     text-gray-900   focus:ring-gray-400',
    grey:   'border-gray-400   bg-gray-100  text-gray-700   focus:ring-gray-500',
    ink:    'border-red-200    bg-red-50    text-red-700    focus:ring-red-400',
    holes:  'border-orange-200 bg-orange-50 text-orange-700 focus:ring-orange-400',
    repair: 'border-amber-200  bg-amber-50  text-amber-700  focus:ring-amber-400',
    bag:    'border-purple-200 bg-purple-50 text-purple-800 focus:ring-purple-400',
    plain:  'border-gray-200   bg-white     text-gray-900   focus:ring-navy-400',
  }
  return (
    <input
      type="number"
      min="0"
      inputMode="numeric"
      placeholder="—"
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`${small ? 'h-9' : 'h-11'} w-full rounded-lg border text-center font-semibold
        focus:outline-none focus:ring-1 transition-colors ${colours[accent || 'plain']}`}
      style={{ fontSize: 16 }}
    />
  )
}

// ─── Productivity badge ────────────────────────────────────────
function ProductivityBadge({ total, shiftHours, staffCount, targetRate }) {
  if (!total || !shiftHours || !staffCount || !targetRate) return null
  const sh = parseFloat(shiftHours) || 0
  const sc = parseInt(staffCount) || 1
  const tr = parseInt(targetRate) || 60
  if (!sh) return null

  const actualRate   = Math.round(total / sh / sc)
  const expectedHrs  = (total / (sc * tr)).toFixed(1)
  const efficiency   = Math.round((actualRate / tr) * 100)
  const isGood       = efficiency >= 100
  const isOk         = efficiency >= 80

  return (
    <div className={`rounded-xl p-4 border text-sm space-y-2 ${
      isGood ? 'bg-green-50 border-green-200' : isOk ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'
    }`}>
      <div className="flex items-center gap-2 font-semibold text-gray-800">
        <TrendingUp size={15} className={isGood ? 'text-green-600' : isOk ? 'text-amber-600' : 'text-red-500'} />
        Productivity — {efficiency}% {isGood ? '🟢' : isOk ? '🟡' : '🔴'}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-xs text-gray-500">Actual rate</p>
          <p className="font-bold text-gray-800">{actualRate}<span className="text-xs font-normal text-gray-500">/hr/person</span></p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Target</p>
          <p className="font-bold text-gray-800">{tr}<span className="text-xs font-normal text-gray-500">/hr/person</span></p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Expected hrs</p>
          <p className="font-bold text-gray-800">{expectedHrs}<span className="text-xs font-normal text-gray-500"> hrs</span></p>
        </div>
      </div>
    </div>
  )
}

// ─── Building card (Mobile) — packed gowns only ─────────────────
function BuildingCard({ building, gowns, bags, onGown, onBag }) {
  const totals = SIZES.reduce((a, s) => {
    const r = gowns[s] || emptyGownRow()
    a.blue  += +r.blue  || 0
    a.white += +r.white || 0
    a.grey  += +r.grey  || 0
    return a
  }, { blue: 0, white: 0, grey: 0 })

  const total = totals.blue + totals.white + totals.grey

  return (
    <div className="space-y-3">
      {/* Building header + bag count */}
      <div className="flex items-center justify-between bg-navy-700 text-white px-4 py-3 rounded-xl">
        <div className="min-w-0 flex-1 pr-3">
          <p className="font-bold text-base">{building.name}</p>
          {total > 0 && (
            <p className="text-xs text-navy-300 mt-0.5">{total.toLocaleString()} gowns packed</p>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-xs text-navy-300 mb-1 flex items-center justify-end gap-1">
            <Package size={12} />
            {building.bag_color ? `${building.bag_color} bags` : 'Bags'}
          </p>
          <input
            type="number" min="0" inputMode="numeric" placeholder="0"
            value={bags}
            onChange={e => onBag(e.target.value)}
            className="w-16 h-10 rounded-lg bg-navy-600 border border-navy-500 text-white text-center font-bold focus:outline-none focus:ring-1 focus:ring-gold-400"
            style={{ fontSize: 16 }}
          />
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-4 gap-2 px-1">
        <div className="text-xs font-bold text-gray-400 uppercase text-center">Size</div>
        <div className="text-xs font-bold text-blue-600  text-center">Blue</div>
        <div className="text-xs font-bold text-gray-500  text-center">White</div>
        <div className="text-xs font-bold text-gray-500  text-center">Grey</div>
      </div>

      {/* Size rows — packed gowns only */}
      {SIZES.map((size, si) => {
        const r = gowns[size] || emptyGownRow()
        return (
          <div key={size} className={`grid grid-cols-4 gap-2 items-center px-1 py-1 rounded-lg ${si % 2 !== 0 ? 'bg-gray-50' : ''}`}>
            <div className="flex items-center justify-center">
              <span className="w-11 h-11 bg-navy-100 text-navy-700 rounded-lg font-bold text-sm flex items-center justify-center">
                {size}
              </span>
            </div>
            <N value={r.blue}  onChange={v => onGown(size, 'blue',  v)} accent="blue" />
            <N value={r.white} onChange={v => onGown(size, 'white', v)} accent="white" />
            <N value={r.grey}  onChange={v => onGown(size, 'grey',  v)} accent="grey" />
          </div>
        )
      })}

      {/* Totals row */}
      {total > 0 && (
        <div className="grid grid-cols-4 gap-2 px-1 bg-navy-50 rounded-xl py-2.5 border border-navy-100">
          <div className="text-xs font-bold text-navy-700 text-center flex items-center justify-center">Total</div>
          <div className="text-sm font-bold text-blue-700  text-center">{totals.blue  || '—'}</div>
          <div className="text-sm font-bold text-gray-700  text-center">{totals.white || '—'}</div>
          <div className="text-sm font-bold text-gray-600  text-center">{totals.grey  || '—'}</div>
        </div>
      )}
    </div>
  )
}

// ─── Desktop table — packed gowns only ─────────────────────────
function DesktopTable({ buildings, gowns, bags, onGown, onBag }) {
  const bldgTotals = (bid) => SIZES.reduce((a, s) => {
    const r = (gowns[bid] || {})[s] || emptyGownRow()
    a.blue  += +r.blue  || 0; a.white += +r.white || 0; a.grey += +r.grey || 0
    return a
  }, { blue: 0, white: 0, grey: 0 })

  const rowTotals = (size) => buildings.reduce((a, b) => {
    const r = (gowns[b.id] || {})[size] || emptyGownRow()
    a.blue  += +r.blue  || 0; a.white += +r.white || 0; a.grey += +r.grey || 0
    return a
  }, { blue: 0, white: 0, grey: 0 })

  const grand = buildings.reduce((a, b) => {
    const t = bldgTotals(b.id)
    a.blue += t.blue; a.white += t.white; a.grey += t.grey
    return a
  }, { blue: 0, white: 0, grey: 0 })

  // 3 cols per building: Blue | White | Grey
  const minW = Math.max(600, buildings.length * 220 + 160)

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="border-collapse w-full" style={{ minWidth: minW }}>
        <thead>
          {/* Row 1: Building names + bag inputs */}
          <tr>
            <th className="sticky left-0 z-20 bg-navy-900 text-white px-4 py-2 text-left text-xs font-bold w-16" rowSpan={2}>
              SIZE
            </th>
            {buildings.map((b, bi) => {
              const t = bldgTotals(b.id)
              const total = t.blue + t.white + t.grey
              return (
                <th key={b.id} colSpan={3}
                  className={`px-3 py-2 border-l-2 border-navy-900 text-white text-center ${bi % 2 === 0 ? 'bg-navy-700' : 'bg-navy-600'}`}>
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    <span className="font-bold text-sm">{b.name}</span>
                    {total > 0 && <span className="text-xs text-navy-300">{total.toLocaleString()} packed</span>}
                    <span className="flex items-center gap-1.5 ml-2">
                      <Package size={12} className="text-navy-300" />
                      <span className="text-xs text-navy-300">{b.bag_color || 'Bags'}:</span>
                      <input
                        type="number" min="0" inputMode="numeric" placeholder="0"
                        value={bags[b.id] || ''}
                        onChange={e => onBag(b.id, e.target.value)}
                        className="w-14 h-7 rounded-lg bg-navy-800 border border-navy-500 text-white text-center text-sm font-bold focus:outline-none focus:ring-1 focus:ring-gold-400"
                      />
                    </span>
                  </div>
                </th>
              )
            })}
            {/* Grand total header */}
            <th colSpan={3} className="px-3 py-2 border-l-2 border-navy-500 text-white text-center text-xs font-bold whitespace-nowrap"
              style={{ background: '#06111e' }}>
              ALL TOTALS
            </th>
          </tr>
          {/* Row 2: Sub-column labels */}
          <tr>
            {buildings.map((b) =>
              [
                { lbl: 'Blue',  txt: 'text-blue-700', bg: 'bg-blue-50'  },
                { lbl: 'White', txt: 'text-gray-600', bg: 'bg-gray-50'  },
                { lbl: 'Grey',  txt: 'text-gray-500', bg: 'bg-gray-100' },
              ].map(({ lbl, txt, bg }, ci) => (
                <th key={`${b.id}-${lbl}`}
                  className={`px-1 py-1.5 text-center text-xs font-semibold border-b border-gray-200 ${txt} ${bg}
                    ${ci === 0 ? 'border-l-2 border-l-navy-700' : ''} ${ci === 2 ? 'border-r-2 border-r-navy-700' : ''}`}
                  style={{ minWidth: 60 }}>
                  {lbl}
                </th>
              ))
            )}
            {[
              { lbl: 'Blue',  txt: 'text-blue-700' },
              { lbl: 'White', txt: 'text-gray-600' },
              { lbl: 'Grey',  txt: 'text-gray-500' },
            ].map(({ lbl, txt }) => (
              <th key={lbl} className={`px-2 py-1.5 text-center text-xs font-semibold border-b border-gray-200 border-l border-l-gray-300 ${txt}`}
                style={{ background: '#f0f4fa', minWidth: 60 }}>
                {lbl}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {SIZES.map((size, si) => {
            const rt = rowTotals(size)
            return (
              <tr key={size} className={si % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                <td className="sticky left-0 z-10 bg-inherit px-2 py-1.5 border-r border-gray-200">
                  <span className="w-11 h-9 bg-navy-100 text-navy-700 rounded-lg font-bold text-sm flex items-center justify-center">
                    {size}
                  </span>
                </td>
                {buildings.map((b) => {
                  const r = (gowns[b.id] || {})[size] || emptyGownRow()
                  return [
                    { field: 'blue',  acc: 'blue',  border: 'border-l-2 border-l-gray-300' },
                    { field: 'white', acc: 'white', border: '' },
                    { field: 'grey',  acc: 'grey',  border: 'border-r-2 border-r-gray-300' },
                  ].map(({ field, acc, border }) => (
                    <td key={`${b.id}-${field}`} className={`px-1 py-1.5 ${border}`}>
                      <N value={r[field]} onChange={v => onGown(b.id, size, field, v)} accent={acc} small />
                    </td>
                  ))
                })}
                {[
                  { v: rt.blue,  cls: 'text-blue-700' },
                  { v: rt.white, cls: 'text-gray-700' },
                  { v: rt.grey,  cls: 'text-gray-600' },
                ].map(({ v, cls }, i) => (
                  <td key={i} className={`px-2 py-1.5 text-center text-sm font-bold border-l border-l-gray-200 ${cls}`}
                    style={{ background: '#f0f4fa' }}>
                    {v || <span className="text-gray-300 font-normal">—</span>}
                  </td>
                ))}
              </tr>
            )
          })}

          {/* Grand totals row */}
          <tr className="bg-navy-800 text-white">
            <td className="sticky left-0 z-10 bg-navy-800 px-3 py-2.5 text-xs font-bold tracking-wider">TOTALS</td>
            {buildings.map(b => {
              const t = bldgTotals(b.id)
              return [
                { v: t.blue,  cls: 'text-blue-200' },
                { v: t.white, cls: 'text-gray-100' },
                { v: t.grey,  cls: 'text-gray-300' },
              ].map(({ v, cls }, i) => (
                <td key={`${b.id}-tot-${i}`}
                  className={`px-1 py-2.5 text-center text-sm font-bold border-navy-700
                    ${i === 0 ? 'border-l-2' : ''} ${i === 2 ? 'border-r-2' : 'border-r border-r-navy-700'} ${cls}`}>
                  {v || '—'}
                </td>
              ))
            })}
            {[
              { v: grand.blue,  cls: 'text-blue-200' },
              { v: grand.white, cls: 'text-white'    },
              { v: grand.grey,  cls: 'text-gray-300' },
            ].map(({ v, cls }, i) => (
              <td key={`grand-${i}`} className={`px-2 py-2.5 text-center text-sm font-bold border-l border-l-navy-600 ${cls}`}
                style={{ background: '#06111e' }}>
                {v || '—'}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ─── Rejects & Repairs section ─────────────────────────────────
// Ink stain / holes / repair are entered as site-wide totals (per size),
// then automatically allocated across buildings by configurable percentages.
function RejectsRepairsSection({ rejectGowns, onReject, buildings, allocPcts, onAllocChange }) {
  const [showEdit, setShowEdit] = useState(false)

  const grandTotals = SIZES.reduce((a, s) => {
    const r = rejectGowns[s] || emptyRejectRow()
    a.ink    += +r.ink    || 0
    a.holes  += +r.holes  || 0
    a.repair += +r.repair || 0
    return a
  }, { ink: 0, holes: 0, repair: 0 })
  const hasAny = grandTotals.ink + grandTotals.holes + grandTotals.repair > 0

  const totalAllocPct = Object.values(allocPcts).reduce((s, v) => s + (+v || 0), 0)
  const allocValid    = Math.round(totalAllocPct) === 100

  return (
    <div className="card p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-800">Rejects &amp; Repairs</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Ink &amp; Holes = site-wide totals · Repairs split by building %
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowEdit(e => !e)}
          className="btn-secondary btn-sm flex items-center gap-1.5"
        >
          <Settings size={13} />
          {showEdit ? 'Done' : 'Repair Alloc %'}
        </button>
      </div>

      {/* Allocation editor */}
      {showEdit && (
        <div className="bg-gray-50 rounded-xl p-3 space-y-2 border border-gray-200">
          <p className="text-xs font-semibold text-gray-600 mb-1">
            Repair distribution across buildings — must total 100%
          </p>
          <p className="text-xs text-gray-400 mb-2">
            Ink Stain &amp; Large Holes are not split — they are recorded as site-wide totals.
          </p>
          {buildings.map(b => (
            <div key={b.id} className="flex items-center gap-3">
              <span className="flex-1 text-sm font-medium text-gray-700">{b.name}</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number" min="0" max="100" inputMode="numeric"
                  value={allocPcts[b.id] ?? ''}
                  onChange={e => onAllocChange(b.id, e.target.value)}
                  className="w-16 h-10 rounded-lg border text-center text-sm font-bold focus:outline-none focus:ring-1 focus:ring-navy-500
                    border-gray-300 bg-white text-gray-900"
                  style={{ fontSize: 16 }}
                />
                <span className="text-sm font-semibold text-gray-500">%</span>
              </div>
            </div>
          ))}
          <div className={`flex items-center justify-between pt-2 border-t border-gray-200 text-sm font-semibold ${allocValid ? 'text-green-600' : 'text-red-500'}`}>
            <span>Total</span>
            <span>{totalAllocPct}% {allocValid ? '✓' : '— must equal 100%'}</span>
          </div>
        </div>
      )}

      {/* Per-size reject/repair inputs */}
      <div className="space-y-2">
        {/* Column headers */}
        <div className="grid grid-cols-4 gap-2 px-1">
          <div className="text-xs font-bold text-gray-400 uppercase text-center">Size</div>
          <div className="text-xs font-bold text-red-500    text-center leading-tight">
            Ink Stain<br/><span className="text-[10px] font-normal text-gray-400">site total</span>
          </div>
          <div className="text-xs font-bold text-orange-500 text-center leading-tight">
            Holes<br/><span className="text-[10px] font-normal text-gray-400">site total</span>
          </div>
          <div className="text-xs font-bold text-amber-500  text-center leading-tight">
            Repair<br/><span className="text-[10px] font-normal text-gray-400">split by %</span>
          </div>
        </div>

        {SIZES.map((size, si) => {
          const r = rejectGowns[size] || emptyRejectRow()
          return (
            <div key={size} className={`grid grid-cols-4 gap-2 items-center px-1 py-1 rounded-lg ${si % 2 !== 0 ? 'bg-gray-50' : ''}`}>
              <div className="flex items-center justify-center">
                <span className="w-11 h-11 bg-navy-100 text-navy-700 rounded-lg font-bold text-sm flex items-center justify-center">
                  {size}
                </span>
              </div>
              <N value={r.ink}    onChange={v => onReject(size, 'ink',    v)} accent="ink" />
              <N value={r.holes}  onChange={v => onReject(size, 'holes',  v)} accent="holes" />
              <N value={r.repair} onChange={v => onReject(size, 'repair', v)} accent="repair" />
            </div>
          )
        })}

        {/* Grand totals row */}
        {hasAny && (
          <div className="grid grid-cols-4 gap-2 px-1 bg-red-50 rounded-xl py-2.5 border border-red-100">
            <div className="text-xs font-bold text-red-700 text-center flex items-center justify-center">Total</div>
            <div className="text-sm font-bold text-red-700    text-center">{grandTotals.ink    || '—'}</div>
            <div className="text-sm font-bold text-orange-700 text-center">{grandTotals.holes  || '—'}</div>
            <div className="text-sm font-bold text-amber-700  text-center">{grandTotals.repair || '—'}</div>
          </div>
        )}
      </div>

      {/* Repair allocation preview — only repairs are split across buildings */}
      {grandTotals.repair > 0 && buildings.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Repair allocation to buildings
          </p>
          {buildings.map(b => {
            const pct = (allocPcts[b.id] || 0) / 100
            const rep = Math.round(grandTotals.repair * pct)
            if (!rep) return null
            return (
              <div key={b.id} className="flex items-center gap-3 bg-amber-50 rounded-xl px-3 py-2.5 border border-amber-100">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">{b.name}</p>
                  <p className="text-xs text-gray-400">{allocPcts[b.id] || 0}% allocation</p>
                </div>
                <div className="flex gap-3 text-xs font-semibold">
                  <span className="text-amber-700">{rep} repairs</span>
                </div>
              </div>
            )
          })}
          {!allocValid && (
            <p className="text-xs text-red-500 text-center">
              ⚠ Repair allocation % must total 100% before submitting
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Data hooks ────────────────────────────────────────────────
function useClients(userId, isAdmin) {
  return useQuery({
    queryKey: ['my-clients', userId, isAdmin],
    queryFn: async () => {
      const q = supabase
        .from('laundry_clients')
        .select('id, name, staff_count, target_gowns_per_hour, laundry_buildings(id, name, active, sort_order, bag_color, reject_pct)')
        .eq('active', true).order('name')
      if (!isAdmin) {
        const { data: acc } = await supabase.from('laundry_staff_access').select('client_id').eq('staff_id', userId)
        const ids = (acc || []).map(a => a.client_id)
        if (!ids.length) return []
        return (await q.in('id', ids)).data || []
      }
      return (await q).data || []
    },
    enabled: !!userId,
  })
}

function useExistingData(clientId, date) {
  return useQuery({
    queryKey: ['existing-entry', clientId, date],
    queryFn: async () => {
      if (!clientId || !date) return { logs: [], extras: null }
      const [logsRes, extrasRes] = await Promise.all([
        supabase.from('laundry_logs')
          .select('id, building_id, status, laundry_log_rows(*)')
          .eq('client_id', clientId).eq('log_date', date),
        supabase.from('laundry_daily_extras')
          .select('*').eq('client_id', clientId).eq('log_date', date).maybeSingle(),
      ])
      return { logs: logsRes.data || [], extras: extrasRes.data }
    },
    enabled: !!clientId && !!date,
  })
}

// ─── Main ──────────────────────────────────────────────────────
export default function StaffNewEntry() {
  const { user, isAdmin } = useAuth()
  const qc = useQueryClient()

  const [date, setDate]               = useState(todayStr())
  const [clientId, setClient]         = useState('')
  const [gowns, setGowns]             = useState({})
  const [bags, setBags]               = useState({})
  const [rejectGowns, setRejectGowns] = useState(Object.fromEntries(SIZES.map(s => [s, emptyRejectRow()])))
  const [allocPcts, setAllocPcts]     = useState({})  // { buildingId: number }
  const [repairs, setRepairs]         = useState(emptyRepairs())
  const [notes, setNotes]             = useState('')
  const [shiftHours, setShiftHrs]     = useState('')
  const [staffOnShift, setStaffN]     = useState('')
  const [rosterFilled, setRosterFilled] = useState(false)
  const [activeIdx, setActiveIdx]     = useState(0)
  const [done, setDone]               = useState(false)
  const initialized = useRef(false)

  // Roster hours for the selected date
  const { entry: rosterEntry, isError: rosterError } = useRosterForDate(date)

  const { data: clients = [] }                       = useClients(user?.id, isAdmin)
  const { data: existing = { logs: [], extras: null } } = useExistingData(clientId, date)

  const selectedClient   = clients.find(c => c.id === clientId)
  const buildings        = (selectedClient?.laundry_buildings || [])
    .filter(b => b.active)
    .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99) || a.name.localeCompare(b.name))
  const targetRate       = selectedClient?.target_gowns_per_hour || 60
  const defaultStaff     = selectedClient?.staff_count || 3

  // ── Restore draft ──
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const draft = lsLoad(STORAGE_KEY)
    if (draft) {
      if (draft.date)         setDate(draft.date)
      if (draft.clientId)     setClient(draft.clientId)
      if (draft.gowns)        setGowns(draft.gowns)
      if (draft.bags)         setBags(draft.bags)
      if (draft.rejectGowns)  setRejectGowns(draft.rejectGowns)
      if (draft.repairs)      setRepairs(draft.repairs)
      if (draft.notes)        setNotes(draft.notes)
      if (draft.shiftHours)   setShiftHrs(draft.shiftHours)
      if (draft.staffOnShift) setStaffN(draft.staffOnShift)
      toast('Draft restored', { icon: '📋' })
    }
  }, [])

  // ── Auto-select single client ──
  useEffect(() => {
    if (clients.length === 1 && !clientId) setClient(clients[0].id)
  }, [clients])

  // ── Init new buildings in state ──
  useEffect(() => {
    if (!buildings.length) return
    setGowns(prev => {
      const next = { ...prev }
      buildings.forEach(b => { if (!next[b.id]) next[b.id] = Object.fromEntries(SIZES.map(s => [s, emptyGownRow()])) })
      return next
    })
    setBags(prev => {
      const next = { ...prev }
      buildings.forEach(b => { if (next[b.id] === undefined) next[b.id] = '' })
      return next
    })
    // Load allocation % — priority: DB reject_pct → localStorage → equal split
    const dbTotal = buildings.reduce((s, b) => s + (parseFloat(b.reject_pct) || 0), 0)
    if (dbTotal > 0) {
      // Always use admin-configured reject percentages from the database
      setAllocPcts(Object.fromEntries(buildings.map(b => [b.id, parseFloat(b.reject_pct) || 0])))
    } else {
      const saved = lsLoad(allocKey(clientId))
      if (saved && Object.keys(saved).length === buildings.length) {
        setAllocPcts(saved)
      } else {
        setAllocPcts(defaultAlloc(buildings))
      }
    }
  }, [clientId, buildings.map(b => b.id).join()])

  // ── Load existing data ──
  useEffect(() => {
    if (!existing.logs.length && !existing.extras) return
    if (existing.logs.length) {
      // Restore packed gowns per building
      setGowns(prev => {
        const next = { ...prev }
        existing.logs.forEach(log => {
          const bid = log.building_id
          if (!next[bid]) next[bid] = Object.fromEntries(SIZES.map(s => [s, emptyGownRow()]))
          ;(log.laundry_log_rows || []).forEach(r => {
            if (next[bid][r.size_label] !== undefined) {
              next[bid][r.size_label] = {
                blue:  r.blue_gowns  || '',
                white: r.white_gowns || '',
                grey:  r.grey_gowns  || '',
              }
            }
          })
        })
        return next
      })
      // Reconstruct global reject/repair totals by summing across all buildings
      setRejectGowns(() => {
        const totals = Object.fromEntries(SIZES.map(s => [s, { ink: 0, holes: 0, repair: 0 }]))
        existing.logs.forEach(log => {
          ;(log.laundry_log_rows || []).forEach(r => {
            if (totals[r.size_label]) {
              totals[r.size_label].ink    += r.ink_stain   || 0
              totals[r.size_label].holes  += r.large_holes || 0
              totals[r.size_label].repair += r.to_repair   || 0
            }
          })
        })
        return Object.fromEntries(Object.entries(totals).map(([s, v]) => [s, {
          ink:    v.ink    || '',
          holes:  v.holes  || '',
          repair: v.repair || '',
        }]))
      })
    }
    if (existing.extras) {
      const bc = existing.extras.bag_counts || {}
      setBags(prev => ({ ...prev, ...Object.fromEntries(Object.entries(bc).map(([k, v]) => [k, v || ''])) }))
      setRepairs({
        labelling:      existing.extras.labelling      || '',
        sleeve_repair:  existing.extras.sleeve_repair  || '',
        general_repair: existing.extras.general_repair || '',
        fp_inject:      existing.extras.fp_inject      || '',
      })
      if (existing.extras.shift_hours)   setShiftHrs(existing.extras.shift_hours.toString())
      if (existing.extras.staff_on_shift) setStaffN(existing.extras.staff_on_shift.toString())
    }
  }, [existing.logs.map(l => l.id).join(), existing.extras?.id])

  // ── Auto-fill shift details from roster ──
  // Only fires when roster data arrives for the selected date AND the
  // fields are still blank (don't overwrite what staff already typed).
  useEffect(() => {
    if (!rosterEntry || rosterEntry.totalHours === 0) {
      setRosterFilled(false)
      return
    }
    // If both fields are blank, auto-fill from roster
    if (!shiftHours && !staffOnShift) {
      setShiftHrs(rosterEntry.totalHours.toString())
      setStaffN(rosterEntry.staffCount.toString())
      setRosterFilled(true)
    }
  }, [rosterEntry?.totalHours, rosterEntry?.staffCount, date])

  // Clear roster-filled flag when date changes so it can re-trigger
  useEffect(() => { setRosterFilled(false) }, [date])

  // ── Persist draft to localStorage ──
  useEffect(() => {
    if (!clientId) return
    lsSave(STORAGE_KEY, { date, clientId, gowns, bags, rejectGowns, repairs, notes, shiftHours, staffOnShift })
  }, [date, clientId, gowns, bags, rejectGowns, repairs, notes, shiftHours, staffOnShift])

  // ── Persist allocation percentages separately (per client) ──
  useEffect(() => {
    if (!clientId || !Object.keys(allocPcts).length) return
    lsSave(allocKey(clientId), allocPcts)
  }, [clientId, JSON.stringify(allocPcts)])

  // ── Updaters ──
  function setGown(bid, size, field, val) {
    setGowns(p => ({ ...p, [bid]: { ...p[bid], [size]: { ...(p[bid]?.[size] || emptyGownRow()), [field]: val } } }))
  }
  function setBag(bid, val)    { setBags(p => ({ ...p, [bid]: val })) }
  function setRepair(key, val) { setRepairs(p => ({ ...p, [key]: val })) }
  function setReject(size, field, val) {
    setRejectGowns(p => ({ ...p, [size]: { ...(p[size] || emptyRejectRow()), [field]: val } }))
  }
  function setAllocPct(bid, val) {
    setAllocPcts(p => ({ ...p, [bid]: val === '' ? '' : +val }))
  }

  function clearAll() {
    if (!confirm('Clear all data and start fresh?')) return
    const blank = emptyState(buildings)
    setGowns(blank.gowns); setBags(blank.bags)
    setRejectGowns(blank.rejectGowns); setRepairs(blank.repairs)
    setNotes(''); setShiftHrs(''); setStaffN(''); setDone(false); lsClear(STORAGE_KEY)
    toast.success('Cleared')
  }

  // ── Grand totals ──
  const grand = buildings.reduce((a, b) => {
    SIZES.forEach(s => {
      const r = (gowns[b.id] || {})[s] || emptyGownRow()
      a.blue  += +r.blue  || 0; a.white += +r.white || 0; a.grey += +r.grey || 0
    })
    return a
  }, { blue: 0, white: 0, grey: 0 })
  grand.total = grand.blue + grand.white + grand.grey
  grand.bags  = buildings.reduce((s, b) => s + (+bags[b.id] || 0), 0)

  const grandRejects = SIZES.reduce((a, s) => {
    const r = rejectGowns[s] || emptyRejectRow()
    a.ink    += +r.ink    || 0
    a.holes  += +r.holes  || 0
    a.repair += +r.repair || 0
    return a
  }, { ink: 0, holes: 0, repair: 0 })
  grandRejects.total   = grandRejects.ink + grandRejects.holes
  grand.repairTotal    = Object.values(repairs).reduce((s, v) => s + (+v || 0), 0)

  const allocValid = Math.round(Object.values(allocPcts).reduce((s, v) => s + (+v || 0), 0)) === 100

  const hasData = grand.total > 0 || grand.bags > 0 || grand.repairTotal > 0
    || grandRejects.ink > 0 || grandRejects.holes > 0 || grandRejects.repair > 0

  // Productivity calcs for live preview
  const sh    = parseFloat(shiftHours) || 0
  const sc    = parseInt(staffOnShift) || defaultStaff
  const showProductivity = sh > 0 && grand.total > 0

  // ── Submit ──
  const submit = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error('Select a client')

      if (!allocValid && grandRejects.repair > 0) {
        throw new Error('Allocation percentages must total 100% before submitting repairs')
      }

      for (const b of buildings) {
        const bid     = b.id
        const pct     = (allocPcts[bid] || 0) / 100
        // Ink stain & large holes are global site-wide totals — stored on the first building only
        const isFirst = bid === buildings[0].id
        const rowData = SIZES.map((size, i) => {
          const r  = (gowns[bid] || {})[size] || emptyGownRow()
          const rj = rejectGowns[size]        || emptyRejectRow()
          return {
            size_label:  size,
            sort_order:  i,
            blue_gowns:  +r.blue  || 0,
            white_gowns: +r.white || 0,
            grey_gowns:  +r.grey  || 0,
            qty_packed:  (+r.blue || 0) + (+r.white || 0) + (+r.grey || 0),
            // Ink stain & holes are global totals — only written to the first/primary building
            ink_stain:   isFirst ? (+rj.ink   || 0) : 0,
            large_holes: isFirst ? (+rj.holes || 0) : 0,
            // Repairs are split across buildings by the configured allocation %
            to_repair:   Math.round((+rj.repair || 0) * pct),
          }
        }).filter(r => r.qty_packed || r.ink_stain || r.large_holes || r.to_repair)

        if (!rowData.length) continue

        const totalPacked   = rowData.reduce((s, r) => s + r.qty_packed, 0)
        const existing_log  = existing.logs.find(l => l.building_id === bid)

        if (existing_log) {
          await supabase.from('laundry_log_rows').delete().eq('log_id', existing_log.id)
          await supabase.from('laundry_log_rows').insert(rowData.map(r => ({ ...r, log_id: existing_log.id })))
          await supabase.from('laundry_logs').update({
            total_packed: totalPacked, updated_at: new Date().toISOString(), status: 'submitted',
          }).eq('id', existing_log.id)
        } else {
          const { data: log, error } = await supabase.from('laundry_logs')
            .insert({ client_id: clientId, building_id: bid, log_date: date, submitted_by: user.id, status: 'submitted', total_packed: totalPacked })
            .select().single()
          if (error) throw error
          await supabase.from('laundry_log_rows').insert(rowData.map(r => ({ ...r, log_id: log.id })))
        }
      }

      // Daily extras (bags + repairs + shift data)
      const bagCounts = Object.fromEntries(buildings.map(b => [b.id, +bags[b.id] || 0]))
      const extrasPayload = {
        client_id:      clientId,
        log_date:       date,
        submitted_by:   user.id,
        bag_counts:     bagCounts,
        labelling:      +repairs.labelling      || 0,
        sleeve_repair:  +repairs.sleeve_repair  || 0,
        general_repair: +repairs.general_repair || 0,
        fp_inject:      +repairs.fp_inject      || 0,
        shift_hours:    parseFloat(shiftHours) || null,
        staff_on_shift: parseInt(staffOnShift) || null,
        notes,
        updated_at:     new Date().toISOString(),
      }
      const { error: extErr } = await supabase.from('laundry_daily_extras')
        .upsert(extrasPayload, { onConflict: 'client_id,log_date' })
      if (extErr) throw extErr
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['existing-entry', clientId, date] })
      qc.invalidateQueries(['my-history']); qc.invalidateQueries(['dashboard'])
      lsClear(STORAGE_KEY)
      setDone(true)
      toast.success('Submitted!')
    },
    onError: err => toast.error(err.message),
  })

  // ── After submit: go blank ──
  function startNewDay() {
    setDate(todayStr())
    const blank = emptyState(buildings)
    setGowns(blank.gowns); setBags(blank.bags)
    setRejectGowns(blank.rejectGowns); setRepairs(blank.repairs)
    setNotes(''); setShiftHrs(''); setStaffN(''); setDone(false); setActiveIdx(0)
  }

  // ── Success screen ──
  if (done) {
    const sh2 = parseFloat(shiftHours) || 0
    const sc2 = parseInt(staffOnShift) || defaultStaff
    const actualRate  = sh2 > 0 && sc2 > 0 ? Math.round(grand.total / sh2 / sc2) : null
    const expectedHrs = sc2 > 0 && targetRate > 0 ? (grand.total / (sc2 * targetRate)).toFixed(1) : null
    const efficiency  = actualRate ? Math.round((actualRate / targetRate) * 100) : null

    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6">
        <div className="text-center max-w-sm w-full">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={44} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Submitted!</h2>
          <p className="text-gray-500 mt-2 mb-3">{format(new Date(date), 'EEEE d MMMM yyyy')}</p>

          {/* Gown summary */}
          <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-1.5 mb-4 text-left">
            <div className="flex justify-between"><span className="text-gray-500">Total Gowns</span><span className="font-bold text-navy-700">{grand.total.toLocaleString()}</span></div>
            {grand.blue  > 0 && <div className="flex justify-between"><span className="text-gray-500 pl-3">— Blue</span><span className="font-semibold text-blue-700">{grand.blue}</span></div>}
            {grand.white > 0 && <div className="flex justify-between"><span className="text-gray-500 pl-3">— White</span><span className="font-semibold text-gray-700">{grand.white}</span></div>}
            {grand.grey  > 0 && <div className="flex justify-between"><span className="text-gray-500 pl-3">— Grey</span><span className="font-semibold text-gray-600">{grand.grey}</span></div>}
            <div className="flex justify-between border-t border-gray-200 pt-1.5 mt-1"><span className="text-gray-500">Rejects (ink + holes)</span><span className="font-bold text-red-600">{grandRejects.total}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Repairs</span><span className="font-bold text-amber-600">{grandRejects.repair}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Bags</span><span className="font-bold text-purple-700">{grand.bags}</span></div>
          </div>

          {/* Productivity summary */}
          {efficiency && (
            <div className={`rounded-xl p-4 text-sm mb-4 text-left ${efficiency >= 100 ? 'bg-green-50 border border-green-200' : efficiency >= 80 ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'}`}>
              <p className="font-bold text-gray-800 mb-2 flex items-center gap-2">
                <TrendingUp size={15} /> Productivity — {efficiency}% efficiency
              </p>
              <div className="space-y-1 text-gray-600">
                <div className="flex justify-between"><span>Actual gowns/hr per person</span><span className="font-bold text-gray-800">{actualRate}</span></div>
                <div className="flex justify-between"><span>Target gowns/hr per person</span><span className="font-semibold">{targetRate}</span></div>
                {expectedHrs && <div className="flex justify-between"><span>Expected hours</span><span className="font-semibold">{expectedHrs} hrs</span></div>}
                {sh2 > 0 && <div className="flex justify-between"><span>Actual hours</span><span className="font-semibold">{sh2} hrs</span></div>}
              </div>
            </div>
          )}

          <button onClick={startNewDay} className="btn-primary w-full py-3 text-base">
            Start Next Entry
          </button>
        </div>
      </div>
    )
  }

  // ── Normal render ──
  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-full">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Daily Log Entry</h1>
          {grand.total > 0 && (
            <p className="text-sm text-navy-600 font-medium mt-0.5">
              {grand.total.toLocaleString()} gowns · {grand.rejects} rejects · {grand.repair} repairs · {grand.bags} bags
            </p>
          )}
        </div>
        {hasData && (
          <button onClick={clearAll} className="btn-secondary text-red-600 border-red-200 hover:bg-red-50 btn-sm">
            <Trash2 size={14} /> Clear
          </button>
        )}
      </div>

      {/* Date + Client */}
      <div className="card p-4 grid grid-cols-2 gap-3">
        <div>
          <label className="label text-xs">Date</label>
          <input type="date" className="input" value={date} max={todayStr()}
            onChange={e => { setDate(e.target.value); setDone(false) }} />
        </div>
        <div>
          <label className="label text-xs">Client</label>
          <select className="input" value={clientId}
            onChange={e => { setClient(e.target.value); setGowns({}); setBags({}); setActiveIdx(0) }}>
            <option value="">Select…</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {existing.logs.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-sm text-amber-800">
          ⚠️ Existing entries found for this date — submitting will update them.
        </div>
      )}

      {clientId && buildings.length > 0 ? (
        <>
          {/* ── MOBILE: Building tabs + one building at a time ── */}
          <div className="lg:hidden space-y-4">
            {/* Building pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {buildings.map((b, i) => {
                const t = (gowns[b.id] ? SIZES.reduce((a, s) => {
                  const r = gowns[b.id][s] || emptyGownRow()
                  a += (+r.blue || 0) + (+r.white || 0) + (+r.grey || 0); return a
                }, 0) : 0)
                return (
                  <button key={b.id} onClick={() => setActiveIdx(i)}
                    className={`flex-shrink-0 px-5 py-2.5 rounded-full text-sm font-semibold transition-colors
                      ${activeIdx === i ? 'bg-navy-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 active:bg-gray-200'}`}>
                    {b.name}{t > 0 ? ` (${t})` : ''}
                  </button>
                )
              })}
            </div>

            {/* Active building card */}
            <div className="card p-4">
              <BuildingCard
                building={buildings[activeIdx]}
                gowns={(gowns[buildings[activeIdx]?.id] || {})}
                bags={bags[buildings[activeIdx]?.id] || ''}
                onGown={(size, field, val) => setGown(buildings[activeIdx].id, size, field, val)}
                onBag={val => setBag(buildings[activeIdx].id, val)}
              />
            </div>

            {/* Mobile prev/next */}
            {buildings.length > 1 && (
              <div className="flex gap-2">
                <button onClick={() => setActiveIdx(i => Math.max(0, i - 1))} disabled={activeIdx === 0}
                  className="btn-secondary flex-1 py-3 text-sm disabled:opacity-40">
                  <ChevronLeft size={18} /> {buildings[activeIdx - 1]?.name || 'Previous'}
                </button>
                <button onClick={() => setActiveIdx(i => Math.min(buildings.length - 1, i + 1))} disabled={activeIdx === buildings.length - 1}
                  className="btn-secondary flex-1 py-3 text-sm disabled:opacity-40">
                  {buildings[activeIdx + 1]?.name || 'Next'} <ChevronRight size={18} />
                </button>
              </div>
            )}
          </div>

          {/* ── DESKTOP: All buildings in table ── */}
          <div className="hidden lg:block">
            <DesktopTable
              buildings={buildings}
              gowns={gowns}
              bags={bags}
              onGown={setGown}
              onBag={setBag}
            />
          </div>

          {/* ── REJECTS & REPAIRS (global, auto-allocated) ── */}
          <RejectsRepairsSection
            rejectGowns={rejectGowns}
            onReject={setReject}
            buildings={buildings}
            allocPcts={allocPcts}
            onAllocChange={setAllocPct}
          />

          {/* ── PROCESS (labelling etc.) + BAGS ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Bags per building */}
            <div className="card p-4">
              <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Package size={16} className="text-purple-600" /> Bags per Building
              </h3>
              <div className="space-y-2">
                {buildings.map(b => (
                  <div key={b.id} className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">{b.name}</p>
                      {b.bag_color && <p className="text-xs text-gray-400">{b.bag_color} bags</p>}
                    </div>
                    <div className="w-28">
                      <N value={bags[b.id] || ''} onChange={v => setBag(b.id, v)} accent="bag" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Process items */}
            <div className="card p-4">
              <h3 className="font-semibold text-gray-800 mb-3">Process &amp; Labelling</h3>
              <div className="space-y-2">
                {REPAIR_FIELDS.map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-3">
                    <p className="flex-1 text-sm font-medium text-gray-700">{label}</p>
                    <div className="w-28">
                      <N value={repairs[key] || ''} onChange={v => setRepair(key, v)} accent="repair" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── SHIFT DETAILS ── */}
          <div className="card p-4">
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Clock size={16} className="text-navy-600" /> Shift Details
            </h3>

            {/* Roster auto-fill banner */}
            {rosterEntry && rosterEntry.totalHours > 0 && (
              <div className="mb-3 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2.5 text-sm">
                <div className="flex items-center gap-2 font-semibold text-indigo-800 mb-1">
                  <CalendarClock size={14} />
                  {rosterFilled ? 'Auto-filled from Roster' : 'Roster data available for this date'}
                </div>
                <div className="text-indigo-700 text-xs space-y-0.5">
                  <p>{rosterEntry.staffCount} staff · {rosterEntry.totalHours} total hrs logged in roster</p>
                  {rosterEntry.staff.map((s, i) => (
                    <p key={`${s.name}-${i}`} className="pl-2 text-indigo-500">
                      {s.name}: {s.hours} hrs
                      {s.start ? ` (${s.start}–${s.end})` : ''}
                    </p>
                  ))}
                </div>
                {!rosterFilled && (
                  <button
                    onClick={() => { setShiftHrs(rosterEntry.totalHours.toString()); setStaffN(rosterEntry.staffCount.toString()); setRosterFilled(true) }}
                    className="mt-2 text-xs font-semibold text-indigo-700 underline"
                  >
                    Apply roster hours →
                  </button>
                )}
              </div>
            )}

            {rosterError && (
              <div className="mb-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
                ⚠ Could not connect to roster — enter shift details manually below.
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="label text-xs flex items-center gap-1.5">
                  <Users size={12} /> Staff on Shift Today
                </label>
                <input
                  type="number" min="1" max="50" inputMode="numeric"
                  className="input text-center font-semibold"
                  placeholder={defaultStaff.toString()}
                  value={staffOnShift}
                  onChange={e => { setStaffN(e.target.value); setRosterFilled(false) }}
                />
                <p className="text-xs text-gray-400 mt-1">Default: {defaultStaff} staff</p>
              </div>
              <div>
                <label className="label text-xs flex items-center gap-1.5">
                  <Clock size={12} /> Total Hours Worked
                </label>
                <input
                  type="number" min="0.5" max="24" step="0.5" inputMode="decimal"
                  className="input text-center font-semibold"
                  placeholder="e.g. 8"
                  value={shiftHours}
                  onChange={e => { setShiftHrs(e.target.value); setRosterFilled(false) }}
                />
                <p className="text-xs text-gray-400 mt-1">Combined hours all staff</p>
              </div>
            </div>

            {/* Live productivity display */}
            {showProductivity && (
              <ProductivityBadge
                total={grand.total}
                shiftHours={shiftHours}
                staffCount={staffOnShift || defaultStaff}
                targetRate={targetRate}
              />
            )}
            {!showProductivity && grand.total > 0 && !sh && (
              <p className="text-xs text-gray-400 text-center py-2">
                Enter hours worked above to see productivity
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="card p-4">
            <label className="label text-xs">Notes (optional)</label>
            <textarea className="input" rows={2} placeholder="Any notes…"
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          {/* Submit */}
          <button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || !hasData}
            className="btn-primary w-full py-4 text-base"
          >
            {submit.isPending
              ? <span className="flex items-center gap-2 justify-center"><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Submitting…</span>
              : <span className="flex items-center gap-2 justify-center"><Save size={18} /> Submit Log</span>
            }
          </button>
          {!hasData && <p className="text-xs text-gray-400 text-center">Enter data above to submit</p>}
          <p className="text-xs text-gray-400 text-center pb-4">Auto-saved as you type — safe to close and return</p>
        </>
      ) : clientId ? (
        <div className="card p-10 text-center text-gray-400">No active buildings — add some in Clients first.</div>
      ) : (
        <div className="card p-12 text-center text-gray-400">Select a client above to begin</div>
      )}
    </div>
  )
}
