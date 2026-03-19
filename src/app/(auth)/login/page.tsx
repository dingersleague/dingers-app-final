'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface TeamOption {
  email: string
  name: string
  teamName: string
  abbreviation: string
  role: string
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [loggingInAs, setLoggingInAs] = useState<string | null>(null)
  const [teams, setTeams] = useState<TeamOption[]>([])

  useEffect(() => {
    fetch('/api/auth/teams')
      .then(r => r.json())
      .then(d => { if (d.success) setTeams(d.data) })
      .catch(() => {})
  }, [])

  async function login(loginEmail: string, loginPassword: string) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail, password: loginPassword }),
    })
    const data = await res.json()
    if (data.success) {
      router.push('/dashboard')
      router.refresh()
    } else {
      toast.error(data.error || 'Login failed')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password)
    } catch {
      toast.error('Something went wrong')
    }
    setLoading(false)
  }

  async function quickLogin(teamEmail: string) {
    setLoggingInAs(teamEmail)
    try {
      await login(teamEmail, 'password123')
    } catch {
      toast.error('Quick login failed')
    }
    setLoggingInAs(null)
  }

  return (
    <div className="min-h-screen bg-surface-0 grid-bg flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand mb-4 glow-brand">
            <span className="font-display font-black text-2xl text-surface-0">HR</span>
          </div>
          <h1 className="font-display font-black text-4xl tracking-tight">DINGERS</h1>
          <p className="text-text-muted text-sm mt-1">Fantasy HR League</p>
        </div>

        {/* Quick Login — pick your team */}
        {teams.length > 0 && (
          <div className="card p-5 mb-4">
            <h2 className="font-display font-bold text-lg mb-3">Pick Your Team</h2>
            <div className="grid grid-cols-2 gap-2">
              {teams.map(t => (
                <button
                  key={t.email}
                  onClick={() => quickLogin(t.email)}
                  disabled={!!loggingInAs}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all text-left ${
                    loggingInAs === t.email
                      ? 'bg-brand/10 border-brand/40 text-brand'
                      : 'bg-surface-2 border-surface-border hover:border-brand/40 hover:bg-brand/5'
                  } disabled:opacity-50`}
                >
                  <div className="w-8 h-8 rounded-lg bg-brand/20 border border-brand/30 flex items-center justify-center flex-shrink-0">
                    <span className="font-display font-black text-[9px] text-brand">{t.abbreviation}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-text-primary truncate">{t.teamName}</div>
                    <div className="text-[10px] text-text-muted truncate">{t.name}</div>
                  </div>
                  {loggingInAs === t.email && (
                    <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Manual login */}
        <div className="card p-5">
          <h2 className="font-display font-bold text-lg mb-4">Or Sign In Manually</h2>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-xs text-text-muted block mb-1">Email</label>
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
              <label className="text-xs text-text-muted block mb-1">Password</label>
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
              className="btn-brand w-full py-2.5 text-sm mt-2 disabled:opacity-60"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p className="text-center text-sm text-text-muted mt-4">
            New owner?{' '}
            <Link href="/register" className="text-brand hover:underline">Create account</Link>
          </p>
        </div>

        {/* Public browse link */}
        <div className="text-center mt-4">
          <Link href="/standings" className="text-sm text-text-muted hover:text-brand transition-colors">
            Browse league without signing in →
          </Link>
        </div>
      </div>
    </div>
  )
}
