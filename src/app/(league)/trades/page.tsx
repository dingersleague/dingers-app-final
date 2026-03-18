'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { ArrowLeftRight, Check, X, RefreshCw, ChevronDown } from 'lucide-react'
import Link from 'next/link'

interface RosterPlayer {
  playerId: string
  playerName: string
  positions: string[]
  mlbTeamAbbr: string | null
  seasonHR: number
  position: string
}

interface Team {
  id: string
  name: string
  abbreviation: string
}

interface Trade {
  trade_id: string
  offer_team_name: string
  receive_team_name: string
  offer_player_name: string
  receive_player_name: string
  status: string
  created_at: string
}

export default function TradesPage() {
  const [teams, setTeams] = useState<Team[]>([])
  const [myRoster, setMyRoster] = useState<RosterPlayer[]>([])
  const [theirRoster, setTheirRoster] = useState<RosterPlayer[]>([])
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [myPick, setMyPick] = useState<string | null>(null)
  const [theirPick, setTheirPick] = useState<string | null>(null)
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (selectedTeam) fetchTheirRoster(selectedTeam.id)
  }, [selectedTeam])

  async function fetchData() {
    setLoading(true)
    try {
      const [rosterRes, tradesRes, teamsRes] = await Promise.all([
        fetch('/api/roster'),
        fetch('/api/trades'),
        fetch('/api/standings'),
      ])
      const [rosterData, tradesData, teamsData] = await Promise.all([
        rosterRes.json(), tradesRes.json(), teamsRes.json(),
      ])

      if (rosterData.success) {
        setMyRoster(rosterData.data.roster.map((r: any) => ({
          playerId: r.player.id,
          playerName: r.player.fullName,
          positions: r.player.positions,
          mlbTeamAbbr: r.player.mlbTeamAbbr,
          seasonHR: r.player.seasonHR,
          position: r.position,
        })))
      }
      if (tradesData.success) setTrades(tradesData.data)
      if (teamsData.success) setTeams(teamsData.data.map((t: any) => t.team))
    } catch { toast.error('Failed to load') }
    setLoading(false)
  }

  async function fetchTheirRoster(teamId: string) {
    try {
      const res = await fetch(`/api/roster?teamId=${teamId}`)
      const data = await res.json()
      if (data.success) {
        setTheirRoster(data.data.roster.map((r: any) => ({
          playerId: r.player.id,
          playerName: r.player.fullName,
          positions: r.player.positions,
          mlbTeamAbbr: r.player.mlbTeamAbbr,
          seasonHR: r.player.seasonHR,
          position: r.position,
        })))
      }
    } catch { toast.error('Failed to load their roster') }
  }

  async function proposeTrade() {
    if (!myPick || !theirPick || !selectedTeam) {
      toast.error('Select a player from each roster')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerPlayerId: myPick,
          receivePlayerId: theirPick,
          targetTeamId: selectedTeam.id,
        }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message)
        setMyPick(null)
        setTheirPick(null)
        fetchData()
      } else {
        toast.error(data.error)
      }
    } catch { toast.error('Proposal failed') }
    setSubmitting(false)
  }

  async function respondToTrade(tradeId: string, action: 'accept' | 'reject') {
    try {
      const res = await fetch('/api/trades', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId, action }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message)
        fetchData()
      } else {
        toast.error(data.error)
      }
    } catch { toast.error('Failed') }
  }

  const PlayerList = ({ players, selected, onSelect, label }: {
    players: RosterPlayer[]
    selected: string | null
    onSelect: (id: string) => void
    label: string
  }) => (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-surface-border bg-surface-1/50">
        <div className="font-display font-bold text-lg">{label}</div>
      </div>
      <div className="divide-y divide-surface-border/50 max-h-80 overflow-y-auto">
        {players.map(p => (
          <div
            key={p.playerId}
            onClick={() => onSelect(p.playerId)}
            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
              selected === p.playerId ? 'bg-brand/10 border-l-2 border-brand' : 'hover:bg-surface-3/50'
            }`}
          >
            <span className="badge-secondary font-mono text-xs w-10 text-center">{p.position}</span>
            <div className="flex-1 min-w-0">
              <Link href={`/players/${p.playerId}`} className="text-sm font-medium truncate hover:underline block">{p.playerName}</Link>
              <div className="text-xs text-text-muted">{p.positions.join('/')} · {p.mlbTeamAbbr ?? 'FA'}</div>
            </div>
            <span className={`font-display font-black text-lg ${p.seasonHR > 20 ? 'text-brand' : 'text-text-primary'}`}>
              {p.seasonHR}
            </span>
          </div>
        ))}
        {players.length === 0 && (
          <div className="px-4 py-8 text-center text-text-muted text-sm">No players</div>
        )}
      </div>
    </div>
  )

  if (loading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-brand" size={24} /></div>
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="font-display font-black text-4xl tracking-tight">Trades</h1>
        <p className="text-text-muted text-sm mt-1">Propose and respond to player trades</p>
      </div>

      {/* Pending trades requiring my action */}
      {trades.filter(t => t.status === 'PENDING' && t.receive_team_name).length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-border bg-accent-amber/5">
            <h2 className="font-display font-bold text-lg text-accent-amber">Pending Trades</h2>
          </div>
          <div className="divide-y divide-surface-border/50">
            {trades.filter(t => t.status === 'PENDING').map(trade => (
              <div key={trade.trade_id} className="flex items-center gap-4 px-5 py-4">
                <div className="flex-1">
                  <div className="text-sm font-medium">
                    <span className="text-text-secondary">{trade.offer_team_name}</span>
                    {' offers '}
                    <span className="text-brand">{trade.offer_player_name}</span>
                    {' for '}
                    <span className="text-accent-red">{trade.receive_player_name}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => respondToTrade(trade.trade_id, 'accept')}
                    className="btn-brand flex items-center gap-1 text-xs py-1.5"
                  >
                    <Check size={12} /> Accept
                  </button>
                  <button
                    onClick={() => respondToTrade(trade.trade_id, 'reject')}
                    className="btn-danger flex items-center gap-1 text-xs py-1.5"
                  >
                    <X size={12} /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Propose a trade */}
      <div className="card p-5">
        <h2 className="font-display font-bold text-xl mb-4">Propose Trade</h2>

        <div className="mb-4">
          <label className="text-xs text-text-muted block mb-1.5">Trade with</label>
          <select
            value={selectedTeam?.id ?? ''}
            onChange={e => {
              const t = teams.find(t => t.id === e.target.value)
              setSelectedTeam(t ?? null)
              setTheirPick(null)
            }}
            className="input max-w-xs"
          >
            <option value="">Select team...</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <PlayerList
            players={myRoster}
            selected={myPick}
            onSelect={setMyPick}
            label="You give up"
          />
          <PlayerList
            players={theirRoster}
            selected={theirPick}
            onSelect={setTheirPick}
            label={selectedTeam ? `${selectedTeam.name} gives` : 'Select a team first'}
          />
        </div>

        {/* Trade summary */}
        {myPick && theirPick && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-3 border border-surface-border mb-4">
            <span className="text-sm text-accent-red font-medium">
              {myRoster.find(p => p.playerId === myPick)?.playerName}
            </span>
            <ArrowLeftRight size={16} className="text-text-muted flex-shrink-0" />
            <span className="text-sm text-brand font-medium">
              {theirRoster.find(p => p.playerId === theirPick)?.playerName}
            </span>
          </div>
        )}

        <button
          onClick={proposeTrade}
          disabled={!myPick || !theirPick || !selectedTeam || submitting}
          className="btn-brand disabled:opacity-50"
        >
          {submitting ? 'Sending...' : 'Send Trade Offer'}
        </button>
      </div>
    </div>
  )
}
