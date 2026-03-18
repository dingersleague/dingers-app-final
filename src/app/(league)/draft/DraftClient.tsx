'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { Search, Zap, Clock, Check, Trophy } from 'lucide-react'

interface DraftPick {
  pickNumber: number
  round: number
  pickInRound: number
  teamId: string
  teamName: string
  teamAbbr: string
  player: {
    id: string
    fullName: string
    positions: string[]
    mlbTeamAbbr: string | null
    seasonHR: number
  } | null
  isAutoPick: boolean
  pickedAt: string | null
}

interface AvailablePlayer {
  id: string
  mlbId: number
  fullName: string
  positions: string[]
  mlbTeamAbbr: string | null
  status: string
  seasonHR: number
}

interface DraftState {
  status: string
  currentPick: number
  currentRound: number
  currentTeamId: string | null
  currentTeamName: string | null
  timerSeconds: number
  timerEndsAt: string | null
  totalPicks: number
  myTeamId: string
  myAutoPick: boolean
  leagueStatus: string
  picks: DraftPick[]
  availablePlayers: AvailablePlayer[]
}

const POSITION_FILTERS = ['ALL', 'C', '1B', '2B', 'SS', '3B', 'OF', 'DH']

export default function DraftClient({ myTeamId }: { myTeamId: string }) {
  const [state, setState] = useState<DraftState | null>(null)
  const [search, setSearch] = useState('')
  const [posFilter, setPosFilter] = useState('ALL')
  const [countdown, setCountdown] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  const [autoPilot, setAutoPilot] = useState(false)
  const [togglingAutoPilot, setTogglingAutoPilot] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const autoPickTriggered = useRef(false)
  const autoPilotTriggered = useRef(false)
  const latestPickRef = useRef<number>(0)

  // ── Poll draft state ─────────────────────────────────────────
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/draft')
      const data = await res.json()
      if (data.success) {
        const newState = data.data as DraftState

        // Toast when a new pick comes in
        if (newState.currentPick > latestPickRef.current && latestPickRef.current > 0) {
          const lastPick = newState.picks.find(p => p.pickNumber === latestPickRef.current)
          if (lastPick?.player) {
            const isMyPick = lastPick.teamId === myTeamId
            toast(
              `${lastPick.teamAbbr} picks ${lastPick.player.fullName}${lastPick.isAutoPick ? ' (auto)' : ''}`,
              { icon: isMyPick ? '✅' : '📋' }
            )
          }
        }
        latestPickRef.current = newState.currentPick

        setState(newState)
        setAutoPilot(newState.myAutoPick)
        autoPickTriggered.current = false

        // Autopilot: if it's my turn and autopilot is on, trigger auto-pick immediately
        if (
          newState.myAutoPick &&
          newState.status === 'ACTIVE' &&
          newState.currentTeamId === myTeamId &&
          !autoPilotTriggered.current
        ) {
          autoPilotTriggered.current = true
          triggerAutoPick()
        } else if (newState.currentTeamId !== myTeamId) {
          autoPilotTriggered.current = false
        }
      }
    } catch {
      // Silently retry next poll
    }
  }, [myTeamId])

  useEffect(() => {
    fetchState()
    const interval = setInterval(fetchState, 2000)
    return () => clearInterval(interval)
  }, [fetchState])

  // ── Countdown timer ──────────────────────────────────────────
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)

    if (!state?.timerEndsAt || state.status !== 'ACTIVE') {
      setCountdown(null)
      return
    }

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((new Date(state.timerEndsAt!).getTime() - Date.now()) / 1000))
      setCountdown(remaining)

      // Trigger auto-pick when timer hits 0
      if (remaining <= 0 && !autoPickTriggered.current) {
        autoPickTriggered.current = true
        triggerAutoPick()
      }
    }

    tick()
    timerRef.current = setInterval(tick, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [state?.timerEndsAt, state?.status, state?.currentPick])

  async function toggleAutoPilot() {
    const newValue = !autoPilot
    setTogglingAutoPilot(true)
    try {
      const res = await fetch('/api/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftAutoPick: newValue }),
      })
      const data = await res.json()
      if (data.success) {
        setAutoPilot(newValue)
        toast(newValue ? 'Autopilot ON — best available will be drafted for you' : 'Autopilot OFF — you pick manually')
      }
    } catch {
      toast.error('Failed to toggle autopilot')
    }
    setTogglingAutoPilot(false)
  }

  async function triggerAutoPick() {
    try {
      await fetch('/api/draft/autopick', { method: 'POST' })
      // State will update on next poll
    } catch {
      // Will retry on next poll cycle
    }
  }

  async function makePick(playerId: string) {
    if (submitting) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      })
      const data = await res.json()
      if (data.success) {
        setSelectedPlayerId(null)
        setSearch('')
        await fetchState() // Immediate refresh
      } else {
        toast.error(data.error || 'Pick failed')
      }
    } catch {
      toast.error('Failed to submit pick')
    }
    setSubmitting(false)
  }

  if (!state) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          <span className="text-text-muted">Loading draft board...</span>
        </div>
      </div>
    )
  }

  // Draft complete
  if (state.status === 'COMPLETE') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="card p-8 text-center">
          <Trophy size={48} className="text-accent-amber mx-auto mb-4" />
          <h1 className="font-display font-black text-4xl mb-2">Draft Complete!</h1>
          <p className="text-text-muted mb-6">All {state.totalPicks} picks are in. The season is ready to begin.</p>
          <Link href="/roster" className="btn-brand inline-flex items-center gap-2 px-6 py-3">
            View Your Roster
          </Link>
        </div>
        <DraftGrid picks={state.picks} myTeamId={myTeamId} totalRounds={Math.ceil(state.totalPicks / 12)} />
      </div>
    )
  }

  const isPaused = state.status === 'PAUSED'
  const isMyTurn = !isPaused && state.currentTeamId === myTeamId
  const totalRounds = Math.ceil(state.totalPicks / 12)

  // Filter available players
  const filtered = state.availablePlayers.filter(p => {
    if (search && !p.fullName.toLowerCase().includes(search.toLowerCase())) return false
    if (posFilter !== 'ALL' && !p.positions.some(pos =>
      posFilter === 'OF' ? ['OF', 'LF', 'CF', 'RF'].includes(pos) : pos === posFilter
    )) return false
    return true
  })

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Paused Banner */}
      {isPaused && (
        <div className="card overflow-hidden border-accent-amber/40">
          <div className="p-4 bg-accent-amber/10 flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-accent-amber animate-pulse" />
            <span className="font-display font-bold text-accent-amber text-lg">Draft Paused</span>
            <span className="text-text-muted text-sm ml-2">The commissioner has paused the draft. Timer will restart when resumed.</span>
          </div>
        </div>
      )}

      {/* On The Clock Banner */}
      <div className={`card overflow-hidden ${isMyTurn ? 'border-brand/50 shadow-brand-sm' : ''}`}>
        <div className={`p-5 ${isMyTurn ? 'bg-brand/10' : 'bg-hero-gradient'}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Zap size={16} className="text-brand" />
                <span className="text-xs text-text-muted font-mono uppercase tracking-wider">
                  Round {state.currentRound} · Pick {state.currentPick} of {state.totalPicks}
                </span>
              </div>
              <div className="font-display font-black text-3xl text-text-primary">
                {isMyTurn ? (
                  <span className="text-brand">You&apos;re On The Clock!</span>
                ) : (
                  <>{state.currentTeamName}<span className="text-text-muted font-semibold text-xl ml-2">is picking...</span></>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Autopilot Toggle */}
              <button
                onClick={toggleAutoPilot}
                disabled={togglingAutoPilot}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${
                  autoPilot
                    ? 'bg-accent-amber/15 text-accent-amber border-accent-amber/30'
                    : 'bg-surface-3 text-text-muted border-surface-border hover:text-text-primary'
                }`}
              >
                <div className={`w-8 h-4 rounded-full relative transition-colors ${autoPilot ? 'bg-accent-amber' : 'bg-surface-4'}`}>
                  <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-all ${autoPilot ? 'left-4' : 'left-0.5'}`} />
                </div>
                {autoPilot ? 'Auto ON' : 'Auto OFF'}
              </button>

              {/* Timer */}
              {countdown !== null && (
                <div className={`text-center ${countdown <= 10 ? 'animate-pulse' : ''}`}>
                  <div className={`font-display font-black text-5xl leading-none ${
                    countdown <= 10 ? 'text-accent-red' : countdown <= 30 ? 'text-accent-amber' : 'text-text-primary'
                  }`}>
                    {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
                  </div>
                  <div className="text-xs text-text-muted mt-1 flex items-center gap-1 justify-center">
                    <Clock size={10} /> Time remaining
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Available Players (2/3 width) */}
        <div className="lg:col-span-2 card overflow-hidden flex flex-col" style={{ maxHeight: '70vh' }}>
          <div className="px-4 py-3 border-b border-surface-border bg-surface-1/50 space-y-3">
            <div className="flex items-center gap-2">
              <Search size={14} className="text-text-muted" />
              <input
                type="text"
                placeholder="Search players..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="input flex-1"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {POSITION_FILTERS.map(pos => (
                <button
                  key={pos}
                  onClick={() => setPosFilter(pos)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    posFilter === pos
                      ? 'bg-brand/20 text-brand border border-brand/30'
                      : 'bg-surface-3 text-text-muted hover:text-text-primary border border-transparent'
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>

          {/* Player header */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-border/30 bg-surface-1/30">
            <span className="w-8 table-header text-center">#</span>
            <span className="flex-1 table-header">PLAYER</span>
            <span className="w-12 table-header text-center">POS</span>
            <span className="w-14 table-header text-right">HR</span>
            <span className="w-20" />
          </div>

          {/* Player list */}
          <div className="overflow-y-auto flex-1">
            {filtered.slice(0, 100).map((player, i) => {
              const isSelected = selectedPlayerId === player.id
              return (
                <div
                  key={player.id}
                  className={`flex items-center gap-3 px-4 py-2.5 border-b border-surface-border/20 transition-colors ${
                    isSelected ? 'bg-brand/10' : 'hover:bg-surface-1/50'
                  }`}
                >
                  <span className="w-8 text-center font-mono text-xs text-text-muted">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">{player.fullName}</div>
                    <div className="text-xs text-text-muted">{player.mlbTeamAbbr ?? 'FA'}</div>
                  </div>
                  <span className="w-12 text-center text-xs text-text-muted font-mono">{player.positions.join('/')}</span>
                  <span className={`w-14 text-right font-display font-bold text-lg ${
                    player.seasonHR > 0 ? 'text-brand' : 'text-text-muted'
                  }`}>
                    {player.seasonHR}
                  </span>
                  <div className="w-20">
                    {isMyTurn && !submitting && (
                      isSelected ? (
                        <button
                          onClick={() => makePick(player.id)}
                          className="btn-brand text-xs px-3 py-1.5 w-full"
                        >
                          Confirm
                        </button>
                      ) : (
                        <button
                          onClick={() => setSelectedPlayerId(player.id)}
                          className="btn-secondary text-xs px-3 py-1.5 w-full"
                        >
                          Draft
                        </button>
                      )
                    )}
                    {isMyTurn && submitting && isSelected && (
                      <div className="flex items-center justify-center">
                        <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            {filtered.length === 0 && (
              <div className="px-4 py-8 text-center text-text-muted text-sm">No players match your search</div>
            )}
          </div>
        </div>

        {/* Draft Log (1/3 width) */}
        <div className="card overflow-hidden flex flex-col" style={{ maxHeight: '70vh' }}>
          <div className="px-4 py-3 border-b border-surface-border bg-surface-1/50">
            <div className="font-display font-bold text-sm">Recent Picks</div>
          </div>
          <div className="overflow-y-auto flex-1">
            {state.picks
              .filter(p => p.player)
              .sort((a, b) => b.pickNumber - a.pickNumber)
              .slice(0, 50)
              .map(pick => (
                <div
                  key={pick.pickNumber}
                  className={`flex items-start gap-3 px-4 py-2.5 border-b border-surface-border/20 ${
                    pick.teamId === myTeamId ? 'bg-brand/5' : ''
                  }`}
                >
                  <span className="font-mono text-xs text-text-muted w-8 pt-0.5 text-center">
                    {pick.round}.{pick.pickInRound}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">
                      {pick.player!.fullName}
                      {pick.isAutoPick && <span className="text-xs text-text-muted ml-1">(auto)</span>}
                    </div>
                    <div className="text-xs text-text-muted">
                      {pick.teamAbbr} · {pick.player!.positions.join('/')} · {pick.player!.mlbTeamAbbr ?? 'FA'}
                    </div>
                  </div>
                  <span className={`font-display font-bold text-sm ${
                    pick.player!.seasonHR > 0 ? 'text-brand' : 'text-text-muted'
                  }`}>
                    {pick.player!.seasonHR} HR
                  </span>
                </div>
              ))}
            {state.picks.filter(p => p.player).length === 0 && (
              <div className="px-4 py-8 text-center text-text-muted text-sm">
                No picks yet — draft is starting!
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Full Draft Grid */}
      <DraftGrid picks={state.picks} myTeamId={myTeamId} totalRounds={totalRounds} />
    </div>
  )
}

// ── Draft Grid Component ───────────────────────────────────────
function DraftGrid({ picks, myTeamId, totalRounds }: { picks: DraftPick[]; myTeamId: string; totalRounds: number }) {
  // Get unique teams in draft order (from round 1)
  const teams = picks
    .filter(p => p.round === 1)
    .sort((a, b) => a.pickInRound - b.pickInRound)
    .map(p => ({ id: p.teamId, name: p.teamName, abbr: p.teamAbbr }))

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-surface-border bg-surface-1/50">
        <div className="font-display font-bold text-sm">Draft Board</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-surface-border">
              <th className="px-2 py-2 text-left text-text-muted font-mono w-10">RD</th>
              {teams.map(t => (
                <th
                  key={t.id}
                  className={`px-2 py-2 text-center font-semibold min-w-[80px] ${
                    t.id === myTeamId ? 'text-brand bg-brand/5' : 'text-text-secondary'
                  }`}
                >
                  {t.abbr}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: totalRounds }, (_, round) => {
              const roundPicks = picks.filter(p => p.round === round + 1)
              // Snake: even rounds are reversed
              const orderedPicks = (round + 1) % 2 === 0
                ? [...roundPicks].sort((a, b) => b.pickInRound - a.pickInRound)
                : [...roundPicks].sort((a, b) => a.pickInRound - b.pickInRound)

              return (
                <tr key={round} className="border-b border-surface-border/30">
                  <td className="px-2 py-1.5 font-mono text-text-muted">{round + 1}</td>
                  {teams.map(t => {
                    const pick = orderedPicks.find(p => p.teamId === t.id)
                    const isMyTeam = t.id === myTeamId
                    return (
                      <td
                        key={t.id}
                        className={`px-1.5 py-1.5 text-center ${isMyTeam ? 'bg-brand/5' : ''}`}
                      >
                        {pick?.player ? (
                          <div className={`rounded-md px-1.5 py-1 ${pick.isAutoPick ? 'bg-surface-3/80' : 'bg-surface-1'}`}>
                            <div className="font-medium text-text-primary truncate text-[11px] leading-tight">
                              {pick.player.fullName.split(' ').pop()}
                            </div>
                            <div className="text-text-muted text-[10px]">
                              {pick.player.positions.join('/')} · {pick.player.seasonHR} HR
                            </div>
                          </div>
                        ) : (
                          <div className="text-text-muted/30">—</div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
