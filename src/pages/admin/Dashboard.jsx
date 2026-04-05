import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { format, subDays } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts'
import {
  Shirt, AlertTriangle, Wrench, Building2, Users,
  ClipboardList, TrendingUp, Clock, Zap,
} from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import RosterHoursWidget from '@/components/ui/RosterHoursWidget'

function useDashboardData() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const today        = new Date()
      const thirtyAgo   = format(subDays(today, 30), 'yyyy-MM-dd')
      const todayStr     = format(today, 'yyyy-MM-dd')

      const [logsRes, clientsRes, staffRes, extrasRes] = await Promise.all([
        supabase
          .from('laundry_logs')
          .select('id, log_date, total_packed, status, client_id, building_id, laundry_buildings(name), laundry_clients(name, target_gowns_per_hour, staff_count), laundry_log_rows(*)')
          .gte('log_date', thirtyAgo)
          .lte('log_date', todayStr)
          .order('log_date', { ascending: false }),
        supabase.from('laundry_clients').select('id, name, staff_count, target_gowns_per_hour').eq('active', true),
        supabase.from('laundry_profiles').select('id, role').eq('active', true),
        supabase.from('laundry_daily_extras')
          .select('client_id, log_date, shift_hours, staff_on_shift, labelling, sleeve_repair, general_repair, fp_inject')
          .gte('log_date', thirtyAgo)
          .lte('log_date', todayStr),
      ])

      const logs    = logsRes.data || []
      const clients = clientsRes.data || []
      const staff   = staffRes.data || []
      const extras  = extrasRes.data || []

      // KPI aggregation (blue + white + grey all count)
      let totalPacked = 0, totalRejects = 0, totalRepairs = 0

      const dailyMap = {}

      logs.forEach(log => {
        const rows = log.laundry_log_rows || []
        const logPacked  = rows.reduce((s, r) => s + (r.blue_gowns || 0) + (r.white_gowns || 0) + (r.grey_gowns || 0), 0)
        const logRejects = rows.reduce((s, r) => s + (r.ink_stain || 0) + (r.large_holes || 0), 0)
        const logRepairs = rows.reduce((s, r) => s + (r.to_repair || 0), 0)
        totalPacked  += logPacked
        totalRejects += logRejects
        totalRepairs += logRepairs

        if (!dailyMap[log.log_date]) {
          dailyMap[log.log_date] = { date: log.log_date, packed: 0, rejects: 0, repairs: 0 }
        }
        dailyMap[log.log_date].packed  += logPacked
        dailyMap[log.log_date].rejects += logRejects
        dailyMap[log.log_date].repairs += logRepairs
      })

      // Last 14 days chart
      const chartData = []
      for (let i = 13; i >= 0; i--) {
        const d = format(subDays(today, i), 'yyyy-MM-dd')
        const entry = dailyMap[d] || { packed: 0, rejects: 0, repairs: 0 }
        chartData.push({
          date: format(subDays(today, i), 'dd MMM'),
          packed:  entry.packed,
          rejects: entry.rejects,
          repairs: entry.repairs,
        })
      }

      // Building breakdown (30 days)
      const buildingMap = {}
      logs.forEach(log => {
        const key = log.laundry_buildings?.name || 'Unknown'
        const rows = log.laundry_log_rows || []
        const p = rows.reduce((s, r) => s + (r.blue_gowns || 0) + (r.white_gowns || 0) + (r.grey_gowns || 0), 0)
        buildingMap[key] = (buildingMap[key] || 0) + p
      })
      const buildingData = Object.entries(buildingMap)
        .map(([name, packed]) => ({ name, packed }))
        .sort((a, b) => b.packed - a.packed)

      // Today
      const todayLogs   = logs.filter(l => l.log_date === todayStr)
      const todayPacked = todayLogs.reduce((s, log) => {
        return s + (log.laundry_log_rows || []).reduce((r, row) => {
          return r + (row.blue_gowns || 0) + (row.white_gowns || 0) + (row.grey_gowns || 0)
        }, 0)
      }, 0)

      // Today's extras for productivity
      const todayExtras = extras.filter(e => e.log_date === todayStr)

      // Productivity for today (per client)
      const productivityItems = clients.map(client => {
        const clientLogs = todayLogs.filter(l => l.client_id === client.id)
        const clientGowns = clientLogs.reduce((s, log) => {
          return s + (log.laundry_log_rows || []).reduce((r, row) => {
            return r + (row.blue_gowns || 0) + (row.white_gowns || 0) + (row.grey_gowns || 0)
          }, 0)
        }, 0)
        const ex = todayExtras.find(e => e.client_id === client.id)
        const sh = parseFloat(ex?.shift_hours) || 0
        const sc = parseInt(ex?.staff_on_shift) || parseInt(client.staff_count) || 3
        const tr = parseInt(client.target_gowns_per_hour) || 60

        if (!clientGowns) return null

        const actualRate    = sh > 0 && sc > 0 ? Math.round(clientGowns / sh / sc) : null
        const expectedHours = sc > 0 && tr > 0 ? (clientGowns / (sc * tr)).toFixed(1) : null
        const efficiency    = actualRate ? Math.round((actualRate / tr) * 100) : null

        return {
          client: client.name,
          gowns: clientGowns,
          shiftHours: sh,
          staffOnShift: sc,
          targetRate: tr,
          actualRate,
          expectedHours,
          efficiency,
        }
      }).filter(Boolean)

      return {
        totalPacked, totalRejects, totalRepairs,
        clientCount: clients.length,
        staffCount:  staff.filter(s => s.role === 'staff').length,
        logCount:    logs.length,
        todayPacked, todayLogCount: todayLogs.length,
        chartData, buildingData,
        recentLogs: logs.slice(0, 8),
        productivityItems,
      }
    },
  })
}

