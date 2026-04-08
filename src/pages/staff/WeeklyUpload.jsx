// ============================================================
// TFHQ Laundry — Staff Weekly Photo Upload
// ------------------------------------------------------------
// Fazeel snaps a photo of the existing handwritten Gown
// Processing Log (one A4 page, 4 or 5 daily tables stacked).
// Claude Vision OCR extracts the data and we render it in the
// EXACT same layout as the existing March & April Data.xlsx
// sheets:
//
//   Size | Total Packed | Paykel | Daniel | Stewart | Ink Stain | Large Holes | To Repair
//
// "Total Packed" is calculated automatically (Paykel+Daniel+Stewart)
// per row — Fazeel never types it. The 3 buildings are saved to
// Supabase as separate `laundry_logs` rows (no 80/20 split, no
// merge), so the admin / accounts view sees Paykel, Daniel and
// Stewart individually, exactly as on the existing Excel sheet.
//
// Productivity hours continue to come from the roster via the
// existing `useRosterHours` hook, identical to NewEntry.jsx.
// ============================================================

import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useRosterHours } from '@/hooks/useRosterHours'
import { format, startOfWeek, addDays, parseISO } from 'date-fns'
import {
  Upload, Camera, Loader2, CheckCircle, AlertTriangle,
  RefreshCw, Save, TrendingUp, Download,
} from 'lucide-react'
import toast from 'react-hot-toast'

// ─── Constants ─────────────────────────────────────────────────
const SIZES        = ['XS', 'M', 'XL', '3XL', '5XL', '7XL', '9XL']
const BUILDING_KEYS = ['paykel', 'daniel', 'stewart']
const STORAGE_KEY  = 'tfhq-laundry-weekly-upload-v2'

// Match Supabase building names (case-insensitive)
const BUILDING_NAMES = {
  paykel:  ['paykel', 'fisher paykel', 'fisher & paykel', 'fisher and paykel'],
  daniel:  ['daniel'],
  stewart: ['stewart'],
}

// ─── LocalStorage ──────────────────────────────────────────────
const lsSave  = v => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)) } catch {} }
const lsLoad  = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') } catch { return null } }
const lsClear = () => { try { localStorage.removeItem(STORAGE_KEY) } catch {} }

// ─── Helpers ───────────────────────────────────────────────────
const todayStr = () => format(new Date(), 'yyyy-MM-dd')

const mondayOf = dateStr => {
  const d = dateStr ? parseISO(dateStr) : new Date()
  return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

// One blank size row (matches the 8-column layout of the user's xlsx)
const emptySizeRow = () => ({
  paykel: 0, daniel: 0, stewart: 0,
  ink_stain: 0, large_holes: 0, to_repair: 0,
})

// One blank day with all 7 sizes
const emptyDay = () => ({
  sizes: Object.fromEntries(SIZES.map(s => [s, emptySizeRow()])),
})

// 5 weekday entries starting from a given Monday
const emptyWeek = weekStart => {
  const mon = parseISO(weekStart)
  return Array.from({ length: 5 }, (_, i) => ({
    date:       format(addDays(mon, i), 'yyyy-MM-dd'),
    date_label: format(addDays(mon, i), 'd/M'),
    ...emptyDay(),
  }))
}

// Weekly extras block (Bags / Quantities section in the user's xlsx)
const emptyWeekly = () => ({
  bag_counts:     { paykel: 0, daniel: 0, stewart: 0 },
  labelling:      0,
  sleeve_repair:  0,
  general_repair: 0,
  fp_inject:      0,
})

const findBuilding = (buildings, key) =>
  buildings.find(b => BUILDING_NAMES[key].includes((b.name || '').toLowerCase().trim()))

const fileToDataURL = file => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload  = () => resolve(reader.result)
  reader.onerror = reject
  reader.readAsDataURL(file)
})

// Downscale to ≤2000px longest edge / JPEG q0.85 to keep payload < 4.5 MB
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
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    resolve(canvas.toDataURL('image/jpeg', 0.85))
  }
  img.onerror = () => resolve(dataURL)
  img.src = dataURL
})

