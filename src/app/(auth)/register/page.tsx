'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export default function RegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    name: '', email: '', password: '', teamName: '', teamAbbr: '',
  })
  const [loading, setLoading] = useState(false)

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.teamAbbr.length > 5) {
      toast.error('Team abbreviation must be 5 characters or fewer')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Account created!')
        router.push('/dashboard')
        router.refresh()
      } else {
        toast.error(data.error || 'Registration failed')
      }
    } catch {
      toast.error('Something went wrong')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-surface-0 grid-bg flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand mb-4 glow-brand">
            <span className="font-display font-black text-2xl text-surface-0">HR</span>
          </div>
          <h1 className="font-display font-black text-4xl tracking-tight">DINGERS</h1>
          <p className="text-text-muted text-sm mt-1">Join the league</p>
        </div>

        <div className="card p-6">
          <h2 className="font-display font-bold text-2xl mb-5">Create Account</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-text-muted block mb-1.5">Your Name</label>
              <input
                value={form.name}
                onChange={e => update('name', e.target.value)}
                className="input"
                placeholder="John Smith"
                required
                minLength={2}
              />
            </div>
            <div>
              <label className="text-xs text-text-muted block mb-1.5">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => update('email', e.target.value)}
                className="input"
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <label className="text-xs text-text-muted block mb-1.5">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={e => update('password', e.target.value)}
                className="input"
                placeholder="Min 8 characters"
                required
                minLength={8}
              />
            </div>

            <div className="pt-2 border-t border-surface-border">
              <p className="text-xs text-text-muted mb-3">Team Info</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-text-muted block mb-1.5">Team Name</label>
                  <input
                    value={form.teamName}
                    onChange={e => update('teamName', e.target.value)}
                    className="input"
                    placeholder="The Bomb Squad"
                    required
                    minLength={2}
                    maxLength={50}
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted block mb-1.5">Team Abbreviation (2–5 letters)</label>
                  <input
                    value={form.teamAbbr}
                    onChange={e => update('teamAbbr', e.target.value.toUpperCase())}
                    className="input font-mono"
                    placeholder="BOMB"
                    required
                    minLength={2}
                    maxLength={5}
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-brand w-full py-2.5 text-base disabled:opacity-60"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-sm text-text-muted mt-5">
            Already have an account?{' '}
            <Link href="/login" className="text-brand hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
