'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { ArrowLeftRight, Check, X, RefreshCw, ChevronRight, Search } from 'lucide-react'
import Link from 'next/link'
import PlayerHeadshot from '@/components/PlayerHeadshot'

interface RosterPlayer {
  playerId: string
  playerName: string
  mlbId: number
  positions: string[]
  mlbTeamAbbr: string | null
  seasonHR: number
  position: string
}

interface Team { id: string; name: string; abbreviation: string }

interface Trade {
  trade_id: string
  status: string
  created_at: string
  other_team_name: string
  i_get: Array<{ id: string; name: string }>
  i_give: Array<{ id: string; name: string }>
  needs_my_response: boolean
}

export default function TradesPage() {
  const [teams, setTeams] = useState<Team[]>([])
  const [myRoster, setMyRoster] = useState<RosterPlayer[]>([])
  const [theirRoster, setTheirRoster] = useState<RosterPlayer[]>([])
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [myPicks, setMyPicks] = useState<Set<string>>(new Set())
  const [theirPicks, setTheirPicks] = useState<Set<string>>(new Set())
  const [trades, setTrades] = useState<Trade[]>([])
  const [myTeamId, setMyTeamId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState<1 | 2 | 3>(1)

  useEffect(() => { fetchData() }, [])
  useEffect(() => { if (selectedTeam) { fetchTheirRoster(selectedTeam.id); setStep(2) } }, [selectedTeam])

  async function fetchData() {
    setLoading(true)
    try {
      const [rosterRes, tradesRes, teamsRes] = await Promise.all([
        fetch('/api/roster'), fetch('/api/trades'), fetch('/api/standings'),
      ])
      const [rosterData, tradesData, teamsData] = await Promise.all([
        rosterRes.json(), tradesRes.json(), teamsRes.json(),
      ])
      if (rosterData.success) {
        setMyRoster(rosterData.data.roster.map((r: any) => ({
          playerId: r.player.id, playerName: r.player.fullName, mlbId: r.player.mlbId ?? 0,
          positions: r.player.positions, mlbTeamAbbr: r.player.mlbTeamAbbr,
          seasonHR: r.player.seasonHR, position: r.position,
        })))
      }
      // Get my team ID from roster info
      const infoRes = await fetch('/api/roster/info')
      const infoData = await infoRes.json()
      if (infoData.success) setMyTeamId(infoData.data.teamId)

      if (tradesData.success) setTrades(tradesData.data)
      // Filter out my own team from trade partners
      if (teamsData.success) {
        const allTeams = teamsData.data.map((t: any) => t.team)
        setTeams(infoData.success ? allTeams.filter((t: any) => t.id !== infoData.data.teamId) : allTeams)
      }
    } catch { toast.error('Failed to load') }
    setLoading(false)
  }

  async function fetchTheirRoster(teamId: string) {
    try {
      const res = await fetch(`/api/roster?teamId=${teamId}`)
      const data = await res.json()
      if (data.success) {
        setTheirRoster(data.data.roster.map((r: any) => ({
          playerId: r.player.id, playerName: r.player.fullName, mlbId: r.player.mlbId ?? 0,
          positions: r.player.positions, mlbTeamAbbr: r.player.mlbTeamAbbr,
          seasonHR: r.player.seasonHR, position: r.position,
        })))
      }
    } catch { toast.error('Failed to load roster') }
  }

  function toggleMyPick(id: string) {
    setMyPicks(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function toggleTheirPick(id: string) {
    setTheirPicks(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  async function proposeTrade() {
    if (myPicks.size === 0 || theirPicks.size === 0 || !selectedTeam) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/trades', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerPlayerIds: [...myPicks], receivePlayerIds: [...theirPicks], targetTeamId: selectedTeam.id }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Trade offer sent!')
        resetProposal()
        fetchData()
      } else { toast.error(data.error) }
    } catch { toast.error('Failed') }
    setSubmitting(false)
  }

  async function respondToTrade(tradeId: string, action: 'accept' | 'reject') {
    try {
      const res = await fetch('/api/trades', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId, action }),
      })
      const data = await res.json()
      if (data.success) { toast.success(data.message); fetchData() }
      else { toast.error(data.error) }
    } catch { toast.error('Failed') }
  }

  function resetProposal() {
    setMyPicks(new Set()); setTheirPicks(new Set()); setSelectedTeam(null); setStep(1); setTheirRoster([])
  }

  const myPickPlayers = myRoster.filter(p => myPicks.has(p.playerId))
  const theirPickPlayers = theirRoster.filter(p => theirPicks.has(p.playerId))

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-brand" size={24} /></div>

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="font-display font-black text-3xl sm:text-4xl tracking-tight">Trades</h1>
        <p className="text-text-muted text-sm mt-1">Propose and manage trades</p>
      </div>

      {/* Pending trades requiring my action */}
      {trades.filter(t => t.status === 'PENDING' && t.needs_my_response).length > 0 && (
        <div className="card overflow-hidden border-accent-amber/30">
          <div className="px-4 py-3 border-b border-surface-border bg-accent-amber/5">
            <h2 className="font-display font-bold text-lg text-accent-amber">Incoming Offers</h2>
          </div>
          {trades.filter(t => t.status === 'PENDING' && t.needs_my_response).map(trade => (
            <div key={trade.trade_id} className="p-4 border-b border-surface-border/30">
              <div className="text-sm text-text-muted mb-3">{trade.other_team_name} offers:</div>
              <div className="flex items-start gap-3 mb-3">
                <div className="flex-1 card p-3 bg-brand/5 border-brand/20">
                  <div className="text-xs font-semibold text-brand mb-1">You get</div>
                  {trade.i_get.map(p => <div key={p.id} className="font-display font-bold text-sm">{p.name}</div>)}
                </div>
                <ArrowLeftRight size={18} className="text-text-muted flex-shrink-0 mt-3" />
                <div className="flex-1 card p-3 bg-red-500/5 border-red-500/20">
                  <div className="text-xs font-semibold text-accent-red mb-1">You give</div>
                  {trade.i_give.map(p => <div key={p.id} className="font-display font-bold text-sm">{p.name}</div>)}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => respondToTrade(trade.trade_id, 'accept')} className="btn-brand flex-1 flex items-center justify-center gap-1.5 text-sm py-2">
                  <Check size={14} /> Accept
                </button>
                <button onClick={() => respondToTrade(trade.trade_id, 'reject')} className="btn-secondary flex-1 flex items-center justify-center gap-1.5 text-sm py-2 border-red-500/20 text-accent-red hover:bg-red-500/10">
                  <X size={14} /> Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* My pending outgoing offers */}
      {trades.filter(t => t.status === 'PENDING' && !t.needs_my_response).length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-border">
            <h2 className="font-display font-bold text-lg">Your Pending Offers</h2>
          </div>
          {trades.filter(t => t.status === 'PENDING' && !t.needs_my_response).map(trade => (
            <div key={trade.trade_id} className="flex items-center gap-3 px-4 py-3 border-b border-surface-border/30">
              <div className="flex-1 text-sm">
                <span className="text-text-muted">To {trade.other_team_name}: </span>
                <span className="text-accent-red">{trade.i_give.map(p => p.name).join(', ')}</span>
                <span className="text-text-muted"> for </span>
                <span className="text-brand">{trade.i_get.map(p => p.name).join(', ')}</span>
              </div>
              <span className="text-xs text-accent-amber font-semibold mr-2">Waiting</span>
              <button
                onClick={() => respondToTrade(trade.trade_id, 'reject')}
                className="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-accent-red hover:bg-red-500/20 transition-colors"
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Trade Proposal */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
          <h2 className="font-display font-bold text-lg">Propose Trade</h2>
          {step > 1 && (
            <button onClick={resetProposal} className="text-xs text-text-muted hover:text-text-primary">Start over</button>
          )}
        </div>

        {/* Step 1: Pick team */}
        {step === 1 && (
          <div className="p-4">
            <p className="text-sm text-text-muted mb-3">Who do you want to trade with?</p>
            <div className="space-y-1">
              {teams.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTeam(t)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-surface-3/50 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-surface-3 border border-surface-border flex items-center justify-center font-display font-bold text-xs text-text-muted">
                    {t.abbreviation.slice(0, 2)}
                  </div>
                  <span className="flex-1 font-medium text-sm">{t.name}</span>
                  <ChevronRight size={14} className="text-text-muted" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Pick players from both rosters */}
        {step === 2 && selectedTeam && (
          <div>
            {/* Trade preview bar */}
            <div className="px-4 py-3 bg-surface-1/50 border-b border-surface-border">
              <div className="flex items-start gap-3">
                <div className={`flex-1 p-2 rounded-lg ${myPicks.size > 0 ? 'bg-red-500/10 border border-red-500/20' : 'bg-surface-3'}`}>
                  <div className="text-xs text-accent-red font-semibold mb-1">You send ({myPicks.size})</div>
                  {myPickPlayers.length > 0 ? myPickPlayers.map(p => (
                    <div key={p.playerId} className="text-xs font-medium text-text-primary">{p.playerName} <span className="text-text-muted">{p.seasonHR} HR</span></div>
                  )) : <div className="text-xs text-text-muted">Tap players below</div>}
                </div>
                <ArrowLeftRight size={18} className="text-text-muted flex-shrink-0 mt-3" />
                <div className={`flex-1 p-2 rounded-lg ${theirPicks.size > 0 ? 'bg-brand/10 border border-brand/20' : 'bg-surface-3'}`}>
                  <div className="text-xs text-brand font-semibold mb-1">You get ({theirPicks.size})</div>
                  {theirPickPlayers.length > 0 ? theirPickPlayers.map(p => (
                    <div key={p.playerId} className="text-xs font-medium text-text-primary">{p.playerName} <span className="text-text-muted">{p.seasonHR} HR</span></div>
                  )) : <div className="text-xs text-text-muted">Tap players below</div>}
                </div>
              </div>
              {myPicks.size > 0 && theirPicks.size > 0 && (
                <button
                  onClick={proposeTrade}
                  disabled={submitting}
                  className="btn-brand w-full mt-3 flex items-center justify-center gap-2 py-2.5"
                >
                  {submitting ? <RefreshCw size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
                  {submitting ? 'Sending...' : `Send Trade Offer (${myPicks.size} for ${theirPicks.size})`}
                </button>
              )}
            </div>

            {/* Side-by-side rosters */}
            <div className="grid grid-cols-2 divide-x divide-surface-border">
              {/* My roster */}
              <div>
                <div className="px-3 py-2 bg-surface-1/30 border-b border-surface-border">
                  <span className="text-[11px] uppercase tracking-wider text-text-muted font-semibold">Your Roster</span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {myRoster.map(p => (
                    <button
                      key={p.playerId}
                      onClick={() => toggleMyPick(p.playerId)}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 border-b border-surface-border/20 text-left transition-colors ${
                        myPicks.has(p.playerId) ? 'bg-red-500/10' : 'hover:bg-surface-3/30'
                      }`}
                    >
                      <span className="font-mono text-[10px] text-text-muted w-6">{p.position}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-text-primary truncate">{p.playerName}</div>
                        <div className="text-[10px] text-text-muted">{p.positions.join('/')}</div>
                      </div>
                      <span className={`font-display font-bold text-sm ${p.seasonHR >= 20 ? 'text-brand' : 'text-text-muted'}`}>{p.seasonHR}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Their roster */}
              <div>
                <div className="px-3 py-2 bg-surface-1/30 border-b border-surface-border">
                  <span className="text-[11px] uppercase tracking-wider text-text-muted font-semibold">{selectedTeam.abbreviation}</span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {theirRoster.map(p => (
                    <button
                      key={p.playerId}
                      onClick={() => toggleTheirPick(p.playerId)}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 border-b border-surface-border/20 text-left transition-colors ${
                        theirPicks.has(p.playerId) ? 'bg-brand/10' : 'hover:bg-surface-3/30'
                      }`}
                    >
                      <span className="font-mono text-[10px] text-text-muted w-6">{p.position}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-text-primary truncate">{p.playerName}</div>
                        <div className="text-[10px] text-text-muted">{p.positions.join('/')}</div>
                      </div>
                      <span className={`font-display font-bold text-sm ${p.seasonHR >= 20 ? 'text-brand' : 'text-text-muted'}`}>{p.seasonHR}</span>
                    </button>
                  ))}
                  {theirRoster.length === 0 && (
                    <div className="px-3 py-8 text-center">
                      <RefreshCw size={14} className="animate-spin mx-auto text-text-muted" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Trade History */}
      {trades.filter(t => t.status !== 'PENDING').length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-border">
            <h2 className="font-display font-bold text-lg">Trade History</h2>
          </div>
          <div className="divide-y divide-surface-border/50">
            {trades.filter(t => t.status !== 'PENDING').map(t => (
              <div key={t.trade_id} className="flex items-center gap-3 px-4 py-3">
                <span className={`w-14 text-center text-xs font-bold px-1.5 py-0.5 rounded ${
                  t.status === 'PROCESSED' ? 'bg-brand/10 text-brand' : 'bg-red-500/10 text-accent-red'
                }`}>
                  {t.status === 'PROCESSED' ? 'Done' : 'Rej.'}
                </span>
                <div className="flex-1 text-xs text-text-secondary">
                  <span className="text-text-muted">w/ {t.other_team_name}: </span>
                  <span className="text-brand">{t.i_get.map(p => p.name).join(', ')}</span>
                  {' ↔ '}
                  <span className="text-accent-red">{t.i_give.map(p => p.name).join(', ')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
