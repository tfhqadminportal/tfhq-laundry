// ============================================================
// TFHQ Laundry — Staff Weekly Photo Upload
// Staff uploads one photo of the weekly sheet (Mon-Fri).
// Claude Vision OCR extracts the data, staff reviews/edits,
// then we save 5 daily laundry_logs + 1 laundry_daily_extras
// with the Daniel/Paykel column split 80/20 automatically.
// ============================================================

import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { format, startOfWeek, addDays, parseISO, isValid } from 'date-fns'
import {
  Upload, Camera, Loader2, CheckCircle, AlertTriangle, X,
  ChevronLeft, ChevronRight, RefreshCw, Save, Image as ImageIcon,
} from 'lucide-react'
import toast from 'react-hot-toast'

// ─── Constants ─────────────────────────────────────────────────
const SIZES        = ['XS', 'M', 'XL', '3XL', '5XL', '7XL', '9XL']
const PAYKEL_SHARE = 0.80   // 80% of Daniel/Paykel column goes to Paykel
const DANIEL_SHARE = 0.20   // 20% to Daniel
const STORAGE_KEY  = 'tfhq-laundry-weekly-upload-v1'

// Matches building names in Supabase (case-insensitive)
const PAYKEL_NAMES  = ['paykel', 'fisher paykel', 'fisher & paykel']
const DANIEL_NAMES  = ['daniel']
const STEWART_NAMES = ['stewart']

// ─── LocalStorage ──────────────────────────────────────────────
const lsSave  = v => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)) } catch {} }
const lsLoad  = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') } catch { return null } }
const lsClear = () => { try { localStorage.removeItem(STORAGE_KEY) } catch {} }

// ─── Helpers ───────────────────────────────────────────────────
const todayStr = () => format(new Date(), 'yyyy-MM-dd')

// Monday of the week that contains a given date
const mondayOf = dateStr => {
  const d = dateStr ? parseISO(dateStr) : new Date()
  return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

// Empty day cell with zeros
const emptyDay = () => ({
  sizes: Object.fromEntries(SIZES.map(s => [s, {
    daniel_paykel: 0, stewart: 0, ink_stain: 0, large_holes: 0, to_repair: 0,
  }])),
})

// 5 blank weekday entries starting from the Monday of weekStart
const emptyWeek = weekStart => {
  const mon = parseISO(weekStart)
  return Array.from({ length: 5 }, (_, i) => ({
    date:       format(addDays(mon, i), 'yyyy-MM-dd'),
    date_label: format(addDays(mon, i), 'd/M'),
    ...emptyDay(),
  }))
}

const emptyWeekly = () => ({
  bag_counts:     { daniel: 0, paykel: 0, stewart: 0, daniel_paykel: 0 },
  total_labelled: 0,
  total_gowns:    0,
})

// Match a building by name
const findBuilding = (buildings, names) =>
  buildings.find(b => names.includes((b.name || '').toLowerCase().trim()))

// Read File -> data URL
const fileToDataURL = file => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload  = () => resolve(reader.result)
  reader.onerror = reject
  reader.readAsDataURL(file)
})

// Downscale a photo to ≤ 2000px longest edge + JPEG quality 0.85
// to keep the OCR payload under Vercel's 4.5 MB body limit.
const downscaleImage = dataURL => new Promise(resolve => {
  const img = new Image()
  img.onload = () => {
    const maxEdge = 2000
    const scale   = Math.min(1, maxEdge / Math.max(img.width, img.height))
    const w = Math.round(img.width  * scale)
    const h = Math.round(img.height * scale)
    const canvas  = document.createElement('canvas')
    canvas.width  = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, w, h)
    resolve(canvas.toDataURL('image/jpeg', 0.85))
  }
  img.onerror = () => resolve(dataURL) // fall back to original
  img.src = dataURL
})