export default function AdminDashboard() {
  const { data, isLoading } = useDashboardData()

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-gray-200 rounded-xl" />)}
        </div>
        <div className="h-64 bg-gray-200 rounded-xl" />
      </div>
    )
  }

  const rejectRate = data?.totalPacked
    ? ((data.totalRejects / data.totalPacked) * 100).toFixed(1)
    : '0.0'

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Last 30 days · {format(new Date(), 'EEEE d MMMM yyyy')}</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Gowns Processed" value={data?.totalPacked?.toLocaleString()} sub="Last 30 days"         icon={Shirt}         color="navy" />
        <StatCard label="Today's Total"   value={data?.todayPacked?.toLocaleString()} sub={`${data?.todayLogCount} log${data?.todayLogCount !== 1 ? 's' : ''} submitted`} icon={TrendingUp}     color="gold" />
        <StatCard label="Rejects"         value={data?.totalRejects?.toLocaleString()} sub={`${rejectRate}% reject rate`} icon={AlertTriangle}  color="red" />
        <StatCard label="For Repair"      value={data?.totalRepairs?.toLocaleString()} sub="Items flagged"        icon={Wrench}        color="blue" />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Active Clients"  value={data?.clientCount} icon={Building2}   color="green" />
        <StatCard label="Staff Members"   value={data?.staffCount}  icon={Users}       color="navy" />
        <StatCard label="Total Logs"      value={data?.logCount}    sub="30 days" icon={ClipboardList} color="gold" />
      </div>

      {/* Today's Productivity */}
      {data?.productivityItems?.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Zap size={16} className="text-gold-600" />
            <h2 className="text-sm font-semibold text-gray-700">Today's Productivity</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {data.productivityItems.map(item => {
              const isGood = (item.efficiency || 0) >= 100
              const isOk   = (item.efficiency || 0) >= 80
              const cls    = isGood ? 'text-green-600' : isOk ? 'text-amber-500' : 'text-red-500'
              const barCls = isGood ? 'bg-green-500' : isOk ? 'bg-amber-400' : 'bg-red-400'

              return (
                <div key={item.client} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-semibold text-gray-800">{item.client}</p>
                      <p className="text-xs text-gray-500">
                        {item.gowns.toLocaleString()} gowns
                        {item.shiftHours > 0 && ` · ${item.staffOnShift} staff · ${item.shiftHours} hrs`}
                      </p>
                    </div>
                    <div className="text-right">
                      {item.efficiency !== null ? (
                        <>
                          <p className={`text-xl font-bold ${cls}`}>{item.efficiency}%</p>
                          <p className="text-xs text-gray-400">efficiency</p>
                        </>
                      ) : (
                        <p className="text-xs text-gray-400">No shift data</p>
                      )}
                    </div>
                  </div>

                  {item.efficiency !== null && (
                    <div className="space-y-1">
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${barCls}`} style={{ width: `${Math.min(item.efficiency, 100)}%` }} />
                      </div>
                      <div className="flex justify-between text-xs text-gray-400">
                        <span>
                          Actual: {item.actualRate}/hr/person · Target: {item.targetRate}/hr/person
                        </span>
                        {item.expectedHours && (
                          <span>
                            Expected {item.expectedHours} hrs · Actual {item.shiftHours} hrs
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {item.efficiency === null && item.gowns > 0 && (
                    <p className="text-xs text-amber-500">
                      Staff haven't recorded shift hours yet — productivity can't be calculated.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Roster Hours */}
      <RosterHoursWidget mode="dashboard" />

      {/* Charts Row */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Daily Volume Chart */}
        <div className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Daily Volume — Last 14 Days</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data?.chartData} barSize={14} margin={{ top: 0, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={1} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(val, name) => [val.toLocaleString(), name.charAt(0).toUpperCase() + name.slice(1)]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="packed"  name="Packed"  fill="#1B3A5C" radius={[3,3,0,0]} />
              <Bar dataKey="rejects" name="Rejects" fill="#ef4444" radius={[3,3,0,0]} />
              <Bar dataKey="repairs" name="Repairs" fill="#B8952A" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Building Breakdown */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">By Building (30 days)</h2>
          {data?.buildingData?.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">No data yet</p>
          )}
          <div className="space-y-3">
            {data?.buildingData?.map(({ name, packed }) => {
              const max = data.buildingData[0]?.packed || 1
              const pct = Math.round((packed / max) * 100)
              return (
                <div key={name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700">{name}</span>
                    <span className="text-gray-500">{packed.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-navy-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Recent Logs */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Recent Log Entries</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-header">Date</th>
                <th className="table-header">Client</th>
                <th className="table-header">Building</th>
                <th className="table-header text-right">Packed</th>
                <th className="table-header text-right">Rejects</th>
                <th className="table-header text-right">Repairs</th>
                <th className="table-header">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data?.recentLogs?.map(log => {
                const rows = log.laundry_log_rows || []
                const p   = rows.reduce((s, r) => s + (r.blue_gowns || 0) + (r.white_gowns || 0) + (r.grey_gowns || 0), 0)
                const rej = rows.reduce((s, r) => s + (r.ink_stain || 0) + (r.large_holes || 0), 0)
                const rep = rows.reduce((s, r) => s + (r.to_repair || 0), 0)
                return (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell font-medium">{format(new Date(log.log_date), 'dd MMM yyyy')}</td>
                    <td className="table-cell">{log.laundry_clients?.name || '—'}</td>
                    <td className="table-cell">{log.laundry_buildings?.name || '—'}</td>
                    <td className="table-cell text-right font-semibold">{p.toLocaleString()}</td>
                    <td className="table-cell text-right text-red-600">{rej || '—'}</td>
                    <td className="table-cell text-right text-amber-600">{rep || '—'}</td>
                    <td className="table-cell">
                      <span className={log.status === 'reviewed' ? 'badge-green' : log.status === 'submitted' ? 'badge-blue' : 'badge-gray'}>
                        {log.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {!data?.recentLogs?.length && (
                <tr><td colSpan={7} className="table-cell text-center text-gray-400 py-8">No logs found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
