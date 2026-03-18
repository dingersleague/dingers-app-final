'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, Plus, Minus, AlertCircle, RefreshCw, Clock } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useDebounce } from '@/lib/hooks'
import WaiverClaimModal from '@/components/players/WaiverClaimModal'

interface Player {
  id: string
  mlbId: number
  fullName: string
  positions: string[]
  mlbTeamAbbr: string | null
  status: string
  seasonHR: number
  isOnRoster: boolean
  isOnWaivers: boolean
  ownedByTeamId: string | null
  ownedByTeamName: string | null
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'ACT',
  INJURED_10_DAY: 'IL-10',
  INJURED_60_DAY: 'IL-60',
  SUSPENDED: 'SUSP',
  MINORS: 'MiLB',
  INACTIVE: 'OUT',
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'text-brand',
  INJURED_10_DAY: 'text-accent-red',
  INJURED_60_DAY: 'text-accent-red',
  SUSPENDED: 'text-accent-amber',
  MINORS: 'text-accent-purple',
  INACTIVE: 'text-text-muted',
}

export default function PlayerSearchPage() {
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState('ALL')
  const [availability, setAvailability] = useState('ALL')
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(false)
  const [myRoster, setMyRoster] = useState<string[]>([])
  const [rosterFull, setRosterFull] = useState(false)
  const [actionPending, setActionPending] = useState<string | null>(null)
  const [showDropModal, setShowDropModal] = useState<Player | null>(null)
  const [waiverClaimPlayer, setWaiverClaimPlayer] = useState<Player | null>(null)
  const [rosterDetail, setRosterDetail] = useState<Array<{playerId: string; playerName: string; position: string}>>([])

  const debouncedQuery = useDebounce(query, 300)

  useEffect(() => {
    searchPlayers()
  }, [debouncedQuery, position, availability])

  useEffect(() => {
    fetchMyRosterInfo()
    fetchRosterDetail()
  }, [])

  async function fetchMyRosterInfo() {
    const res = await fetch('/api/roster/info')
    if (res.ok) {
      const data = await res.json()
      setMyRoster(data.data.playerIds)
      setRosterFull(data.data.isFull)
    }
  }

  async function fetchRosterDetail() {
    const res = await fetch('/api/roster')
    if (res.ok) {
      const data = await res.json()
      if (data.success) {
        setRosterDetail(
          (data.data ?? []).map((slot: any) => ({
            playerId: slot.playerId,
            playerName: slot.player?.fullName ?? 'Unknown',
            position: slot.position ?? slot.slotType ?? 'BN',
          }))
        )
      }
    }
  }

  async function searchPlayers() {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        q: debouncedQuery,
        position,
        availability,
        limit: '50',
      })
      const res = await fetch(`/api/players/search?${params}`)
      const data = await res.json()
      if (data.success) setPlayers(data.data)
    } catch {
      toast.error('Search failed')
    }
    setLoading(false)
  }

  async function handleAdd(player: Player) {
    if (rosterFull) {
      setShowDropModal(player)
      return
    }

    setActionPending(player.id)
    try {
      const res = await fetch('/api/transactions/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: player.id }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Added ${player.fullName}`)
        setMyRoster(prev => [...prev, player.id])
        searchPlayers()
        fetchMyRosterInfo()
      } else {
        toast.error(data.error || 'Could not add player')
      }
    } catch {
      toast.error('Request failed')
    }
    setActionPending(null)
  }

  async function handleDrop(player: Player) {
    setActionPending(player.id)
    try {
      const res = await fetch('/api/transactions/drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: player.id }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Dropped ${player.fullName}`)
        setMyRoster(prev => prev.filter(id => id !== player.id))
        searchPlayers()
        fetchMyRosterInfo()
      } else {
        toast.error(data.error || 'Could not drop player')
      }
    } catch {
      toast.error('Request failed')
    }
    setActionPending(null)
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="font-display font-black text-4xl tracking-tight">Players</h1>
        <p className="text-text-muted text-sm mt-1">Search, add, and drop players from the MLB player pool</p>
      </div>

      {/* Search and filters */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              className="input pl-9"
              placeholder="Search players by name..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>

          <select
            value={position}
            onChange={e => setPosition(e.target.value)}
            className="input sm:w-32"
          >
            <option value="ALL">All Positions</option>
            <option value="C">C</option>
            <option value="1B">1B</option>
            <option value="2B">2B</option>
            <option value="SS">SS</option>
            <option value="3B">3B</option>
            <option value="OF">OF</option>
            <option value="DH">DH</option>
          </select>

          <select
            value={availability}
            onChange={e => setAvailability(e.target.value)}
            className="input sm:w-36"
          >
            <option value="ALL">All Players</option>
            <option value="FREE_AGENT">Free Agents</option>
            <option value="ON_ROSTER">Rostered</option>
          </select>
        </div>
      </div>

      {/* Results */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
          <div className="table-header">
            {loading ? 'Searching...' : `${players.length} players`}
          </div>
          <div className="flex items-center gap-6 table-header">
            <span className="w-16 text-center">Season HR</span>
            <span className="w-20 text-center">Status</span>
            <span className="w-24">Owner</span>
            <span className="w-16"></span>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="animate-spin text-brand" size={20} />
          </div>
        ) : players.length === 0 ? (
          <div className="text-center py-12 text-text-muted">
            <Search size={32} className="mx-auto mb-3 opacity-40" />
            <p>No players found</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-border/50">
            {players.map(player => {
              const isOnMyRoster = myRoster.includes(player.id)
              const isPending = actionPending === player.id

              return (
                <div key={player.id} className="flex items-center gap-3 px-4 py-3 table-row">
                  {/* Player info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/players/${player.id}`} className="font-medium text-sm text-text-primary truncate hover:underline">
                        {player.fullName}
                      </Link>
                      {isOnMyRoster && (
                        <span className="badge-brand text-xs">Yours</span>
                      )}
                    </div>
                    <div className="text-xs text-text-muted">
                      {player.positions.join('/')} · {player.mlbTeamAbbr ?? 'FA'}
                    </div>
                  </div>

                  {/* Season HRs */}
                  <div className="w-16 text-center">
                    <span className={`font-display font-black text-xl ${player.seasonHR > 20 ? 'text-brand' : 'text-text-primary'}`}>
                      {player.seasonHR}
                    </span>
                  </div>

                  {/* Status */}
                  <div className="w-20 text-center">
                    <span className={`font-mono text-xs font-semibold ${STATUS_COLORS[player.status] ?? 'text-text-muted'}`}>
                      {STATUS_LABELS[player.status] ?? player.status}
                    </span>
                  </div>

                  {/* Owner */}
                  <div className="w-24">
                    {player.ownedByTeamName ? (
                      <Link href={`/teams/${player.ownedByTeamId}`} className="text-xs text-text-muted truncate block hover:text-brand transition-colors">{player.ownedByTeamName}</Link>
                    ) : (
                      <span className="badge-brand text-xs">Free Agent</span>
                    )}
                  </div>

                  {/* Action */}
                  <div className="w-20 flex justify-end gap-1">
                    {isOnMyRoster ? (
                      <button
                        onClick={() => handleDrop(player)}
                        disabled={isPending}
                        className="p-2 rounded-lg bg-red-500/10 text-accent-red hover:bg-red-500/20 transition-colors disabled:opacity-50"
                        title="Drop player"
                      >
                        {isPending ? <RefreshCw size={14} className="animate-spin" /> : <Minus size={14} />}
                      </button>
                    ) : !player.isOnRoster ? (
                      player.isOnWaivers ? (
                        // Player in 3-day waiver window — must go through waiver claim (FAAB or priority)
                        <button
                          onClick={() => setWaiverClaimPlayer(player)}
                          disabled={isPending}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-accent-amber/10 text-accent-amber hover:bg-accent-amber/20 transition-colors disabled:opacity-50 text-xs font-semibold"
                          title="Submit waiver claim"
                        >
                          <Clock size={12} />
                          Claim
                        </button>
                      ) : (
                        // Free agent — immediate add
                        <button
                          onClick={() => handleAdd(player)}
                          disabled={isPending}
                          className="p-2 rounded-lg bg-brand/10 text-brand hover:bg-brand/20 transition-colors disabled:opacity-50"
                          title="Add free agent"
                        >
                          {isPending ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                        </button>
                      )
                    ) : (
                      <span className="text-xs text-text-muted">Rostered</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {/* Waiver claim modal — shown for players in the 3-day waiver window */}
      {waiverClaimPlayer && (
        <WaiverClaimModal
          player={waiverClaimPlayer}
          myRoster={rosterDetail}
          onClose={() => setWaiverClaimPlayer(null)}
          onSubmitted={() => {
            setWaiverClaimPlayer(null)
            fetchMyRosterInfo()
          }}
        />
      )}
    </div>
  )
}
