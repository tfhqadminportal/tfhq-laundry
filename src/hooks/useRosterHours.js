import { useQuery } from '@tanstack/react-query'
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, format, parseISO, isWithinInterval } from 'date-fns'
import { fetchLaundryRosterLogs, aggregateByDate, sumHours } from '@/lib/firebase'

/**
 * Main hook — fetches all Laundry roster logs and returns
 * pre-computed aggregates for today, this week, this month,
 * last 30 days, and a full by-date map.
 *
 * Refreshes every 10 minutes so the dashboard stays current.
 */
export function useRosterHours() {
  return useQuery({
    queryKey:        ['roster-hours'],
    queryFn:         fetchLaundryRosterLogs,
    staleTime:       5  * 60 * 1000,   // consider fresh for 5 min
    refetchInterval: 10 * 60 * 1000,   // background refresh every 10 min
    retry:           2,
    select: (logs) => {
      const today     = new Date()
      const todayStr  = format(today, 'yyyy-MM-dd')

      const weekStart = startOfWeek(today, { weekStartsOn: 1 })  // Monday
      const weekEnd   = endOfWeek(today,   { weekStartsOn: 1 })
      const monStart  = startOfMonth(today)
      const monEnd    = endOfMonth(today)

      const inRange = (dateStr, from, to) => {
        try { return isWithinInterval(parseISO(dateStr), { start: from, end: to }) }
        catch { return false }
      }

      const logsToday  = logs.filter(l => l.date === todayStr)
      const logsWeek   = logs.filter(l => inRange(l.date, weekStart, weekEnd))
      const logsMonth  = logs.filter(l => inRange(l.date, monStart,  monEnd))

      // By-date map for the last 60 days (keeps data size manageable)
      const cutoff = format(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd')
      const recentLogs = logs.filter(l => l.date >= cutoff)
      const byDate = aggregateByDate(recentLogs)

      // Unique staff per period
      const uniqueStaff = (arr) => [...new Set(arr.map(l => l.staffName || l.staffId))]

      return {
        // Raw
        allLogs: logs,
        byDate,

        // Today
        today: {
          date:       todayStr,
          totalHours: sumHours(logsToday),
          staffCount: uniqueStaff(logsToday).length,
          staff:      buildStaffList(logsToday),
          logs:       logsToday,
        },

        // This week (Mon–Sun)
        thisWeek: {
          label:      `${format(weekStart, 'dd MMM')} – ${format(weekEnd, 'dd MMM')}`,
          totalHours: sumHours(logsWeek),
          staffCount: uniqueStaff(logsWeek).length,
          days:       countDays(logsWeek),
        },

        // This month
        thisMonth: {
          label:      format(today, 'MMMM yyyy'),
          totalHours: sumHours(logsMonth),
          staffCount: uniqueStaff(logsMonth).length,
          days:       countDays(logsMonth),
        },
      }
    },
  })
}

/**
 * Lightweight hook for a single date — used by NewEntry and LogDetail
 * to auto-fill shift details.
 */
export function useRosterForDate(dateStr) {
  const { data, isLoading, isError } = useRosterHours()
  if (!data || !dateStr) return { isLoading, isError, entry: null }
  const entry = data.byDate[dateStr] || null
  return { isLoading, isError, entry }
}

// ─── helpers ──────────────────────────────────────────────────
function buildStaffList(logs) {
  const map = {}
  logs.forEach(l => {
    const name = l.staffName || l.staffId || 'Unknown'
    if (!map[name]) map[name] = { name, totalHours: 0, shifts: [] }
    map[name].totalHours = Math.round((map[name].totalHours + (l.hours || 0)) * 100) / 100
    map[name].shifts.push({ start: l.start, end: l.end, hours: l.hours })
  })
  return Object.values(map).sort((a, b) => b.totalHours - a.totalHours)
}

function countDays(logs) {
  return new Set(logs.map(l => l.date)).size
}
