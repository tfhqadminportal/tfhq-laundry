// ============================================================
// TFHQ Laundry — OCR endpoint (Vercel serverless function)
// Reads a photo of the existing handwritten weekly Gown
// Processing Log and returns structured JSON that maps 1:1 to
// the columns in the user's existing Excel sheets.
// ============================================================
//
// Expects env var: ANTHROPIC_API_KEY
//
// Request body (JSON):
//   { image: "data:image/jpeg;base64,...", weekStart?: "YYYY-MM-DD" }
//
// Response (JSON):
//   {
//     days: [
//       {
//         date_label: "Monday" | "30/3" | "Mon 30-3",
//         sizes: {
//           "XS":  { paykel: 0, daniel: 0, stewart: 0, ink_stain: 0, large_holes: 0, to_repair: 0 },
//           "M":   { ... },
//           "XL":  { ... },
//           "3XL": { ... },
//           "5XL": { ... },
//           "7XL": { ... },
//           "9XL": { ... }
//         }
//       }
//     ],
//     weekly: {
//       bag_counts:    { paykel: 0, daniel: 0, stewart: 0 },
//       labelling:     0,
//       sleeve_repair: 0,
//       general_repair:0,
//       fp_inject:     0
//     },
//     confidence: "high" | "medium" | "low",
//     notes: "any uncertainties from the model"
//   }

export const config = { runtime: 'nodejs', maxDuration: 60 }

const SIZES     = ['XS', 'M', 'XL', '3XL', '5XL', '7XL', '9XL']
const BUILDINGS = ['paykel', 'daniel', 'stewart']

