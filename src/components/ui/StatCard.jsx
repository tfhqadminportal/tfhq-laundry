import clsx from 'clsx'

export default function StatCard({ label, value, sub, icon: Icon, color = 'navy' }) {
  const colors = {
    navy:  'bg-navy-600 text-white',
    gold:  'bg-gold-500 text-white',
    green: 'bg-emerald-500 text-white',
    red:   'bg-red-500 text-white',
    blue:  'bg-blue-500 text-white',
  }
  return (
    <div className="card p-5 flex items-start gap-4">
      {Icon && (
        <div className={clsx('w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0', colors[color])}>
          <Icon size={20} />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value ?? '—'}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}
