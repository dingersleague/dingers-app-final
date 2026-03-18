'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()

      if (data.success) {
        router.push('/dashboard')
        router.refresh()
      } else {
        toast.error(data.error || 'Login failed')
      }
    } catch {
      toast.error('Something went wrong')
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-surface-0 grid-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand mb-4 glow-brand">
            <span className="font-display font-black text-2xl text-surface-0">HR</span>
          </div>
          <h1 className="font-display font-black text-4xl tracking-tight">DINGERS</h1>
          <p className="text-text-muted text-sm mt-1">Fantasy HR League</p>
        </div>

        <div className="card p-6">
          <h2 className="font-display font-bold text-2xl mb-5">Sign In</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-text-muted block mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input"
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="text-xs text-text-muted block mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-brand w-full py-2.5 text-base mt-2 disabled:opacity-60"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p className="text-center text-sm text-text-muted mt-5">
            New owner?{' '}
            <Link href="/register" className="text-brand hover:underline">Create account</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