const SYSTEM_PROMPT = `You are an OCR specialist that extracts structured data from a handwritten weekly "Gown Processing Log" for a laundry business.

SHEET LAYOUT (what you will see in the photo):
- One A4 page printed in portrait, containing 4 or 5 daily tables stacked top-to-bottom (one table per weekday — sometimes only 4 days are filled because of public holidays).
- Every daily table has the same 7 columns in this exact left-to-right order:
    1. Size
    2. Paykel
    3. Daniel
    4. Stewart
    5. Ink Stain
    6. Large Holes
    7. To Repair
- Every daily table has 7 size rows in this exact top-to-bottom order: XS, M, XL, 3XL, 5XL, 7XL, 9XL.
- Each daily table also has a "Totals" row at the bottom — IGNORE that totals row, do NOT return it.
- The day's date is usually written near the top of the table (e.g. "Monday", "Mon 30/3", "30-3", or just "Monday 30/3"). Capture whatever you see in "date_label" verbatim.

WEEKLY EXTRAS (usually written below the daily tables, on the same page or next to them):
- "Paykel bags" / "Paykel black bags"   - integer
- "Daniel bags" / "Daniel red bags"     - integer
- "Stewart bags" / "Stewart blue bags"  - integer
- "Labelling" / "Total labelled"        - integer
- "Sleeve repair"                       - integer (optional)
- "General repair"                      - integer (optional)
- "Fisher & Paykel to inject" / "FP inject" - integer (optional)

OUTPUT: return ONLY valid raw JSON (no markdown fences, no preamble, no commentary) with this exact shape:

{
  "days": [
    {
      "date_label": "Monday",
      "sizes": {
        "XS":  { "paykel": 61, "daniel": 15, "stewart": 180, "ink_stain": 1, "large_holes": 0, "to_repair": 0 },
        "M":   { "paykel": 185,"daniel": 41, "stewart": 336, "ink_stain": 1, "large_holes": 0, "to_repair": 0 },
        "XL":  { "paykel": 186,"daniel": 43, "stewart": 317, "ink_stain": 2, "large_holes": 0, "to_repair": 2 },
        "3XL": { "paykel": 155,"daniel": 37, "stewart": 244, "ink_stain": 2, "large_holes": 0, "to_repair": 2 },
        "5XL": { "paykel": 87, "daniel": 17, "stewart": 199, "ink_stain": 4, "large_holes": 0, "to_repair": 1 },
        "7XL": { "paykel": 93, "daniel": 19, "stewart": 171, "ink_stain": 5, "large_holes": 0, "to_repair": 2 },
        "9XL": { "paykel": 0,  "daniel": 0,  "stewart": 0,   "ink_stain": 0, "large_holes": 0, "to_repair": 0 }
      }
    }
  ],
  "weekly": {
    "bag_counts":     { "paykel": 45, "daniel": 45, "stewart": 130 },
    "labelling":      427,
    "sleeve_repair":  0,
    "general_repair": 0,
    "fp_inject":      0
  },
  "confidence": "high",
  "notes": "Row 9XL was blank on every day."
}

RULES:
- Empty cells, blanks, dashes ("-"), and "x" all count as 0.
- Always include all 7 sizes (XS, M, XL, 3XL, 5XL, 7XL, 9XL) in every day, even if the row is empty.
- Always include all 3 buildings (paykel, daniel, stewart) plus ink_stain, large_holes, to_repair in every size row.
- Return one entry per filled-in day under "days" — do NOT pad with empty days.
- date_label stays in the format you see on the sheet. Do NOT invent a year or guess the day name.
- If a number is genuinely unreadable, pick your best guess and add a short note in "notes" describing which cell.
- All numbers must be non-negative integers.
- Output raw JSON only — no markdown fences, no preamble.`

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' })

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return res.status(500).json({
        error: 'Server is missing ANTHROPIC_API_KEY. Add it in Vercel → Project → Settings → Environment Variables and redeploy.',
      })
    }

    const { image } = req.body || {}
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'Missing "image" field (expected base64 data URL).' })
    }

    const match = image.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/)
    if (!match) return res.status(400).json({ error: 'Image must be a base64 data URL.' })
    const mediaType = match[1]
    const base64    = match[2]

    const approxBytes = (base64.length * 3) / 4
    if (approxBytes > 20 * 1024 * 1024) {
      return res.status(413).json({ error: 'Image too large (>20 MB). Please compress and retry.' })
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system:     SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text',  text: 'Extract every filled-in daily table from this Gown Processing Log photo and return the JSON described in the system prompt. Output raw JSON only — no markdown.' },
            ],
          },
        ],
      }),
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      console.error('Anthropic API error:', claudeRes.status, errText)
      return res.status(502).json({ error: `Claude API error (${claudeRes.status}): ${errText.slice(0, 300)}` })
    }

    const payload   = await claudeRes.json()
    const textBlock = (payload.content || []).find(b => b.type === 'text')
    if (!textBlock) return res.status(502).json({ error: 'Claude returned no text content.' })

    let raw = textBlock.text.trim()
    if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      console.error('Failed to parse Claude JSON:', raw.slice(0, 500))
      return res.status(502).json({ error: 'Claude did not return valid JSON.', raw: raw.slice(0, 500) })
    }

    // Normalise every cell so the front-end can rely on a fixed shape.
    const days = (parsed.days || []).map(d => {
      const sizes = {}
      for (const s of SIZES) {
        const cell = (d.sizes || {})[s] || {}
        const out = {
          ink_stain:   toInt(cell.ink_stain),
          large_holes: toInt(cell.large_holes),
          to_repair:   toInt(cell.to_repair),
        }
        for (const b of BUILDINGS) {
          out[b] = toInt(cell[b])
        }
        sizes[s] = out
      }
      return { date_label: String(d.date_label || '').trim(), sizes }
    })

    const weekly    = parsed.weekly    || {}
    const bagCounts = weekly.bag_counts || {}

    return res.status(200).json({
      days,
      weekly: {
        bag_counts: {
          paykel:  toInt(bagCounts.paykel),
          daniel:  toInt(bagCounts.daniel),
          stewart: toInt(bagCounts.stewart),
        },
        labelling:      toInt(weekly.labelling ?? weekly.total_labelled),
        sleeve_repair:  toInt(weekly.sleeve_repair),
        general_repair: toInt(weekly.general_repair),
        fp_inject:      toInt(weekly.fp_inject),
      },
      confidence: parsed.confidence || 'medium',
      notes:      parsed.notes      || '',
    })
  } catch (err) {
    console.error('OCR handler crashed:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

function toInt(v) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}
