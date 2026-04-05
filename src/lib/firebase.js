// ─────────────────────────────────────────────────────────────
// Firebase Realtime Database — read-only REST helper
// Pulls roster hours for the "Laundry" site from the shared
// TFHQ Roster Firebase project without requiring auth.
// ─────────────────────────────────────────────────────────────

const FIREBASE_DB_URL = 'https://tfhqlaundryportal-default-rtdb.firebaseio.com'
const LAUNDRY_SITE    = 'Laundry'   // must match exactly what staff select in the roster app

/**
 * Fetch all hour log entries for the Laundry site from Firebase.
 * Returns an array sorted by date ascending.
 *
 * Each entry shape:
 *   { _id, staffId, staffName, date, site, start, end, breakMins, hours, status, timestamp }
 */
export async function fetchLaundryRosterLogs() {
  const res = await fetch(`${FIREBASE_DB_URL}/cleaning/logs.json`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  })

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        'Firebase read permission denied. ' +
        'In the Firebase console → Realtime Database → Rules, ' +
        'set ".read": true for the cleaning/logs path.'
      )
    }
    throw new Error(`Firebase responded with status ${res.status}`)
  }

  const data = await res.json()
  if (!data) return []

  return Object.entries(data)
    .map(([id, log]) => ({ _id: id, ...log }))
    .filter(log => log.site === LAUNDRY_SITE && log.hours > 0)
    .sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0))
}

/**
 * Aggregate an array of logs into a keyed-by-date map.
 * Returns: { [date]: { totalHours, staffCount, staff: [{name, hours, start, end}] } }
 */
export function aggregateByDate(logs) {
  const map = {}
  logs.forEach(log => {
    if (!map[log.date]) {
      map[log.date] = { totalHours: 0, staffCount: 0, staff: [] }
    }
    const entry = map[log.date]
    entry.totalHours = Math.round((entry.totalHours + (log.hours || 0)) * 100) / 100
    entry.staff.push({
      name:  log.staffName || log.staffId || 'Unknown',
      hours: log.hours || 0,
      start: log.start || '',
      end:   log.end   || '',
    })
    entry.staffCount = entry.staff.length
  })
  return map
}

/**
 * Sum hours from a list of logs.
 */
export function sumHours(logs) {
  return Math.round(logs.reduce((s, l) => s + (l.hours || 0), 0) * 100) / 100
}
