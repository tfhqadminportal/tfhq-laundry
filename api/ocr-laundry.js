// ============================================================
// TFHQ Laundry — OCR endpoint (Vercel serverless function)
// Accepts a base64 image of the weekly handwritten log sheet
// and returns structured JSON using Claude Vision.
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
//         date_label: "30/3",
//         sizes: {
//           "XS": {
//             paykel:  { blue: 0, white: 61, grey: 0 },
//             daniel:  { blue: 0, white: 15, grey: 0 },
//             stewart: { blue: 0, white: 180, grey: 0 },
//             ink_stain: 1, large_holes: 0, to_repair: 0
//           },
//           ...
//         }
//       },
//       ...
//     ],
//     weekly: {
//       bag_counts:    { paykel: 45, daniel: 45, stewart: 130 },
//       total_labelled: 427,
//       total_gowns:    6636
//     },
//     confidence: "high" | "medium" | "low",
//     notes: "any uncertainties from the model"
//   }

export const config = { runtime: 'nodejs', maxDuration: 60 }

const SIZES   = ['XS', 'M', 'XL', '3XL', '5XL', '7XL', '9XL']
const COLOURS = ['blue', 'white', 'grey']
const BUILDINGS = ['paykel', 'daniel', 'stewart']

const SYSTEM_PROMPT = `You are an OCR specialist that extracts structured data from handwritten laundry log sheets.

SHEET LAYOUT (what you will see):
- One page containing several daily tables (typically 4 or 5, one per weekday).
- Each daily table has a day label (e.g. "Monday" / "30/3" / "Mon 30-3").
- Rows = gown sizes in this exact order: XS, M, XL, 3XL, 5XL, 7XL, 9XL.
- Columns per day table (13 columns total):
    1.  Size
    2-4. PAYKEL  (Blue, White, Grey)
    5-7. DANIEL  (Blue, White, Grey)
    8-10. STEWART (Blue, White, Grey)
    11. Ink Stain  (reject, per size, not per building)
    12. Large Holes (reject)
    13. To Repair   (reject)
- An optional Totals row at the bottom of each day table (ignore — don't return it).

BACKWARDS COMPATIBILITY: Older sheets may have only ONE column per building (no blue/white/grey split). In that case put the whole number in the "white" bucket and leave blue and grey at 0.

WEEKLY TOTALS (at the bottom of the page):
- "Paykel bags" (or "Paykel black bags") - integer
- "Daniel bags" (or "Daniel red bags")   - integer
- "Stewart bags" (or "Stewart blue bags") - integer
- "Total labelled" - integer
- "Total" or "Total gowns" - integer (all sizes × buildings × colours for the whole week)

OUTPUT: return ONLY valid JSON (no markdown, no preamble) with this exact shape:

{
  "days": [
    {
      "date_label": "Monday",
      "sizes": {
        "XS": {
          "paykel":  { "blue": 0, "white": 61, "grey": 0 },
          "daniel":  { "blue": 0, "white": 15, "grey": 0 },
          "stewart": { "blue": 0, "white": 180, "grey": 0 },
          "ink_stain": 1, "large_holes": 0, "to_repair": 0
        },
        "M":  { "paykel":  { "blue": 0, "white": 185, "grey": 0 }, "daniel":  { "blue": 0, "white": 41, "grey": 0 }, "stewart": { "blue": 0, "white": 336, "grey": 0 }, "ink_stain": 1, "large_holes": 0, "to_repair": 0 },
        "XL": { "paykel":  { "blue": 0, "white": 186, "grey": 0 }, "daniel":  { "blue": 0, "white": 43, "grey": 0 }, "stewart": { "blue": 0, "white": 317, "grey": 0 }, "ink_stain": 2, "large_holes": 0, "to_repair": 2 },
        "3XL": { "paykel": { "blue": 0, "white": 155, "grey": 0 }, "daniel":  { "blue": 0, "white": 37, "grey": 0 }, "stewart": { "blue": 0, "white": 244, "grey": 0 }, "ink_stain": 2, "large_holes": 0, "to_repair": 2 },
        "5XL": { "paykel": { "blue": 0, "white": 87,  "grey": 0 }, "daniel":  { "blue": 0, "white": 17, "grey": 0 }, "stewart": { "blue": 0, "white": 199, "grey": 0 }, "ink_stain": 4, "large_holes": 0, "to_repair": 1 },
        "7XL": { "paykel": { "blue": 0, "white": 93,  "grey": 0 }, "daniel":  { "blue": 0, "white": 19, "grey": 0 }, "stewart": { "blue": 0, "white": 171, "grey": 0 }, "ink_stain": 5, "large_holes": 0, "to_repair": 2 },
        "9XL": { "paykel": { "blue": 0, "white": 0,   "grey": 0 }, "daniel":  { "blue": 0, "white": 0,  "grey": 0 }, "stewart": { "blue": 0, "white": 0,   "grey": 0 }, "ink_stain": 0, "large_holes": 0, "to_repair": 0 }
      }
    }
  ],
  "weekly": {
    "bag_counts":    { "paykel": 45, "daniel": 45, "stewart": 130 },
    "total_labelled": 427,
    "total_gowns":    6636
  },
  "confidence": "high",
  "notes": "Row 9XL was blank on every day."
}

RULES:
- Empty cells = 0. Blanks and dashes both count as 0.
- Always include all 7 sizes in every day object (XS, M, XL, 3XL, 5XL, 7XL, 9XL).
- Always include all 3 buildings (paykel, daniel, stewart) with all 3 colours (blue, white, grey) in every size object.
- date_label stays in the format you see on the sheet. Do NOT invent a year.
- If handwriting is ambiguous, pick your best guess and list the uncertainty in "notes".
- Do NOT wrap the JSON in code fences. Output raw JSON only.`

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
              { type: 'text',  text: 'Extract every daily table from this laundry sheet and return the JSON described in the system prompt. Output raw JSON only.' },
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

    // Normalise every cell so the front-end can rely on a fixed shape
    const days = (parsed.days || []).map(d => {
      const sizes = {}
      for (const s of SIZES) {
        const cell = (d.sizes || {})[s] || {}
        const out  = {
          ink_stain:   toInt(cell.ink_stain),
          large_holes: toInt(cell.large_holes),
          to_repair:   toInt(cell.to_repair),
        }
        for (const b of BUILDINGS) {
          const bc = cell[b] || {}
          // Back-compat: if the OCR only returned a plain number for a building,
          // put the whole count into the "white" bucket.
          if (typeof bc === 'number') {
            out[b] = { blue: 0, white: toInt(bc), grey: 0 }
          } else {
            out[b] = {
              blue:  toInt(bc.blue),
              white: toInt(bc.white),
              grey:  toInt(bc.grey),
            }
          }
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
        total_labelled: toInt(weekly.total_labelled),
        total_gowns:    toInt(weekly.total_gowns),
      },
      confidence: parsed.confidence || 'medium',
      notes:      parsed.notes || '',
    })
  } catch (err) {
    console.error('OCR handler crashed:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

function toInt(v) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : 0
}