// Integer input cell
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
        .select('id, name, target_gowns_per_hour, staff_count, laundry_buildings(id, name, active, sort_order, bag_color)')
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

  // ── State ──
  const [weekStart, setWeekStart] = useState(mondayOf(todayStr()))
  const [clientId,  setClient]    = useState('')
  const [imageDataURL, setImage]  = useState(null)
  const [stage, setStage]         = useState('upload') // upload | extracting | review | done
  const [days,    setDays]        = useState(() => emptyWeek(mondayOf(todayStr())))
  const [weekly,  setWeekly]      = useState(emptyWeekly)
  const [ocrNotes, setOcrNotes]   = useState('')
  const [confidence, setConfidence] = useState('')
  const fileInputRef = useRef(null)

  const { data: clients = [] } = useClients(user?.id, isAdmin)
  const selectedClient = clients.find(c => c.id === clientId)
  const buildings  = (selectedClient?.laundry_buildings || []).filter(b => b.active)
  const targetRate = selectedClient?.target_gowns_per_hour || 60

  // ── Roster hours for the whole week ──
  const { data: roster } = useRosterHours()

  // ── Auto-select single client ──
  useEffect(() => {
    if (clients.length === 1 && !clientId) setClient(clients[0].id)
  }, [clients])

  // ── Restore mid-review draft ──
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

  // ── Persist draft during review ──
  useEffect(() => {
    if (stage === 'review') lsSave({ stage, weekStart, clientId, days, weekly })
  }, [stage, weekStart, clientId, days, weekly])

  // ── Reset weekday dates when weekStart changes (only while picking) ──
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

      // Map OCR days onto Mon-Fri, matching by date_label if possible.
      const week = emptyWeek(weekStart)
      const ocrDays = data.days || []
      ocrDays.forEach((od, idx) => {
        // Try a soft match on the date label (e.g. "31/3" or "Tuesday")
        let slotIdx = -1
        if (od.date_label) {
          const lbl = od.date_label.toLowerCase()
          slotIdx = week.findIndex(w =>
            w.date_label.toLowerCase() === lbl ||
            format(parseISO(w.date), 'EEEE').toLowerCase().startsWith(lbl.slice(0, 3))
          )
        }
        if (slotIdx === -1) slotIdx = idx
        if (slotIdx >= 0 && slotIdx < week.length) {
          // Normalise the OCR shape into our state shape.
          const sizes = {}
          for (const s of SIZES) {
            const c = (od.sizes || {})[s] || {}
            sizes[s] = {
              paykel:      +c.paykel      || 0,
              daniel:      +c.daniel      || 0,
              stewart:     +c.stewart     || 0,
              ink_stain:   +c.ink_stain   || 0,
              large_holes: +c.large_holes || 0,
              to_repair:   +c.to_repair   || 0,
            }
          }
          week[slotIdx] = {
            date:       week[slotIdx].date,
            date_label: od.date_label || week[slotIdx].date_label,
            sizes,
          }
        }
      })

      setDays(week)
      setWeekly({
        bag_counts: {
          paykel:  data.weekly?.bag_counts?.paykel  || 0,
          daniel:  data.weekly?.bag_counts?.daniel  || 0,
          stewart: data.weekly?.bag_counts?.stewart || 0,
        },
        labelling:      data.weekly?.labelling      || 0,
        sleeve_repair:  data.weekly?.sleeve_repair  || 0,
        general_repair: data.weekly?.general_repair || 0,
        fp_inject:      data.weekly?.fp_inject      || 0,
      })
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

  // ── Per-row total (Paykel + Daniel + Stewart) — auto, never typed ──
  const rowTotal = c => (+c.paykel || 0) + (+c.daniel || 0) + (+c.stewart || 0)

  // ── Per-day totals ──
  const dayTotals = useMemo(() => days.map(d => {
    const t = { paykel: 0, daniel: 0, stewart: 0, total_packed: 0, ink: 0, holes: 0, repair: 0 }
    SIZES.forEach(s => {
      const c = d.sizes[s] || {}
      t.paykel       += +c.paykel      || 0
      t.daniel       += +c.daniel      || 0
      t.stewart      += +c.stewart     || 0
      t.total_packed += rowTotal(c)
      t.ink          += +c.ink_stain   || 0
      t.holes        += +c.large_holes || 0
      t.repair       += +c.to_repair   || 0
    })
    return t
  }), [days])

  // ── Weekly totals ──
  const weekTotals = useMemo(() => {
    const w = { paykel: 0, daniel: 0, stewart: 0, total_packed: 0, ink: 0, holes: 0, repair: 0 }
    dayTotals.forEach(t => {
      w.paykel       += t.paykel
      w.daniel       += t.daniel
      w.stewart      += t.stewart
      w.total_packed += t.total_packed
      w.ink          += t.ink
      w.holes        += t.holes
      w.repair       += t.repair
    })
    return w
  }, [dayTotals])

  // ── Roster hours for each day in the visible week ──
  const weekRoster = useMemo(() => {
    if (!roster?.byDate) return null
    let totalHours = 0, totalStaffHours = 0
    const perDay = days.map(d => {
      const e = roster.byDate[d.date]
      if (!e) return { hours: 0, staff: 0 }
      totalHours += e.totalHours || 0
      totalStaffHours += (e.totalHours || 0) // hours summed over all staff
      return { hours: e.totalHours || 0, staff: e.staffCount || 0 }
    })
    // Productivity = total gowns / total man-hours.
    const gownsPerHour = totalHours > 0 ? Math.round(weekTotals.total_packed / totalHours) : 0
    const efficiency   = targetRate > 0 ? Math.round((gownsPerHour / targetRate) * 100) : 0
    return { perDay, totalHours, gownsPerHour, efficiency }
  }, [roster, days, weekTotals.total_packed, targetRate])

  // ── Submit ──
  const submit = useMutation({
    mutationFn: async () => {
      if (!clientId)        throw new Error('Pick a client first')
      if (!buildings.length) throw new Error('No buildings configured for this client')

      const paykelB  = findBuilding(buildings, 'paykel')
      const danielB  = findBuilding(buildings, 'daniel')
      const stewartB = findBuilding(buildings, 'stewart')

      if (!paykelB || !danielB || !stewartB) {
        throw new Error(
          'Could not find Paykel / Daniel / Stewart buildings. ' +
          'Make sure the client has buildings named exactly "Paykel", "Daniel", and "Stewart".'
        )
      }

      const buildingByKey = { paykel: paykelB, daniel: danielB, stewart: stewartB }

      // Write per-day, per-building rows
      for (let dIdx = 0; dIdx < days.length; dIdx++) {
        const day  = days[dIdx]
        const date = day.date

        // For each building, build one log + 7 size rows.
        for (const key of BUILDING_KEYS) {
          const building = buildingByKey[key]
          // Ink/Holes/Repair are global per-day rejects (per-size), stored once
          // on the FIRST building only — same convention as NewEntry.jsx.
          const isFirst = key === 'paykel'

          const rows = SIZES.map((size, i) => {
            const c     = day.sizes[size] || {}
            const qty   = +c[key] || 0
            const ink   = isFirst ? (+c.ink_stain   || 0) : 0
            const holes = isFirst ? (+c.large_holes || 0) : 0
            // Repairs aren't split by building on this sheet — we attach the
            // whole figure to the first building (Paykel) so the daily total
            // matches the printed sheet.
            const repair = isFirst ? (+c.to_repair || 0) : 0
            return {
              size_label:  size,
              sort_order:  i,
              blue_gowns:  0,
              white_gowns: qty,
              grey_gowns:  0,
              qty_packed:  qty,
              ink_stain:   ink,
              large_holes: holes,
              to_repair:   repair,
            }
          })

          // If this building has nothing for the day, skip it entirely.
          const hasAnything = rows.some(r =>
            r.qty_packed || r.ink_stain || r.large_holes || r.to_repair
          )
          if (!hasAnything) continue

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
          const { error: rowErr } = await supabase
            .from('laundry_log_rows').insert(payload)
          if (rowErr) throw rowErr
        }

        // Per-day extras: shift_hours / staff_on_shift come from the roster
        const r = roster?.byDate?.[date]
        const extrasPayload = {
          client_id:      clientId,
          log_date:       date,
          submitted_by:   user.id,
          bag_counts:     {},
          labelling:      0,
          sleeve_repair:  0,
          general_repair: 0,
          fp_inject:      0,
          shift_hours:    r?.totalHours || null,
          staff_on_shift: r?.staffCount || null,
          notes:          `Weekly photo upload (${day.date_label || ''})`,
          updated_at:     new Date().toISOString(),
        }
        const { error: extErr } = await supabase
          .from('laundry_daily_extras')
          .upsert(extrasPayload, { onConflict: 'client_id,log_date' })
        if (extErr) throw extErr
      }

      // Weekly extras (bags + labelling + repairs) — attach to Friday's row
      const fridayDate = days[4].date
      const bagCounts = {}
      if (paykelB)  bagCounts[paykelB.id]  = weekly.bag_counts.paykel  || 0
      if (danielB)  bagCounts[danielB.id]  = weekly.bag_counts.daniel  || 0
      if (stewartB) bagCounts[stewartB.id] = weekly.bag_counts.stewart || 0

      // Auto-derive general_repair / fp_inject from the weekly totals so they
      // match the existing March & April Data sheet conventions:
      //   general_repair = sum of "To Repair" across the whole week
      //   fp_inject      = ink_stain + large_holes summed across the week
      const r = roster?.byDate?.[fridayDate]
      const extrasPayload = {
        client_id:      clientId,
        log_date:       fridayDate,
        submitted_by:   user.id,
        bag_counts:     bagCounts,
        labelling:      weekly.labelling      || 0,
        sleeve_repair:  weekly.sleeve_repair  || 0,
        general_repair: weekly.general_repair || weekTotals.repair,
        fp_inject:      weekly.fp_inject      || (weekTotals.ink + weekTotals.holes),
        shift_hours:    r?.totalHours || null,
        staff_on_shift: r?.staffCount || null,
        notes: `Weekly photo upload — bags & labelling${ocrNotes ? ` — OCR notes: ${ocrNotes}` : ''}`,
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
      qc.invalidateQueries({ queryKey: ['admin-logs'] })
      lsClear()
      setStage('done')
      toast.success('Week saved!')
    },
    onError: err => toast.error(err.message || 'Submission failed'),
  })

  // ── Download a populated copy of the user's existing xlsx template ──
  async function downloadXlsx() {
    try {
      const res = await fetch('/api/build-weekly-xlsx', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ weekStart, days, weekly }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error(err.error || `Server returned ${res.status}`)
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `Laundry-Week-${weekStart}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err.message || 'Download failed')
    }
  }

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
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Weekly Log Upload</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Snap a photo of the weekly Gown Processing sheet — we'll do the rest.
          </p>
        </div>
        {stage === 'review' && (
          <button onClick={startOver} className="btn-secondary btn-sm">
            <RefreshCw size={14} /> Start over
          </button>
        )}
      </div>

      {/* Client + week pickers */}
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
            Take a clear photo of the whole sheet with all daily tables visible.
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
                ? <CheckCircle    size={18} className="shrink-0 mt-0.5" />
                : <AlertTriangle  size={18} className="shrink-0 mt-0.5" />}
              <div>
                <p className="font-semibold">OCR confidence: {confidence}</p>
                {ocrNotes && <p className="mt-0.5 opacity-90">{ocrNotes}</p>}
                <p className="mt-1 text-xs opacity-80">
                  Please double-check each number below before submitting.
                </p>
              </div>
            </div>
          )}

          {/* Week totals */}
          <div className="bg-navy-700 text-white rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div>
              <p className="text-xs text-navy-300">Total packed</p>
              <p className="text-xl font-bold">{weekTotals.total_packed.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-navy-300">Paykel</p>
              <p className="text-xl font-bold">{weekTotals.paykel.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-navy-300">Daniel</p>
              <p className="text-xl font-bold">{weekTotals.daniel.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-navy-300">Stewart</p>
              <p className="text-xl font-bold">{weekTotals.stewart.toLocaleString()}</p>
            </div>
          </div>

          {/* Productivity card (roster-driven) */}
          {weekRoster && weekRoster.totalHours > 0 && (
            <div className={`rounded-xl p-4 border text-sm ${
              weekRoster.efficiency >= 100 ? 'bg-green-50 border-green-200' :
              weekRoster.efficiency >= 80  ? 'bg-amber-50 border-amber-200' :
                                             'bg-red-50 border-red-200'
            }`}>
              <p className="font-bold text-gray-800 mb-2 flex items-center gap-2">
                <TrendingUp size={15} /> Productivity — {weekRoster.efficiency}% efficiency
              </p>
              <div className="grid grid-cols-3 gap-3 text-gray-700">
                <div>
                  <p className="text-xs text-gray-500">Roster hours</p>
                  <p className="font-bold">{weekRoster.totalHours.toFixed(1)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Gowns / hour</p>
                  <p className="font-bold">{weekRoster.gownsPerHour}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Target</p>
                  <p className="font-bold">{targetRate}</p>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">Hours pulled from the staff roster automatically.</p>
            </div>
          )}

          {/* ── Per-day tables (mirrors the March & April Data sheet) ── */}
          {days.map((day, di) => {
            const dt = dayTotals[di]
            const r  = roster?.byDate?.[day.date]
            return (
              <div key={day.date} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between bg-gray-50 px-4 py-3 border-b border-gray-200">
                  <div>
                    <p className="font-bold text-gray-900">
                      {format(parseISO(day.date), 'EEEE d MMM')}
                    </p>
                    <p className="text-xs text-gray-500">
                      {day.date_label && <>sheet label: {day.date_label} · </>}
                      {r ? `${r.totalHours} hrs / ${r.staffCount} staff (roster)` : 'no roster entry'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Total Packed</p>
                    <p className="font-bold text-navy-700">{dt.total_packed}</p>
                  </div>
                </div>

                {/* Table */}
                <div className="p-3 overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="text-xs font-semibold text-gray-500">
                        <th className="text-left pl-1 pb-1 w-12">Size</th>
                        <th className="px-1 pb-1">Total Packed</th>
                        <th className="px-1 pb-1">Paykel</th>
                        <th className="px-1 pb-1">Daniel</th>
                        <th className="px-1 pb-1">Stewart</th>
                        <th className="px-1 pb-1 text-red-500">Ink Stain</th>
                        <th className="px-1 pb-1 text-orange-500">Large Holes</th>
                        <th className="px-1 pb-1 text-amber-500">To Repair</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SIZES.map(size => {
                        const c  = day.sizes[size] || {}
                        const tp = rowTotal(c)
                        return (
                          <tr key={size}>
                            <td className="py-1 pl-1 font-bold text-gray-700">{size}</td>
                            <td className="px-1 py-1">
                              <div className="h-10 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center font-semibold text-gray-700">
                                {tp || 0}
                              </div>
                            </td>
                            <td className="px-1 py-1"><NumInput value={c.paykel}      onChange={v => setCell(di, size, 'paykel', v)} /></td>
                            <td className="px-1 py-1"><NumInput value={c.daniel}      onChange={v => setCell(di, size, 'daniel', v)} /></td>
                            <td className="px-1 py-1"><NumInput value={c.stewart}     onChange={v => setCell(di, size, 'stewart', v)} /></td>
                            <td className="px-1 py-1"><NumInput value={c.ink_stain}   onChange={v => setCell(di, size, 'ink_stain', v)} /></td>
                            <td className="px-1 py-1"><NumInput value={c.large_holes} onChange={v => setCell(di, size, 'large_holes', v)} /></td>
                            <td className="px-1 py-1"><NumInput value={c.to_repair}   onChange={v => setCell(di, size, 'to_repair', v)} /></td>
                          </tr>
                        )
                      })}
                      {/* Totals row */}
                      <tr className="border-t border-gray-200">
                        <td className="pt-2 pl-1 text-xs font-bold text-gray-500">Totals</td>
                        <td className="px-1 pt-2 text-center font-bold text-navy-700">{dt.total_packed}</td>
                        <td className="px-1 pt-2 text-center font-bold text-gray-700">{dt.paykel}</td>
                        <td className="px-1 pt-2 text-center font-bold text-gray-700">{dt.daniel}</td>
                        <td className="px-1 pt-2 text-center font-bold text-gray-700">{dt.stewart}</td>
                        <td className="px-1 pt-2 text-center font-bold text-red-600">{dt.ink}</td>
                        <td className="px-1 pt-2 text-center font-bold text-orange-600">{dt.holes}</td>
                        <td className="px-1 pt-2 text-center font-bold text-amber-600">{dt.repair}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}

          {/* Weekly extras card (Bags + Labelling + Repairs) */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <h3 className="font-bold text-gray-900">Weekly Bags / Quantities</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Paykel — Black bags</label>
                <NumInput value={weekly.bag_counts.paykel}
                  onChange={v => setWeekly(w => ({ ...w, bag_counts: { ...w.bag_counts, paykel: v } }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Daniel — Red bags</label>
                <NumInput value={weekly.bag_counts.daniel}
                  onChange={v => setWeekly(w => ({ ...w, bag_counts: { ...w.bag_counts, daniel: v } }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Stewart — Blue bags</label>
                <NumInput value={weekly.bag_counts.stewart}
                  onChange={v => setWeekly(w => ({ ...w, bag_counts: { ...w.bag_counts, stewart: v } }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Labelling</label>
                <NumInput value={weekly.labelling}
                  onChange={v => setWeekly(w => ({ ...w, labelling: v }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Sleeve repair</label>
                <NumInput value={weekly.sleeve_repair}
                  onChange={v => setWeekly(w => ({ ...w, sleeve_repair: v }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">General repair</label>
                <NumInput value={weekly.general_repair || weekTotals.repair}
                  onChange={v => setWeekly(w => ({ ...w, general_repair: v }))} />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-xs font-semibold text-gray-500 mb-1">F&amp;P to inject (Ink + Holes)</label>
                <NumInput value={weekly.fp_inject || (weekTotals.ink + weekTotals.holes)}
                  onChange={v => setWeekly(w => ({ ...w, fp_inject: v }))} />
              </div>
            </div>
            <p className="text-xs text-gray-400 pt-1 border-t border-gray-100">
              These are saved on Friday's entry, exactly like the March &amp; April Data sheet.
              General repair auto-fills from the To Repair column; F&amp;P inject auto-fills from Ink + Holes.
            </p>
          </div>

          {/* Submit */}
          <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-gray-200 -mx-4 px-4 py-3 flex gap-2">
            <button
              onClick={downloadXlsx}
              disabled={weekTotals.total_packed === 0}
              className="btn-secondary flex-1 py-3 text-base disabled:opacity-50"
            >
              <Download size={18} /> Download xlsx
            </button>
            <button
              onClick={() => submit.mutate()}
              disabled={submit.isPending || !clientId || weekTotals.total_packed === 0}
              className="btn-primary flex-1 py-3 text-base disabled:opacity-50"
            >
              {submit.isPending
                ? <><Loader2 size={18} className="animate-spin" /> Saving…</>
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
            All days saved. Admin and accounts can now review them.
          </p>
          <button onClick={startOver} className="btn-primary px-6 py-3">
            Upload another week
          </button>
        </div>
      )}
    </div>
  )
}
