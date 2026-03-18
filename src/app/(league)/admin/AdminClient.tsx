'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RefreshCw, Play, Calendar, Users, Settings, CheckCircle, XCircle } from 'lucide-react'
import { format } from 'date-fns'

interface AdminClientProps {
  league: any
  syncLogs: any[]
}

function ChevronRight({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

export default function AdminClient({ league, syncLogs }: AdminClientProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [seasonStartDate, setSeasonStartDate] = useState('2025-04-01')
  const [timerSeconds, setTimerSeconds] = useState(90)

  // FAAB settings state — initialised from league prop
  const [waiverType, setWaiverType] = useState<string>(league?.waiverType ?? 'PRIORITY')
  const [faabBudget, setFaabBudget] = useState<number>(league?.faabBudget ?? 100)
  const [faabAllowZeroBid, setFaabAllowZeroBid] = useState<boolean>(league?.faabAllowZeroBid ?? false)

  async function patchLeague(fields: Record<string, any>) {
    setLoading('patch')
    try {
      const res = await fetch('/api/admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Settings saved')
      } else {
        toast.error(data.error || 'Save failed')
      }
    } catch {
      toast.error('Request failed')
    }
    setLoading(null)
  }

  async function callAdmin(action: string, extra: Record<string, any> = {}) {
    setLoading(action)
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message || 'Success')
        router.refresh() // Re-fetch server data so buttons update
        if (action === 'start_draft') {
          router.push('/draft')
        }
      } else {
        toast.error(data.error || 'Action failed')
      }
    } catch {
      toast.error('Request failed')
    }
    setLoading(null)
  }

  async function triggerSync() {
    setLoading('sync')
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        toast.success(`Synced ${data.data.synced} records in ${data.data.duration}ms`)
      } else {
        toast.error(data.error)
      }
    } catch {
      toast.error('Sync failed')
    }
    setLoading(null)
  }

  const STATUS_FLOW = ['SETUP', 'PREDRAFT', 'DRAFT', 'REGULAR_SEASON', 'PLAYOFFS', 'OFFSEASON']
  const currentStatusIndex = STATUS_FLOW.indexOf(league?.status ?? 'SETUP')

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="font-display font-black text-4xl tracking-tight">Admin Panel</h1>
        <p className="text-text-muted text-sm mt-1">Commissioner controls for {league?.name}</p>
      </div>

      {/* League Status Flow */}
      <div className="card p-5">
        <h2 className="font-display font-bold text-xl mb-4">League Status</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_FLOW.map((status, i) => (
            <div key={status} className="flex items-center gap-2">
              <div className={`px-3 py-1.5 rounded-lg text-sm font-semibold font-mono ${
                i < currentStatusIndex ? 'bg-brand/10 text-brand/60' :
                i === currentStatusIndex ? 'bg-brand/20 text-brand border border-brand/40' :
                'bg-surface-3 text-text-muted'
              }`}>
                {status}
              </div>
              {i < STATUS_FLOW.length - 1 && <ChevronRight size={14} className="text-text-muted" />}
            </div>
          ))}
        </div>
      </div>

      {/* Teams */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-border flex items-center gap-2">
          <Users size={16} className="text-accent-blue" />
          <h2 className="font-display font-bold text-xl">Teams ({league?.teams?.length ?? 0}/12)</h2>
        </div>
        <div className="divide-y divide-surface-border/50">
          {(league?.teams ?? []).map((team: any, i: number) => (
            <div key={team.id} className="flex items-center gap-4 px-5 py-3">
              <span className="font-mono text-sm text-text-muted w-6">{i + 1}</span>
              <div className="flex-1">
                <div className="font-medium text-sm">{team.name}</div>
                <div className="text-xs text-text-muted">{team.user.email}</div>
              </div>
              <div className="badge-secondary">{team.abbreviation}</div>
            </div>
          ))}
          {(league?.teams?.length ?? 0) < 12 && (
            <div className="px-5 py-4 text-sm text-text-muted italic">
              {12 - (league?.teams?.length ?? 0)} open slot(s) — share your registration link
            </div>
          )}
        </div>
      </div>

      {/* Action Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Schedule */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Calendar size={16} className="text-accent-amber" />
            <h3 className="font-display font-bold text-lg">Schedule</h3>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-text-muted block mb-1">Season Start Date (must be Tuesday)</label>
              <input
                type="date"
                value={seasonStartDate}
                onChange={e => setSeasonStartDate(e.target.value)}
                className="input"
              />
            </div>
            <button
              onClick={() => callAdmin('generate_schedule', { seasonStartDate })}
              disabled={!!loading}
              className="btn-secondary w-full flex items-center justify-center gap-2"
            >
              {loading === 'generate_schedule'
                ? <RefreshCw size={14} className="animate-spin" />
                : <Calendar size={14} />}
              Generate 25-Week Schedule
            </button>
          </div>
        </div>

        {/* Draft */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Play size={16} className="text-brand" />
            <h3 className="font-display font-bold text-lg">Draft</h3>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-text-muted block mb-1">Pick Timer (seconds)</label>
              <input
                type="number"
                value={timerSeconds}
                onChange={e => setTimerSeconds(Number(e.target.value))}
                min={30}
                max={300}
                className="input"
              />
            </div>
            <button
              onClick={() => {
                const draftOrder = (league?.teams ?? []).map((t: any) => t.id)
                callAdmin('setup_draft', { draftOrder, timerSeconds })
              }}
              disabled={!!loading || (league?.teams?.length ?? 0) < 2}
              className="btn-secondary w-full flex items-center justify-center gap-2"
            >
              {loading === 'setup_draft'
                ? <RefreshCw size={14} className="animate-spin" />
                : <Settings size={14} />}
              Configure Snake Draft
            </button>
            <button
              onClick={() => callAdmin('start_draft')}
              disabled={!!loading || !league?.draftSettings}
              className="btn-brand w-full flex items-center justify-center gap-2"
            >
              {loading === 'start_draft'
                ? <RefreshCw size={14} className="animate-spin" />
                : <Play size={14} />}
              Start Draft
            </button>
          </div>
        </div>

        {/* Season */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Play size={16} className="text-accent-purple" />
            <h3 className="font-display font-bold text-lg">Season</h3>
          </div>
          <div className="space-y-3">
            <button
              onClick={() => callAdmin('start_season')}
              disabled={!!loading}
              className="btn-brand w-full flex items-center justify-center gap-2"
            >
              {loading === 'start_season'
                ? <RefreshCw size={14} className="animate-spin" />
                : <Play size={14} />}
              Start Regular Season
            </button>
            <button
              onClick={() => callAdmin('finalize_week', { weekNumber: league?.currentWeek })}
              disabled={!!loading}
              className="btn-secondary w-full flex items-center justify-center gap-2"
            >
              {loading === 'finalize_week'
                ? <RefreshCw size={14} className="animate-spin" />
                : <CheckCircle size={14} />}
              Finalize Week {league?.currentWeek}
            </button>
          </div>
        </div>

        {/* FAAB / Waiver Settings */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Settings size={16} className="text-accent-purple" />
            <h3 className="font-display font-bold text-lg">Waiver Settings</h3>
          </div>

          {/* Waiver type toggle */}
          <div className="mb-4">
            <label className="text-xs text-text-muted uppercase tracking-wider block mb-2">
              Waiver Mode
            </label>
            <div className="flex gap-2">
              {(['PRIORITY', 'FAAB'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setWaiverType(mode)}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                    waiverType === mode
                      ? 'bg-brand/15 text-brand border-brand/30'
                      : 'bg-surface-3 text-text-muted border-surface-border hover:text-text-primary'
                  }`}
                >
                  {mode === 'FAAB' ? 'FAAB (Blind Bid)' : 'Priority Order'}
                </button>
              ))}
            </div>
          </div>

          {/* FAAB-specific settings */}
          {waiverType === 'FAAB' && (
            <div className="space-y-3 mb-4 p-3 rounded-xl bg-surface-3 border border-surface-border">
              <div>
                <label className="text-xs text-text-muted uppercase tracking-wider block mb-1.5">
                  Starting Budget ($)
                </label>
                <input
                  type="number"
                  min={1}
                  max={9999}
                  value={faabBudget}
                  onChange={e => setFaabBudget(parseInt(e.target.value, 10) || 100)}
                  className="input"
                />
                <p className="text-xs text-text-muted mt-1">
                  Applied when you reset budgets. Current balances are per-team.
                </p>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={faabAllowZeroBid}
                  onChange={e => setFaabAllowZeroBid(e.target.checked)}
                  className="w-4 h-4 rounded accent-brand"
                />
                <span className="text-sm text-text-primary">Allow $0 bids</span>
              </label>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => patchLeague({ waiverType, faabBudget, faabAllowZeroBid })}
              disabled={!!loading}
              className="btn-brand flex-1 flex items-center justify-center gap-2"
            >
              {loading === 'patch'
                ? <RefreshCw size={14} className="animate-spin" />
                : <Settings size={14} />}
              Save Settings
            </button>
            {waiverType === 'FAAB' && (
              <button
                onClick={() => callAdmin('reset_faab')}
                disabled={!!loading}
                title="Reset all team FAAB balances to the starting budget"
                className="btn-secondary flex items-center justify-center gap-2 px-4"
              >
                {loading === 'reset_faab'
                  ? <RefreshCw size={14} className="animate-spin" />
                  : <RefreshCw size={14} />}
                Reset FAAB
              </button>
            )}
          </div>
        </div>

        {/* Stat Sync */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <RefreshCw size={16} className="text-accent-blue" />
            <h3 className="font-display font-bold text-lg">Stat Sync</h3>
          </div>
          <button
            onClick={triggerSync}
            disabled={!!loading}
            className="btn-brand w-full flex items-center justify-center gap-2 mb-4"
          >
            {loading === 'sync'
              ? <RefreshCw size={14} className="animate-spin" />
              : <RefreshCw size={14} />}
            Sync MLB Stats Now
          </button>
          <div className="space-y-2">
            <div className="text-xs text-text-muted uppercase tracking-wider mb-2">Recent Syncs</div>
            {syncLogs.slice(0, 5).map((log: any) => (
              <div key={log.id} className="flex items-center gap-2 text-xs">
                {log.status === 'success'
                  ? <CheckCircle size={12} className="text-brand flex-shrink-0" />
                  : <XCircle size={12} className="text-accent-red flex-shrink-0" />}
                <span className="text-text-muted font-mono">
                  {format(new Date(log.createdAt), 'MMM d HH:mm')}
                </span>
                <span className="text-text-secondary">
                  {log.type} · {log.duration}ms
                </span>
              </div>
            ))}
            {syncLogs.length === 0 && (
              <div className="text-text-muted text-xs">No syncs yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
