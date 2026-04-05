import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  Users, Search, Shield, User, KeyRound,
  CheckCircle, XCircle, Info, ExternalLink, Pencil, ChevronDown
} from 'lucide-react'
import Modal from '@/components/ui/Modal'
import toast from 'react-hot-toast'
import { format } from 'date-fns'

// ─── Data hooks ───────────────────────────────────────────────
function useStaff() {
  return useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('laundry_profiles')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })
}

function useClients() {
  return useQuery({
    queryKey: ['clients-simple'],
    queryFn: async () => {
      const { data } = await supabase
        .from('laundry_clients')
        .select('id, name')
        .eq('active', true)
        .order('name')
      return data || []
    },
  })
}

function useStaffAccess(staffId) {
  return useQuery({
    queryKey: ['staff-access', staffId],
    queryFn: async () => {
      if (!staffId) return []
      const { data } = await supabase
        .from('laundry_staff_access')
        .select('client_id')
        .eq('staff_id', staffId)
      return (data || []).map(r => r.client_id)
    },
    enabled: !!staffId,
  })
}

// ─── How-to guide ─────────────────────────────────────────────
function HowToAdd({ onClose }) {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-sm text-blue-800 font-medium">
          Staff accounts are created directly in Supabase to keep passwords secure.
          Once created, they appear here automatically after their first login.
        </p>
      </div>

      <div className="space-y-4">
        {[
          {
            step: '1',
            title: 'Go to your Supabase project',
            desc: 'Open supabase.com, sign in, and open your project.',
          },
          {
            step: '2',
            title: 'Go to Authentication → Users',
            desc: 'Click "Authentication" in the left sidebar, then "Users".',
          },
          {
            step: '3',
            title: 'Click "Add User" → "Create New User"',
            desc: 'Enter their email address and a temporary password. Make sure "Auto Confirm User" is ticked.',
          },
          {
            step: '4',
            title: 'Give them the login details',
            desc: 'Send the staff member their email + password. They log in at your laundry app URL.',
          },
          {
            step: '5',
            title: 'Set their role and access here',
            desc: 'After their first login, they will appear in the Staff list below. Use the "Role" and "Access" buttons to configure them.',
          },
        ].map(({ step, title, desc }) => (
          <div key={step} className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-navy-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
              {step}
            </div>
            <div>
              <p className="font-semibold text-gray-800 text-sm">{title}</p>
              <p className="text-gray-500 text-sm mt-0.5">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      <a
        href="https://supabase.com/dashboard"
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary w-full justify-center"
      >
        <ExternalLink size={15} /> Open Supabase Dashboard
      </a>

      <button className="btn-secondary w-full" onClick={onClose}>Close</button>
    </div>
  )
}

// ─── Access Manager ────────────────────────────────────────────
function AccessManager({ staff, onClose }) {
  const qc = useQueryClient()
  const { data: clients = [] } = useClients()
  const { data: currentAccess = [] } = useStaffAccess(staff?.id)
  const [checked, setChecked] = useState(null)
  const [saving, setSaving] = useState(false)

  // Initialise from loaded access
  const effective = checked ?? Object.fromEntries(currentAccess.map(id => [id, true]))

  function toggle(id) {
    setChecked(prev => {
      const base = prev ?? Object.fromEntries(currentAccess.map(id => [id, true]))
      return { ...base, [id]: !base[id] }
    })
  }

  async function save() {
    setSaving(true)
    try {
      await supabase.from('laundry_staff_access').delete().eq('staff_id', staff.id)
      const selected = clients.filter(c => !!effective[c.id]).map(c => c.id)
      if (selected.length) {
        await supabase.from('laundry_staff_access').insert(
          selected.map(cid => ({ staff_id: staff.id, client_id: cid }))
        )
      }
      qc.invalidateQueries({ queryKey: ['staff-access', staff.id] })
      toast.success('Access updated')
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Select which clients <strong>{staff.full_name || staff.email}</strong> can access and submit logs for:
      </p>
      <div className="space-y-2 border border-gray-200 rounded-xl p-3 max-h-64 overflow-y-auto">
        {clients.map(c => (
          <label key={c.id} className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 p-2 rounded-lg">
            <input
              type="checkbox"
              checked={!!effective[c.id]}
              onChange={() => toggle(c.id)}
              className="rounded border-gray-300 text-navy-600"
            />
            <span className="text-sm font-medium">{c.name}</span>
          </label>
        ))}
        {clients.length === 0 && (
          <p className="text-sm text-gray-400 py-4 text-center">No active clients — add one first</p>
        )}
      </div>
      <div className="flex justify-end gap-3">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save Access'}
        </button>
      </div>
    </div>
  )
}

// ─── Role Editor ───────────────────────────────────────────────
function RoleEditor({ staff, onClose }) {
  const qc = useQueryClient()
  const [role, setRole] = useState(staff.role || 'staff')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const { error } = await supabase
      .from('laundry_profiles')
      .update({ role })
      .eq('id', staff.id)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['staff'] })
    toast.success('Role updated')
    onClose()
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">Change role for <strong>{staff.full_name || staff.email}</strong>:</p>
      <div className="space-y-2">
        {[
          { value: 'staff', label: 'Staff', desc: 'Can submit daily log entries for assigned clients only.' },
          { value: 'admin', label: 'Admin', desc: 'Full access — dashboard, all logs, clients, reports, and staff management.' },
        ].map(opt => (
          <label
            key={opt.value}
            className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${
              role === opt.value ? 'border-navy-600 bg-navy-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="role"
              value={opt.value}
              checked={role === opt.value}
              onChange={() => setRole(opt.value)}
              className="mt-0.5"
            />
            <div>
              <p className="font-semibold text-sm text-gray-900">{opt.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
            </div>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-3">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Update Role'}
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────
export default function AdminStaff() {
  const { data: staff = [], isLoading } = useStaff()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [howToOpen, setHowToOpen] = useState(false)
  const [accessStaff, setAccessStaff] = useState(null)
  const [roleStaff, setRoleStaff] = useState(null)

  const filtered = staff.filter(s =>
    (s.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.email || '').toLowerCase().includes(search.toLowerCase())
  )

  async function toggleActive(s) {
    const { error } = await supabase
      .from('laundry_profiles')
      .update({ active: !s.active })
      .eq('id', s.id)
    if (error) toast.error(error.message)
    else {
      qc.invalidateQueries({ queryKey: ['staff'] })
      toast.success(`${s.full_name || s.email} ${s.active ? 'disabled' : 'enabled'}`)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {staff.length} total · {staff.filter(s => s.active).length} active
          </p>
        </div>
        <button onClick={() => setHowToOpen(true)} className="btn-primary">
          <Users size={16} /> Add New Staff
        </button>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-start gap-3">
        <Info size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-700">
          Staff accounts are created in Supabase and appear here automatically after their first login.
          Use the <strong>Role</strong> and <strong>Access</strong> buttons to configure each person.
          <button onClick={() => setHowToOpen(true)} className="ml-1 underline font-medium">
            How to add someone →
          </button>
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="input pl-9"
          placeholder="Search staff…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="table-header">Name</th>
              <th className="table-header">Email</th>
              <th className="table-header">Role</th>
              <th className="table-header">Status</th>
              <th className="table-header">Added</th>
              <th className="table-header text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && (
              <tr>
                <td colSpan={6} className="table-cell text-center py-10 text-gray-400">Loading…</td>
              </tr>
            )}
            {filtered.map(s => (
              <tr key={s.id} className={`hover:bg-gray-50 transition-colors ${!s.active ? 'opacity-60' : ''}`}>
                <td className="table-cell">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-navy-100 flex items-center justify-center flex-shrink-0">
                      {s.role === 'admin'
                        ? <Shield size={14} className="text-gold-500" />
                        : <User size={14} className="text-navy-600" />
                      }
                    </div>
                    <span className="font-medium text-sm">{s.full_name || '—'}</span>
                  </div>
                </td>
                <td className="table-cell text-gray-500 text-sm">{s.email}</td>
                <td className="table-cell">
                  <span className={s.role === 'admin'
                    ? 'badge bg-gold-100 text-gold-700'
                    : 'badge-blue'
                  }>
                    {s.role || 'staff'}
                  </span>
                </td>
                <td className="table-cell">
                  <span className={s.active ? 'badge-green' : 'badge-gray'}>
                    {s.active ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="table-cell text-gray-400 text-xs">
                  {s.created_at ? format(new Date(s.created_at), 'dd MMM yyyy') : '—'}
                </td>
                <td className="table-cell">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => setRoleStaff(s)}
                      className="btn-secondary btn-sm"
                      title="Change role"
                    >
                      <Shield size={13} /> Role
                    </button>
                    {(s.role !== 'admin') && (
                      <button
                        onClick={() => setAccessStaff(s)}
                        className="btn-secondary btn-sm"
                        title="Manage client access"
                      >
                        <KeyRound size={13} /> Access
                      </button>
                    )}
                    <button
                      onClick={() => toggleActive(s)}
                      className={`btn-sm ${s.active ? 'btn-secondary' : 'btn-primary'}`}
                    >
                      {s.active
                        ? <><XCircle size={13} /> Disable</>
                        : <><CheckCircle size={13} /> Enable</>
                      }
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center">
                  <Users size={32} className="text-gray-200 mx-auto mb-2" />
                  <p className="text-gray-400 text-sm">No staff yet</p>
                  <button onClick={() => setHowToOpen(true)} className="btn-primary mt-3 btn-sm">
                    How to add staff →
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      <Modal open={howToOpen} onClose={() => setHowToOpen(false)} title="How to Add Staff">
        <HowToAdd onClose={() => setHowToOpen(false)} />
      </Modal>

      <Modal open={!!roleStaff} onClose={() => setRoleStaff(null)} title="Change Role">
        {roleStaff && <RoleEditor staff={roleStaff} onClose={() => setRoleStaff(null)} />}
      </Modal>

      <Modal open={!!accessStaff} onClose={() => setAccessStaff(null)} title="Manage Client Access">
        {accessStaff && <AccessManager staff={accessStaff} onClose={() => setAccessStaff(null)} />}
      </Modal>
    </div>
  )
}