// Integer input helper
function NumInput({ value, onChange, className = '' }) {
  return (
    <input
      type="number"
      min="0"
      inputMode="numeric"
      value={value ?? 0}
      onChange={e => onChange(parseInt(e.target.value, 10) || 0)}
      className={`w-full h-10 rounded-lg border border-gray-300 bg-white text-center font-semibold text-gray-900 focus:outline-none focus:ring-1 focus:ring-navy-400 ${className}`}
      style={{ fontSize: 16 }}
    />
  )
}

// ─── Data hooks ────────────────────────────────────────────────
function useClients(userId, isAdmin) {
  return useQuery({
    queryKey: ['weekly-upload-clients', userId, isAdmin],
    queryFn: async () => {
      const q = supabase
        .from('laundry_clients')
        .select('id, name, laundry_buildings(id, name, active, sort_order, bag_color)')
        .eq('active', true)
        .order('name')
      if (!isAdmin) {
        const { data: acc } = await supabase
          .from('laundry_staff_access').select('client_id').eq('staff_id', userId)
        const ids = (acc || []).map(a => a.client_id)
        if (!ids.length) return []
        return (await q.in('id', ids)).data || []
      }
      return (await q).data || []
    },
    enabled: !!userId,
  })
}

// ─── Main component ────────────────────────────────────────────
export default function WeeklyUpload() {
  const { user, isAdmin } = useAuth()
  const qc = useQueryClient()

  // State
  const [weekStart, setWeekStart] = useState(mondayOf(todayStr()))
  const [clientId,  setClient]    = useState('')
  const [imageDataURL, setImage]  = useState(null)
  const [stage, setStage] = useState('upload') // upload | extracting | review | done
  const [days,   setDays]   = useState(() => emptyWeek(mondayOf(todayStr())))
  const [weekly, setWeekly] = useState(emptyWeekly)
  const [ocrNotes, setOcrNotes] = useState('')
  const [confidence, setConfidence] = useState('')
  const fileInputRef = useRef(null)

  const { data: clients = [] } = useClients(user?.id, isAdmin)
  const selectedClient  = clients.find(c => c.id === clientId)
  const buildings = (selectedClient?.laundry_buildings || []).filter(b => b.active)

  // Auto-select single client
  useEffect(() => {
    if (clients.length === 1 && !clientId) setClient(clients[0].id)
  }, [clients])

  // Restore draft on mount (if we were mid-review)
  useEffect(() => {
    const draft = lsLoad()
    if (draft?.stage === 'review' && draft.days && draft.weekly) {
      setWeekStart(draft.weekStart || mondayOf(todayStr()))
      setClient(draft.clientId || '')
      setDays(draft.days)
      setWeekly(draft.weekly)
      setStage('review')
      toast('Draft restored', { icon: '📋' })
    }
  }, [])

  // Persist draft during review
  useEffect(() => {
    if (stage === 'review') {
      lsSave({ stage, weekStart, clientId, days, weekly })
    }
  }, [stage, weekStart, clientId, days, weekly])

  // ── Reset week dates when weekStart changes (stage=upload only) ──
  useEffect(() => {
    if (stage === 'upload') setDays(emptyWeek(weekStart))
  }, [weekStart])

  // ── OCR call ──
  async function runOCR(file) {
    try {
      setStage('extracting')
      const rawURL   = await fileToDataURL(file)
      const smallURL = await downscaleImage(rawURL)
      setImage(smallURL)

      const res = await fetch('/api/ocr-laundry', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ image: smallURL, weekStart }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(err.error || `Server returned ${res.status}`)
      }
      const data = await res.json()

      // Map OCR days onto Mon-Fri, matching by date_label if possible
      const week = emptyWeek(weekStart)
      const ocrDays = (data.days || [])
      ocrDays.forEach((od, idx) => {
        // Prefer matching by date_label (e.g. "31/3"); otherwise positional
        let slotIdx = week.findIndex(w => w.date_label === od.date_label)
        if (slotIdx === -1) slotIdx = idx
        if (slotIdx >= 0 && slotIdx < week.length) {
          week[slotIdx] = {
            date:       week[slotIdx].date,
            date_label: od.date_label || week[slotIdx].date_label,
            sizes:      od.sizes,
          }
        }
      })

      setDays(week)
      setWeekly(data.weekly || emptyWeekly())
      setOcrNotes(data.notes || '')
      setConfidence(data.confidence || 'medium')
      setStage('review')
      toast.success('Extracted! Please review the numbers.')
    } catch (err) {
      console.error(err)
      toast.error(err.message || 'OCR failed')
      setStage('upload')
    }
  }

  // File picker handler
  function onFileChosen(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file (JPG / PNG / HEIC)')
      return
    }
    runOCR(file)
  }

  // ── Cell editing ──
  function setCell(dayIdx, size, field, val) {
    setDays(prev => {
      const next = [...prev]
      next[dayIdx] = {
        ...next[dayIdx],
        sizes: {
          ...next[dayIdx].sizes,
          [size]: { ...next[dayIdx].sizes[size], [field]: val },
        },
      }
      return next
    })
  }

  // ── Totals ──
  const weekTotals = useMemo(() => {
    let dp = 0, st = 0, ink = 0, holes = 0, repair = 0
    days.forEach(d => {
      SIZES.forEach(s => {
        const c = d.sizes[s] || {}
        dp     += +c.daniel_paykel || 0
        st     += +c.stewart       || 0
        ink    += +c.ink_stain     || 0
        holes  += +c.large_holes   || 0
        repair += +c.to_repair     || 0
      })
    })
    return { dp, st, ink, holes, repair, total: dp + st }
  }, [days])

  // ── Submit ──
  const submit = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error('Pick a client first')
      if (!buildings.length) throw new Error('No buildings configured for this client')

      const paykel  = findBuilding(buildings, PAYKEL_NAMES)
      const daniel  = findBuilding(buildings, DANIEL_NAMES)
      const stewart = findBuilding(buildings, STEWART_NAMES)

      if (!paykel || !daniel || !stewart) {
        throw new Error(
          'Could not find Paykel / Daniel / Stewart buildings for this client. ' +
          'Make sure the client has buildings named exactly "Paykel", "Daniel", and "Stewart".'
        )
      }

      // For each of the 5 days, create/replace logs for Paykel, Daniel, Stewart
      for (const day of days) {
        const date = day.date
        const sizes = day.sizes

        // Build per-building row arrays
        // Paykel row: 80% of daniel_paykel (rounded)
        // Daniel row: remainder (= dp - paykelPart)
        // Stewart row: stewart as-is
        // Rejects are site-wide → stored on the first building (Paykel) only.
        const paykelRows  = []
        const danielRows  = []
        const stewartRows = []

        SIZES.forEach((size, i) => {
          const c  = sizes[size] || {}
          const dp = +c.daniel_paykel || 0
          const pk = Math.round(dp * PAYKEL_SHARE)
          const dn = dp - pk
          const st = +c.stewart || 0
          const ink    = +c.ink_stain   || 0
          const holes  = +c.large_holes || 0
          const repair = +c.to_repair   || 0

          if (pk || ink || holes || repair) {
            paykelRows.push({
              size_label: size, sort_order: i,
              blue_gowns: 0, white_gowns: pk, grey_gowns: 0,
              qty_packed: pk,
              ink_stain: ink, large_holes: holes,
              to_repair: Math.round(repair * PAYKEL_SHARE),
            })
          }
          if (dn) {
            danielRows.push({
              size_label: size, sort_order: i,
              blue_gowns: 0, white_gowns: dn, grey_gowns: 0,
              qty_packed: dn,
              ink_stain: 0, large_holes: 0,
              to_repair: Math.round(repair * DANIEL_SHARE),
            })
          }
          if (st) {
            stewartRows.push({
              size_label: size, sort_order: i,
              blue_gowns: 0, white_gowns: st, grey_gowns: 0,
              qty_packed: st,
              ink_stain: 0, large_holes: 0,
              to_repair: 0,
            })
          }
        })

        // Helper to write one building log
        const writeLog = async (building, rows) => {
          if (!rows.length) return
          const totalPacked = rows.reduce((s, r) => s + r.qty_packed, 0)
          const { data: existing } = await supabase
            .from('laundry_logs')
            .select('id')
            .eq('client_id', clientId)
            .eq('building_id', building.id)
            .eq('log_date', date)
            .maybeSingle()

          let logId
          if (existing) {
            logId = existing.id
            await supabase.from('laundry_log_rows').delete().eq('log_id', logId)
            await supabase.from('laundry_logs').update({
              total_packed: totalPacked,
              updated_at:   new Date().toISOString(),
              status:       'submitted',
            }).eq('id', logId)
          } else {
            const { data: log, error } = await supabase.from('laundry_logs')
              .insert({
                client_id:    clientId,
                building_id:  building.id,
                log_date:     date,
                submitted_by: user.id,
                status:       'submitted',
                total_packed: totalPacked,
              })
              .select('id').single()
            if (error) throw error
            logId = log.id
          }
          const payload = rows.map(r => ({ ...r, log_id: logId }))
          const { error: rowErr } = await supabase.from('laundry_log_rows').insert(payload)
          if (rowErr) throw rowErr
        }

        await writeLog(paykel,  paykelRows)
        await writeLog(daniel,  danielRows)
        await writeLog(stewart, stewartRows)
      }

      // Weekly extras (bags + labelling) — attach to the Friday entry (day 5)
      const fridayDate = days[4].date
      const bagCounts = {
        [findBuilding(buildings, PAYKEL_NAMES)?.id]:
          weekly.bag_counts.paykel || Math.round((weekly.bag_counts.daniel_paykel || 0) * PAYKEL_SHARE),
        [findBuilding(buildings, DANIEL_NAMES)?.id]:
          weekly.bag_counts.daniel || Math.round((weekly.bag_counts.daniel_paykel || 0) * DANIEL_SHARE),
        [findBuilding(buildings, STEWART_NAMES)?.id]:
          weekly.bag_counts.stewart || 0,
      }
      // Remove any undefined keys (if a building wasn't found)
      Object.keys(bagCounts).forEach(k => { if (k === 'undefined' || !k) delete bagCounts[k] })

      // General repair = sum of all to_repair across the week
      // F&P to inject  = sum of ink + holes across the week
      const extrasPayload = {
        client_id:      clientId,
        log_date:       fridayDate,
        submitted_by:   user.id,
        bag_counts:     bagCounts,
        labelling:      weekly.total_labelled || 0,
        sleeve_repair:  0,
        general_repair: weekTotals.repair,
        fp_inject:      weekTotals.ink + weekTotals.holes,
        notes:          `Weekly photo upload${ocrNotes ? ` — OCR notes: ${ocrNotes}` : ''}`,
        updated_at:     new Date().toISOString(),
      }
      const { error: extErr } = await supabase
        .from('laundry_daily_extras')
        .upsert(extrasPayload, { onConflict: 'client_id,log_date' })
      if (extErr) throw extErr
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-history'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      lsClear()
      setStage('done')
      toast.success('All 5 days saved!')
    },
    onError: err => toast.error(err.message || 'Submission failed'),
  })

  // ── Reset to start ──
  function startOver() {
    lsClear()
    setImage(null)
    setDays(emptyWeek(weekStart))
    setWeekly(emptyWeekly())
    setOcrNotes('')
    setConfidence('')
    setStage('upload')
  }

  // ─── Render ──────────────────────────────────────────────────
  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Weekly Log Upload</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Snap a photo of Friday's sheet — we'll do the rest.
          </p>
        </div>
        {stage === 'review' && (
          <button onClick={startOver} className="btn-secondary btn-sm">
            <RefreshCw size={14} /> Start over
          </button>
        )}
      </div>

      {/* Client + week pickers (only shown during upload / review) */}
      {stage !== 'done' && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          {clients.length > 1 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Client</label>
              <select
                value={clientId}
                onChange={e => setClient(e.target.value)}
                className="w-full h-11 rounded-lg border border-gray-300 px-3"
                style={{ fontSize: 16 }}
              >
                <option value="">Select client…</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Week starting (Monday)</label>
            <input
              type="date"
              value={weekStart}
              onChange={e => setWeekStart(mondayOf(e.target.value))}
              className="w-full h-11 rounded-lg border border-gray-300 px-3"
              style={{ fontSize: 16 }}
            />
            <p className="text-xs text-gray-400 mt-1">
              {format(parseISO(weekStart), 'EEE d MMM')} → {format(addDays(parseISO(weekStart), 4), 'EEE d MMM yyyy')}
            </p>
          </div>
        </div>
      )}

      {/* ─── STAGE: upload ─── */}
      {stage === 'upload' && (
        <div className="bg-white rounded-xl border-2 border-dashed border-gray-300 p-8 text-center">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFileChosen}
            className="hidden"
          />
          <div className="w-16 h-16 bg-navy-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Camera size={32} className="text-navy-600" />
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-1">Upload weekly sheet photo</h2>
          <p className="text-sm text-gray-500 mb-5">
            Take a clear photo of the whole sheet with all 5 days visible.
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!clientId && clients.length > 1}
            className="btn-primary px-6 py-3 text-base disabled:opacity-50"
          >
            <Upload size={18} /> Choose photo
          </button>
          {clients.length > 1 && !clientId && (
            <p className="text-xs text-red-500 mt-3">Pick a client first.</p>
          )}
        </div>
      )}

      {/* ─── STAGE: extracting ─── */}
      {stage === 'extracting' && (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <Loader2 size={44} className="text-navy-600 animate-spin mx-auto mb-3" />
          <h2 className="text-lg font-bold text-gray-900">Reading your sheet…</h2>
          <p className="text-sm text-gray-500 mt-1">
            Claude is extracting the numbers. This usually takes 10–20 seconds.
          </p>
          {imageDataURL && (
            <img src={imageDataURL} alt="preview" className="mt-5 max-h-64 mx-auto rounded-lg border border-gray-200 opacity-60" />
          )}
        </div>
      )}

      {/* ─── STAGE: review ─── */}
      {stage === 'review' && (
        <>
          {/* OCR confidence banner */}
          {confidence && (
            <div className={`rounded-xl p-3 border text-sm flex items-start gap-2 ${
              confidence === 'high'   ? 'bg-green-50 border-green-200 text-green-800' :
              confidence === 'medium' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                                        'bg-red-50 border-red-200 text-red-800'
            }`}>
              {confidence === 'high'
                ? <CheckCircle size={18} className="shrink-0 mt-0.5" />
                : <AlertTriangle size={18} className="shrink-0 mt-0.5" />}
              <div>
                <p className="font-semibold">OCR confidence: {confidence}</p>
                {ocrNotes && <p className="mt-0.5 opacity-90">{ocrNotes}</p>}
                <p className="mt-1 text-xs opacity-80">
                  Please double-check each number below before submitting — especially highlighted rows.
                </p>
              </div>
            </div>
          )}

          {/* Week totals badge */}
          <div className="bg-navy-700 text-white rounded-xl p-4 grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xs text-navy-300">Total gowns</p>
              <p className="text-xl font-bold">{weekTotals.total.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-navy-300">Daniel/Paykel</p>
              <p className="text-xl font-bold">{weekTotals.dp.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-navy-300">Stewart</p>
              <p className="text-xl font-bold">{weekTotals.st.toLocaleString()}</p>
            </div>
          </div>

          {/* Per-day tables */}
          {days.map((day, di) => {
            const dayTotal = SIZES.reduce((s, sz) => {
              const c = day.sizes[sz] || {}
              return s + (+c.daniel_paykel || 0) + (+c.stewart || 0)
            }, 0)
            return (
              <div key={day.date} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between bg-gray-50 px-4 py-3 border-b border-gray-200">
                  <div>
                    <p className="font-bold text-gray-900">
                      {format(parseISO(day.date), 'EEEE d MMM')}
                    </p>
                    {day.date_label && (
                      <p className="text-xs text-gray-500">sheet label: {day.date_label}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Day total</p>
                    <p className="font-bold text-navy-700">{dayTotal}</p>
                  </div>
                </div>
                {/* Table */}
                <div className="p-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs font-semibold text-gray-500">
                        <th className="w-12 text-left">Size</th>
                        <th className="px-1">Daniel/Paykel</th>
                        <th className="px-1">Stewart</th>
                        <th className="px-1 text-red-500">Ink</th>
                        <th className="px-1 text-orange-500">Holes</th>
                        <th className="px-1 text-amber-500">Repair</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SIZES.map(size => {
                        const c = day.sizes[size] || {}
                        return (
                          <tr key={size}>
                            <td className="py-1 font-bold text-gray-700">{size}</td>
                            <td className="px-1 py-1"><NumInput value={c.daniel_paykel} onChange={v => setCell(di, size, 'daniel_paykel', v)} /></td>
                            <td className="px-1 py-1"><NumInput value={c.stewart}       onChange={v => setCell(di, size, 'stewart', v)} /></td>
                            <td className="px-1 py-1"><NumInput value={c.ink_stain}     onChange={v => setCell(di, size, 'ink_stain', v)} /></td>
                            <td className="px-1 py-1"><NumInput value={c.large_holes}   onChange={v => setCell(di, size, 'large_holes', v)} /></td>
                            <td className="px-1 py-1"><NumInput value={c.to_repair}     onChange={v => setCell(di, size, 'to_repair', v)} /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}

          {/* Weekly summary card */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <h3 className="font-bold text-gray-900">Weekly totals</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Daniel/Paykel bags</label>
                <NumInput
                  value={weekly.bag_counts.daniel_paykel}
                  onChange={v => setWeekly(w => ({ ...w, bag_counts: { ...w.bag_counts, daniel_paykel: v } }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Stewart bags</label>
                <NumInput
                  value={weekly.bag_counts.stewart}
                  onChange={v => setWeekly(w => ({ ...w, bag_counts: { ...w.bag_counts, stewart: v } }))}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Total labelled</label>
                <NumInput
                  value={weekly.total_labelled}
                  onChange={v => setWeekly(w => ({ ...w, total_labelled: v }))}
                />
              </div>
            </div>
            <p className="text-xs text-gray-400 pt-1 border-t border-gray-100">
              Bags & labelling are recorded on Friday's entry in the admin view.
            </p>
          </div>

          {/* Preview of the 80/20 split that will be written */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm">
            <p className="font-bold text-blue-900 mb-1">How this will be saved</p>
            <p className="text-blue-800">
              Daniel/Paykel column will be auto-split <strong>80% Paykel / 20% Daniel</strong> across all sizes and days.
              Admin &amp; Accounts will see Paykel, Daniel and Stewart as separate buildings.
            </p>
          </div>

          {/* Submit */}
          <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-gray-200 -mx-4 px-4 py-3">
            <button
              onClick={() => submit.mutate()}
              disabled={submit.isPending || !clientId || weekTotals.total === 0}
              className="btn-primary w-full py-3 text-base disabled:opacity-50"
            >
              {submit.isPending
                ? <><Loader2 size={18} className="animate-spin" /> Saving all 5 days…</>
                : <><Save size={18} /> Submit week</>}
            </button>
          </div>
        </>
      )}

      {/* ─── STAGE: done ─── */}
      {stage === 'done' && (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={44} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Week submitted!</h2>
          <p className="text-gray-500 mt-2 mb-5">
            All 5 days saved. Admin and accounts can now review them.
          </p>
          <button onClick={startOver} className="btn-primary px-6 py-3">
            Upload another week
          </button>
        </div>
      )}
    </div>
  )
}
