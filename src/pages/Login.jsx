import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useAuth } from '@/contexts/AuthContext'
import { Eye, EyeOff, Lock, Mail } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Login() {
  const { signIn } = useAuth()
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm()

  async function onSubmit({ email, password }) {
    setLoading(true)
    try {
      await signIn({ email, password })
    } catch (err) {
      toast.error(err.message || 'Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy-900 px-4 py-12">
      {/* Background pattern */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-navy-700 rounded-full opacity-30" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-gold-500 rounded-full opacity-10" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Card */}
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-navy-700 px-8 py-10 text-center">
            <img src="/icon-192.png" alt="TFHQ" className="w-20 h-20 rounded-2xl mx-auto mb-4 shadow-lg object-cover" />
            <h1 className="text-2xl font-bold text-white">TFHQ Laundry</h1>
            <p className="text-navy-300 text-sm mt-1">Processing Log System</p>
          </div>

          {/* Form */}
          <div className="px-8 py-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Sign in to continue</h2>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* Email */}
              <div>
                <label className="label">Email address</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="email"
                    placeholder="you@example.com"
                    className="input pl-9"
                    {...register('email', {
                      required: 'Email is required',
                      pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email' },
                    })}
                  />
                </div>
                {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
              </div>

              {/* Password */}
              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    placeholder="••••••••"
                    className="input pl-9 pr-10"
                    {...register('password', { required: 'Password is required' })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 text-base mt-2"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Signing in…
                  </span>
                ) : 'Sign In'}
              </button>
            </form>
          </div>
        </div>

        <p className="text-center text-navy-400 text-xs mt-6">
          Total Facility HQ · Laundry Management
        </p>
      </div>
    </div>
  )
}
