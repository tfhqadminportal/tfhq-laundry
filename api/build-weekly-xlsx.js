// ============================================================
// TFHQ Laundry — Build weekly xlsx (Vercel serverless function)
// POST /api/build-weekly-xlsx
// ------------------------------------------------------------
// Accepts { weekStart, days, weekly } and returns a populated
// xlsx file that EXACTLY matches the layout of the user's
// "March & April Data.xlsx" sheets:
//
//   Row layout (9 cols A–I):
//   A=Size | B=Total Packed (=C+D+E) | C=Paykel | D=Daniel
//   E=Stewart | F=Ink Stain | G=Large/Burnt Holes | H=To Repair
//   I=Date (merged across the day's 9 rows)
//
//   5 daily blocks stacked:
//     Day 1 header row 2,  data rows 3–9,  totals row 10
//     Day 2 header row 11, data rows 12–18, totals row 19
//     Day 3 header row 20, data rows 21–27, totals row 28
//     Day 4 header row 29, data rows 30–36, totals row 37
//     Day 5 header row 38, data rows 39–45, totals row 46
//     Weekly Total row 47
//     Bags/Quantities block rows 49–56
//
// Uses the "xlsx" (SheetJS) package already in package.json.
// ============================================================

import XLSX from 'xlsx'

export const config = { runtime: 'nodejs', maxDuration: 30 }

const SIZES = ['XS', 'M', 'XL', '3XL', '5XL', '7XL', '9XL']

