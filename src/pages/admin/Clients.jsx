import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Link } from 'react-router-dom'
import { Plus, Building2, Search, ChevronRight, ToggleLeft, ToggleRight } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'

function useClients() {
  return useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('laundry_clients')
        .select('*, laundry_buildings(id, name, active)')
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function ClientForm({ client, onClose }) {
  const qc = useQueryClient()
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: client || {},
  })

  const mutation = useMutation({
    mutationFn: async (values) => {
      if (client?.id) {
        const { error } = await supabase.from('laundry_clients').update({ ...values, updated_at: new Date().toISOString() }).eq('id', client.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('laundry_clients').insert(values)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      toast.success(client ? 'Client updated' : 'Client added')
      onClose()
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <form onSubmit={handleSubmit(v => mutation.mutate(v))} className="space-y-4">
      <div>
        <label className="label">Client / Facility Name *</label>
        <input className="input" placeholder="e.g. Fisher & Paykel Healthcare" {...register('name', { required: 'Required' })} />
        {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Contact Name</label>
          <input className="input" placeholder="Site manager" {...register('contact_name')} />
        </div>
        <div>
          <label className="label">Contact Phone</label>
          <input className="input" placeholder="+64 9 000 0000" {...register('contact_phone')} />
        </div>
      </div>
      <div>
        <label className="label">Contact Email</label>
        <input className="input" type="email" placeholder="manager@facility.com" {...register('contact_email')} />
      </div>
      <div>
        <label className="label">Address</label>
        <input className="input" placeholder="123 Example St, Auckland" {...register('address')} />
      </div>
      <div>
        <label className="label">Notes</label>
        <textarea className="input" rows={3} placeholder="Any special instructions…" {...register('notes')} />
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" disabled={mutation.isPending} className="btn-primary">
          {mutation.isPending ? 'Saving…' : client ? 'Save Changes' : 'Add Client'}
        </button>
      </div>
    </form>
  )
}

export default function AdminClients() {
  const { data: clients = [], isLoading } = useClients()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  )

  async function toggleActive(client) {
    const { error } = await supabase
      .from('laundry_clients')
      .update({ active: !client.active })
      .eq('id', client.id)
    if (error) toast.error(error.message)
    else {
      qc.invalidateQueries({ queryKey: ['clients'] })
      toast.success(`Client ${client.active ? 'deactivated' : 'activated'}`)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-0.5">{clients.length} total · {clients.filter(c => c.active).length} active</p>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true) }}
          className="btn-primary"
        >
          <Plus size={16} />
          Add Client
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="input pl-9"
          placeholder="Search clients…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-200 rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(client => {
            const buildings = client.laundry_buildings || []
            const activeBldgs = buildings.filter(b => b.active).length
            return (
              <div key={client.id} className={`card p-5 flex items-center gap-4 ${!client.active ? 'opacity-60' : ''}`}>
                <div className="w-11 h-11 bg-navy-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Building2 size={20} className="text-navy-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900 truncate">{client.name}</h3>
                    <span className={client.active ? 'badge-green' : 'badge-gray'}>
                      {client.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {activeBldgs} building{activeBldgs !== 1 ? 's' : ''}
                    {client.contact_name ? ` · ${client.contact_name}` : ''}
                    {client.contact_phone ? ` · ${client.contact_phone}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => toggleActive(client)}
                    className="btn-secondary btn-sm"
                    title={client.active ? 'Deactivate' : 'Activate'}
                  >
                    {client.active ? <ToggleRight size={16} className="text-green-600" /> : <ToggleLeft size={16} />}
                  </button>
                  <button
                    onClick={() => { setEditing(client); setModalOpen(true) }}
                    className="btn-secondary btn-sm"
                  >
                    Edit
                  </button>
                  <Link to={`/admin/clients/${client.id}`} className="btn-primary btn-sm">
                    Manage <ChevronRight size={14} />
                  </Link>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="card p-10 text-center">
              <Building2 size={32} className="text-gray-300 mx-auto mb-2" />
              <p className="text-gray-500">No clients found</p>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit — ${editing.name}` : 'Add New Client'}
      >
        <ClientForm
          client={editing}
          onClose={() => setModalOpen(false)}
        />
      </Modal>
    </div>
  )
}
