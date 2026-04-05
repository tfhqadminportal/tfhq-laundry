import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import Sidebar from './Sidebar'

export default function AppLayout() {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="relative w-72 h-full">
            <Sidebar onClose={() => setOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-navy-800 border-b border-navy-700">
          <button
            onClick={() => setOpen(true)}
            className="text-white hover:text-gold-400 transition-colors"
          >
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2">
            <img src="/icon-192.png" alt="TFHQ" className="w-7 h-7 rounded-lg object-cover" />
            <span className="text-white font-semibold text-sm">TFHQ Laundry</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