// Day block start rows (1-based, matching the user's sheet exactly)
// Block n: header row H, data rows H+1..H+7, totals row H+8
const BLOCK_STARTS = [2, 11, 20, 29, 38]
const BLOCK_DATA_START = h => h + 1           // first size row
const BLOCK_DATA_END   = h => h + 7           // last size row (9XL, may be blank)
const BLOCK_TOTALS     = h => h + 8           // Totals row

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { weekStart, days = [], weekly = {} } = req.body || {}
    if (!weekStart) return res.status(400).json({ error: 'Missing weekStart' })

    // ── Build worksheet as an AOA (array of arrays) then patch formulas ──
    // SheetJS: row 0 = xlsx row 1, col 0 = xlsx col A.
    const MAX_ROW = 57 // we'll write through row 56 (index 55)
    const MAX_COL = 9  // A–I

    // Init grid with nulls
    const grid = Array.from({ length: MAX_ROW }, () => Array(MAX_COL).fill(null))

    // Helper: set cell value (1-based row/col)
    const set = (row, col, value) => { grid[row - 1][col - 1] = value }

    // ── Row 1: Title ──
    set(1, 1, 'TFHQ-LAUNDRY DATA')

    // ── 5 daily blocks ──
    for (let bi = 0; bi < BLOCK_STARTS.length; bi++) {
      const h   = BLOCK_STARTS[bi]
      const day = days[bi] || { date: '', date_label: '', sizes: {} }

      // Header row
      set(h, 1, 'Size')
      set(h, 2, 'Total Packed ')
      set(h, 3, 'Paykel')
      set(h, 4, 'Daniel')
      set(h, 5, 'Stewart')
      set(h, 6, 'Ink Stain')
      set(h, 7, bi === 0 ? 'Large/Burnt Holes' : 'Large Holes')
      set(h, 8, 'To Repair')
      // Column I = date (will be merged later)
      const dateVal = day.date
        ? new Date(day.date + 'T00:00:00')
        : (day.date_label || '')
      set(h, 9, dateVal)

      // Size rows
      for (let si = 0; si < SIZES.length; si++) {
        const r    = h + 1 + si
        const size = SIZES[si]
        const c    = (day.sizes || {})[size] || {}

        set(r, 1, size) // A = size label

        const paykel  = +c.paykel      || 0
        const daniel  = +c.daniel      || 0
        const stewart = +c.stewart     || 0
        const ink     = +c.ink_stain   || 0
        const holes   = +c.large_holes || 0
        const repair  = +c.to_repair   || 0

        // B = Total Packed formula (=C+D+E, e.g. =C3+D3+E3)
        // We'll store as a formula string — SheetJS handles this with { f: '...' }
        // For now put the computed value; we'll patch formulas below.
        set(r, 2, paykel + daniel + stewart) // will be replaced by formula
        set(r, 3, paykel  || null)
        set(r, 4, daniel  || null)
        set(r, 5, stewart || null)
        set(r, 6, ink     || null)
        set(r, 7, holes   || null)
        set(r, 8, repair  || null)
      }

      // Totals row
      const tr   = BLOCK_TOTALS(h)
      const dStr = BLOCK_DATA_START(h)
      const dEnd = BLOCK_DATA_END(h)
      set(tr, 1, 'Totals')
      // Totals for B (Total Packed), C, D, E, F, G, H — as formula strings (patched below)
    }

    // ── Row 47: Weekly Total ──
    set(47, 1, 'Weekly Total ')

    // ── Bags / Quantities block ──
    set(49, 1, 'Bags ')
    set(49, 2, 'Quantities')
    set(50, 1, 'Paykel- Black')
    set(50, 2, (weekly.bag_counts || {}).paykel  || 0)
    set(51, 1, 'Daniel-Red')
    set(51, 2, (weekly.bag_counts || {}).daniel  || 0)
    set(52, 1, 'Stewart- Blue')
    set(52, 2, (weekly.bag_counts || {}).stewart || 0)
    set(53, 1, 'Labelling ')
    set(53, 2, weekly.labelling     || 0)
    set(54, 1, 'Sleeve repair')
    set(54, 2, weekly.sleeve_repair || 0)
    set(55, 1, 'General Repair ')
    set(55, 2, weekly.general_repair || 0)
    set(56, 1, 'Fisher and Paykel to Inject')
    // F&P inject is a formula in the original: =F47+G47

    // ── Convert grid to SheetJS worksheet ──
    const ws = XLSX.utils.aoa_to_sheet(grid)

    // ── Patch formulas (SheetJS stores formula cells differently) ──
    // Format: ws[address] = { t: 'n', f: 'SUM(C3:C8)', v: <computed> }

    const colLetter = n => String.fromCharCode(64 + n) // 1=A, 2=B, …

    // For each block: B data rows = =C+D+E, Totals row = SUM formulas
    for (let bi = 0; bi < BLOCK_STARTS.length; bi++) {
      const h = BLOCK_STARTS[bi]
      const ds = BLOCK_DATA_START(h)
      const de = BLOCK_DATA_END(h)
      const tr = BLOCK_TOTALS(h)

      // B data rows: =C+D+E
      for (let r = ds; r <= de; r++) {
        const addr = `B${r}`
        const cRef = `C${r}`, dRef = `D${r}`, eRef = `E${r}`
        const cv = (days[bi]?.sizes?.[SIZES[r - ds]] || {})
        const computed = (+cv.paykel || 0) + (+cv.daniel || 0) + (+cv.stewart || 0)
        ws[addr] = { t: 'n', f: `${cRef}+${dRef}+${eRef}`, v: computed }
      }

      // Totals row: SUM for B (b = sum of C+D+E totals), C, D, E, F, G, H
      // B totals = sum of B data rows
      const bSum = `SUM(B${ds}:B${de})`
      const bComputedArr = SIZES.map(s => {
        const c = (days[bi]?.sizes?.[s] || {})
        return (+c.paykel || 0) + (+c.daniel || 0) + (+c.stewart || 0)
      })
      const bComputed = bComputedArr.reduce((a, v) => a + v, 0)
      ws[`B${tr}`] = { t: 'n', f: bSum, v: bComputed }

      for (const [ci, key] of [[3,'paykel'],[4,'daniel'],[5,'stewart'],[6,'ink_stain'],[7,'large_holes'],[8,'to_repair']]) {
        const col = colLetter(ci)
        const f   = `SUM(${col}${ds}:${col}${de})`
        const v   = SIZES.reduce((a, s) => a + (+((days[bi]?.sizes?.[s] || {})[key]) || 0), 0)
        ws[`${col}${tr}`] = { t: 'n', f, v: v || 0 }
      }
    }

    // Weekly Total row 47 — matches the original formula style
    // Original: =C46+C37+C28+C19++C10 (double ++ is a typo in source — we use single)
    const totRows = BLOCK_STARTS.map(h => BLOCK_TOTALS(h)) // [10,19,28,37,46]
    for (const [ci, key] of [[2,'_tp'],[3,'paykel'],[4,'daniel'],[5,'stewart'],[6,'ink_stain'],[7,'large_holes'],[8,'to_repair']]) {
      const col = colLetter(ci)
      const refStr = totRows.map(r => `${col}${r}`).join('+')
      let v = 0
      if (key === '_tp') {
        // Total Packed weekly = sum of B totals
        v = totRows.reduce((a, h_tr) => {
          const biMatch = BLOCK_STARTS.findIndex(h => BLOCK_TOTALS(h) === h_tr)
          const bArr = SIZES.map(s => {
            const c = (days[biMatch]?.sizes?.[s] || {})
            return (+c.paykel || 0) + (+c.daniel || 0) + (+c.stewart || 0)
          })
          return a + bArr.reduce((s, n) => s + n, 0)
        }, 0)
      } else {
        v = totRows.reduce((a, h_tr) => {
          const biMatch = BLOCK_STARTS.findIndex(h => BLOCK_TOTALS(h) === h_tr)
          return a + SIZES.reduce((s2, sz) => s2 + (+((days[biMatch]?.sizes?.[sz] || {})[key]) || 0), 0)
        }, 0)
      }
      ws[`${col}47`] = { t: 'n', f: refStr, v: v || 0 }
    }

    // I47 = SUM(C47:H47)
    const i47Val = ['C','D','E','F','G','H'].reduce((a, col) => a + (+ws[`${col}47`]?.v || 0), 0)
    ws['I47'] = { t: 'n', f: 'SUM(C47:H47)', v: i47Val }

    // B56 = Fisher and Paykel to Inject = =F47+G47
    const fp = (+ws['F47']?.v || 0) + (+ws['G47']?.v || 0)
    ws['B56'] = { t: 'n', f: 'F47+G47', v: fp }

    // ── Set merged cells (column I spans each day block) ──
    if (!ws['!merges']) ws['!merges'] = []
    for (const h of BLOCK_STARTS) {
      const ds = BLOCK_DATA_START(h) - 1  // 0-based
      const de = BLOCK_TOTALS(h) - 1      // merge through Totals row (matching original I2:I10)
      ws['!merges'].push({ s: { r: h - 1, c: 8 }, e: { r: de, c: 8 } })
    }

    // ── Column widths (approximate the original) ──
    ws['!cols'] = [
      { wch: 10 }, // A Size
      { wch: 14 }, // B Total Packed
      { wch: 10 }, // C Paykel
      { wch: 10 }, // D Daniel
      { wch: 10 }, // E Stewart
      { wch: 10 }, // F Ink Stain
      { wch: 18 }, // G Large/Burnt Holes
      { wch: 10 }, // H To Repair
      { wch: 12 }, // I Date
    ]

    // ── Set worksheet range ──
    ws['!ref'] = `A1:I56`

    // ── Build workbook ──
    const wb = XLSX.utils.book_new()
    // Name the sheet after the week
    let sheetName = 'Week'
    try {
      const d = new Date(weekStart + 'T00:00:00')
      sheetName = `Week of ${d.getDate()} ${d.toLocaleString('en-NZ', { month: 'short' })}`
    } catch {}
    XLSX.utils.book_append_sheet(wb, ws, sheetName)

    // ── Write to buffer ──
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="Laundry-Week-${weekStart}.xlsx"`)
    return res.status(200).send(buf)
  } catch (err) {
    console.error('build-weekly-xlsx error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
