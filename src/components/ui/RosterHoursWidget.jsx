import { CalendarClock, Users, Clock, AlertTriangle, RefreshCw } from 'lucide-react'
import { useRosterHours } from '@/hooks/useRosterHours'
import { useQueryClient } from '@tanstack/react-query'

/**
 * RosterHoursWidget
 *
 * Props:
 *   mode  — 'dashboard' (full weekly/monthly view) | 'date' (single-date detail)
 *   date  — ISO date string, required when mode='date'
 */
export default function RosterHoursWidget({ mode = 'dashboard', date }) {
  const { data, isLoading, isError, error, isFetching } = useRosterHours()
  const qc = useQueryClient()

  if (isLoading) {
    return (
      <div className="card p-5 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-40 mb-3" />
        <div className="grid grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl" />)}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="card p-4 border border-amber-200 bg-amber-50">
        <div className="flex items-center gap-2 text-amber-700 text-sm font-semibold mb-1">
          <AlertTriangle size={15} /> Roster connection unavailable
        </div>
        <p className="text-xs text-amber-600">{error?.message || 'Could not reach the roster database.'}</p>
        <p className="text-xs text-amber-500 mt-1">
          To fix: in Firebase console → Realtime Database → Rules, set
          <code className="mx-1 bg-amber-100 px-1 rounded">"cleaning/logs": {`{".read": true}`}</code>
        </p>
        <button onClick={() => qc.invalidateQueries({ queryKey: ['roster-hours'] })} className="mt-2 text-xs font-semibold text-amber-700 underline flex items-center gap-1">
          <RefreshCw size={11} /> Retry
        </button>
      </div>
    )
  }

  if (mode === 'date') {
    return <DateView data={data} date={date} isFetching={isFetching} qc={qc} />
  }

  return <DashboardView data={data} isFetching={isFetching} qc={qc} />
}

// ─── Dashboard view: today + week + month totals ───────────────
function DashboardView({ data, isFetching, qc }) {
  const { today, thisWeek, thisMonth } = data

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock size={16} className="text-indigo-500" />
          <h2 className="font-semibold text-gray-800">Roster Hours — Laundry Site</h2>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['roster-hours'] })}
          disabled={isFetching}
          className="text-xs text-gray-400 hover:text-navy-600 flex items-center gap-1 transition-colors"
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          {isFetching ? 'Syncing…' : 'Refresh'}
        </button>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 divide-x divide-gray-100">
        {[
          { label: 'Today',      hours: today.totalHours,     staff: today.staffCount,     sub: today.staff.map(s => s.name).join(', ') || 'No hours logged' },
          { label: thisWeek.label,  hours: thisWeek.totalHours,  staff: thisWeek.staffCount,  sub: `${thisWeek.days} day${thisWeek.days !== 1 ? 's' : ''} worked` },
          { label: thisMonth.label, hours: thisMonth.totalHours, staff: thisMonth.staffCount, sub: `${thisMonth.days} day${thisMonth.days !== 1 ? 's' : ''} worked` },
        ].map(({ label, hours, staff, sub }) => (
          <div key={label} className="p-4 text-center">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className="text-2xl font-bold text-indigo-700">{hours}<span className="text-sm font-normal text-gray-500 ml-1">hrs</span></p>
            <p className="text-xs text-gray-500 mt-0.5 flex items-center justify-center gap-1">
              <Users size={10} /> {staff} staff
            </p>
            <p className="text-xs text-gray-400 mt-0.5 truncate">{sub}</p>
          </div>
        ))}
      </div>

      {/* Today's per-staff breakdown */}
      {today.staff.length > 0 && (
        <div className="border-t border-gray-100">
          <div className="px-5 py-3 bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Today's Staff</p>
          </div>
          <div className="divide-y divide-gray-50">
            {today.staff.map(s => (
              <div key={s.name} className="flex items-center justify-between px-5 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs">
                    {s.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{s.name}</p>
                    {s.shifts[0]?.start && (
                      <p className="text-xs text-gray-400">{s.shifts[0].start} – {s.shifts[0].end}</p>
                    )}
                  </div>
                </div>
                <span className="text-sm font-bold text-indigo-700">{s.totalHours} hrs</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {today.totalHours === 0 && (
        <div className="px-5 py-4 text-center text-sm text-gray-400">
          No roster hours logged for today yet.
        </div>
      )}
    </div>
  )
}

// ─── Date view: single date detail (used in LogDetail) ────────
function DateView({ data, date, isFetching, qc }) {
  const entry = data?.byDate?.[date] || null

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock size={16} className="text-indigo-500" />
          <h2 className="font-semibold text-gray-800">Roster Hours for This Day</h2>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['roster-hours'] })}
          disabled={isFetching}
          className="text-xs text-gray-400 hover:text-navy-600 flex items-center gap-1 transition-colors"
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {entry ? (
        <>
          {/* Totals row */}
          <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100">
            <div className="p-4 text-center">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 flex items-center justify-center gap-1">
                <Clock size={11} /> Total Hours
              </p>
              <p className="text-2xl font-bold text-indigo-700">{entry.totalHours}</p>
            </div>
            <div className="p-4 text-center">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 flex items-center justify-center gap-1">
                <Users size={11} /> Staff on Site
              </p>
              <p className="text-2xl font-bold text-indigo-700">{entry.staffCount}</p>
            </div>
          </div>

          {/* Per-staff breakdown */}
          <div className="divide-y divide-gray-50">
            {entry.staff.map((s, i) => (
              <div key={`${s.name}-${i}`} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs">
                    {s.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{s.name}</p>
                    {s.start && (
                      <p className="text-xs text-gray-400">{s.start} – {s.end}</p>
                    )}
                  </div>
                </div>
                <span className="text-sm font-bold text-indigo-700">{s.hours} hrs</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="px-5 py-6 text-center text-sm text-gray-400">
          No roster hours found for this date in the Laundry site.
        </div>
      )}
    </div>
  )
}
