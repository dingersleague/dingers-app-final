'use client'

import { useState, useEffect } from 'react'
import { Search, Plus, Minus, RefreshCw, Clock, ChevronUp, ChevronDown } from 'lucide-react'
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

const POSITIONS = ['ALL', 'C', '1B', '2B', 'SS', '3B', 'OF', 'DH']
const AVAILABILITY = [
  { value: 'ALL', label: 'All' },
  { value: 'FREE_AGENT', label: 'Available' },
  { value: 'ON_ROSTER', label: 'Rostered' },
]

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active', INJURED_10_DAY: 'IL-10', INJURED_60_DAY: 'IL-60',
  SUSPENDED: 'SUSP', MINORS: 'MiLB', INACTIVE: 'OUT',
}
const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-brand/10 text-brand',
  INJURED_10_DAY: 'bg-red-500/10 text-accent-red',
  INJURED_60_DAY: 'bg-red-500/10 text-accent-red',
  SUSPENDED: 'bg-amber-500/10 text-accent-amber',
  MINORS: 'bg-purple-500/10 text-accent-purple',
  INACTIVE: 'bg-surface-3 text-text-muted',
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
  const [rosterDetail, setRosterDetail] = useState<Array<{ playerId: string; playerName: string; position: string }>>([])
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  const debouncedQuery = useDebounce(query, 300)

  useEffect(() => { searchPlayers() }, [debouncedQuery, position, availability])
  useEffect(() => { fetchMyRosterInfo(); fetchRosterDetail() }, [])

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
        const roster = data.data?.roster ?? data.data ?? []
        setRosterDetail(
          roster.map((slot: any) => ({
            playerId: slot.player?.id ?? slot.playerId,
            playerName: slot.player?.fullName ?? 'Unknown',
            position: slot.position ?? 'BN',
          }))
        )
      }
    }
  }

  async function searchPlayers() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: debouncedQuery, position, availability, limit: '50' })
      const res = await fetch(`/api/players/search?${params}`)
      const data = await res.json()
      if (data.success) setPlayers(data.data)
    } catch { toast.error('Search failed') }
    setLoading(false)
  }

  async function handleAdd(player: Player) {
    if (rosterFull) { setShowDropModal(player); return }
    setActionPending(player.id)
    try {
      const res = await fetch('/api/transactions/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: player.id }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Added ${player.fullName}`)
        setMyRoster(prev => [...prev, player.id])
        searchPlayers(); fetchMyRosterInfo()
      } else { toast.error(data.error || 'Could not add player') }
    } catch { toast.error('Request failed') }
    setActionPending(null)
  }

  async function handleAddWithDrop(addPlayer: Player, dropPlayerId: string) {
    setActionPending(addPlayer.id)
    try {
      const res = await fetch('/api/transactions/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: addPlayer.id, dropPlayerId }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Added ${addPlayer.fullName}`)
        setShowDropModal(null)
        searchPlayers(); fetchMyRosterInfo(); fetchRosterDetail()
      } else { toast.error(data.error || 'Could not add player') }
    } catch { toast.error('Request failed') }
    setActionPending(null)
  }

  async function handleDrop(player: Player) {
    setActionPending(player.id)
    try {
      const res = await fetch('/api/transactions/drop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: player.id }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Dropped ${player.fullName}`)
        setMyRoster(prev => prev.filter(id => id !== player.id))
        searchPlayers(); fetchMyRosterInfo(); fetchRosterDetail()
      } else { toast.error(data.error || 'Could not drop player') }
    } catch { toast.error('Request failed') }
    setActionPending(null)
  }

  const sorted = [...players].sort((a, b) =>
    sortDir === 'desc' ? b.seasonHR - a.seasonHR : a.seasonHR - b.seasonHR
  )

  const headshotUrl = (mlbId: number) =>
    `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_80,q_auto:best/v1/people/${mlbId}/headshot/67/current`

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="font-display font-black text-4xl tracking-tight">Players</h1>
        <p className="text-text-muted text-sm mt-1">Search and manage your roster</p>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          className="w-full bg-surface-2 border border-surface-border rounded-xl pl-11 pr-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 transition-all"
          placeholder="Search by player name..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Position pills */}
        <div className="flex gap-1.5 flex-wrap flex-1">
          {POSITIONS.map(pos => (
            <button
              key={pos}
              onClick={() => setPosition(pos)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                position === pos
                  ? 'bg-brand text-surface-0'
                  : 'bg-surface-3 text-text-muted hover:text-text-primary hover:bg-surface-4'
              }`}
            >
              {pos}
            </button>
          ))}
        </div>

        {/* Availability tabs */}
        <div className="flex bg-surface-3 rounded-lg p-0.5">
          {AVAILABILITY.map(a => (
            <button
              key={a.value}
              onClick={() => setAvailability(a.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                availability === a.value
                  ? 'bg-surface-1 text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {/* Header row */}
        <div className="flex items-center px-4 py-2.5 border-b border-surface-border bg-surface-1/50 text-[11px] uppercase tracking-wider text-text-muted font-semibold">
          <div className="w-10" /> {/* headshot */}
          <div className="flex-1 min-w-0">Player</div>
          <div className="w-14 text-center hidden sm:block">POS</div>
          <div className="w-16 text-center hidden sm:block">Team</div>
          <div className="w-16 text-center hidden md:block">Status</div>
          <button
            onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            className="w-16 text-center flex items-center justify-center gap-0.5 hover:text-text-primary transition-colors"
          >
            HR {sortDir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
          </button>
          <div className="w-24 text-center hidden lg:block">Owner</div>
          <div className="w-24 text-right">Action</div>
        </div>

        {/* Loading */}
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <RefreshCw className="animate-spin text-brand" size={20} />
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16 text-text-muted">
            <Search size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No players found</p>
          </div>
        ) : (
          <div>
            {sorted.map((player, i) => {
              const isOnMyRoster = myRoster.includes(player.id)
              const isPending = actionPending === player.id

              return (
                <div
                  key={player.id}
                  className={`flex items-center px-4 py-2.5 border-b border-surface-border/30 transition-colors hover:bg-surface-1/30 ${
                    isOnMyRoster ? 'bg-brand/3' : ''
                  }`}
                >
                  {/* Headshot */}
                  <div className="w-10 flex-shrink-0">
                    <img
                      src={headshotUrl(player.mlbId)}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover bg-surface-3"
                      loading="lazy"
                    />
                  </div>

                  {/* Name + mobile info */}
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/players/${player.id}`}
                      className="font-medium text-sm text-text-primary hover:text-brand transition-colors truncate block"
                    >
                      {player.fullName}
                      {isOnMyRoster && <span className="ml-1.5 text-[10px] text-brand font-bold">MY TEAM</span>}
                    </Link>
                    <div className="text-xs text-text-muted sm:hidden">
                      {player.positions.join('/')} · {player.mlbTeamAbbr ?? 'FA'} · {player.seasonHR} HR
                    </div>
                  </div>

                  {/* Position */}
                  <div className="w-14 text-center hidden sm:block">
                    <span className="text-xs font-mono text-text-secondary">{player.positions.join('/')}</span>
                  </div>

                  {/* MLB Team */}
                  <div className="w-16 text-center hidden sm:block">
                    <span className="text-xs font-mono text-text-muted">{player.mlbTeamAbbr ?? '—'}</span>
                  </div>

                  {/* Status */}
                  <div className="w-16 text-center hidden md:block">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLE[player.status] ?? 'bg-surface-3 text-text-muted'}`}>
                      {STATUS_LABEL[player.status] ?? player.status}
                    </span>
                  </div>

                  {/* HR */}
                  <div className="w-16 text-center">
                    <span className={`font-display font-black text-lg ${
                      player.seasonHR >= 30 ? 'text-brand' : player.seasonHR >= 15 ? 'text-text-primary' : 'text-text-muted'
                    }`}>
                      {player.seasonHR}
                    </span>
                  </div>

                  {/* Owner */}
                  <div className="w-24 text-center hidden lg:block">
                    {player.ownedByTeamName ? (
                      <Link
                        href={`/teams/${player.ownedByTeamId}`}
                        className="text-[11px] text-text-muted hover:text-brand transition-colors truncate block"
                      >
                        {player.ownedByTeamName}
                      </Link>
                    ) : (
                      <span className="text-[11px] text-brand font-semibold">FA</span>
                    )}
                  </div>

                  {/* Action button */}
                  <div className="w-24 flex justify-end">
                    {isOnMyRoster ? (
                      <button
                        onClick={() => handleDrop(player)}
                        disabled={isPending}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/10 text-accent-red hover:bg-red-500/20 transition-all text-xs font-semibold disabled:opacity-50"
                      >
                        {isPending ? <RefreshCw size={12} className="animate-spin" /> : <Minus size={12} />}
                        Drop
                      </button>
                    ) : !player.isOnRoster ? (
                      player.isOnWaivers ? (
                        <button
                          onClick={() => setWaiverClaimPlayer(player)}
                          disabled={isPending}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500/10 text-accent-amber hover:bg-amber-500/20 transition-all text-xs font-semibold disabled:opacity-50"
                        >
                          <Clock size={12} />
                          Claim
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAdd(player)}
                          disabled={isPending}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand/10 text-brand hover:bg-brand/20 transition-all text-xs font-semibold disabled:opacity-50"
                        >
                          {isPending ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
                          Add
                        </button>
                      )
                    ) : (
                      <span className="text-[11px] text-text-muted px-2">Taken</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Footer with count */}
        {!loading && sorted.length > 0 && (
          <div className="px-4 py-2.5 border-t border-surface-border bg-surface-1/30 text-xs text-text-muted">
            Showing {sorted.length} players {position !== 'ALL' && `· ${position}`} {availability === 'FREE_AGENT' && '· Free agents only'}
          </div>
        )}
      </div>

      {/* Add/Drop swap modal */}
      {showDropModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowDropModal(null)}>
          <div className="card w-full max-w-md sm:mx-4 rounded-b-none sm:rounded-b-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header with the player being added */}
            <div className="p-4 border-b border-surface-border bg-brand/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-brand/20 border border-brand/40 flex items-center justify-center">
                  <Plus size={18} className="text-brand" />
                </div>
                <div className="flex-1">
                  <div className="font-display font-bold text-lg text-brand">{showDropModal.fullName}</div>
                  <div className="text-xs text-text-muted">{showDropModal.positions.join('/')} · {showDropModal.mlbTeamAbbr ?? 'FA'} · {showDropModal.seasonHR} Proj HR</div>
                </div>
              </div>
            </div>

            <div className="px-4 py-2 bg-surface-1/50">
              <span className="text-xs text-text-muted uppercase tracking-wider">Select player to drop</span>
            </div>

            {/* Roster list */}
            <div className="overflow-y-auto flex-1">
              {rosterDetail.map(slot => (
                <button
                  key={slot.playerId}
                  onClick={() => handleAddWithDrop(showDropModal, slot.playerId)}
                  disabled={!!actionPending}
                  className="w-full flex items-center gap-3 px-4 py-3 border-b border-surface-border/30 hover:bg-red-500/5 transition-colors text-left disabled:opacity-50"
                >
                  <span className="font-mono text-xs text-text-muted w-10 text-center">{slot.position}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">{slot.playerName}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Minus size={14} className="text-accent-red" />
                    <span className="text-xs text-accent-red font-semibold">Drop</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="p-3 border-t border-surface-border">
              <button onClick={() => setShowDropModal(null)} className="btn-secondary w-full text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Waiver claim modal */}
      {waiverClaimPlayer && (
        <WaiverClaimModal
          player={waiverClaimPlayer}
          myRoster={rosterDetail}
          onClose={() => setWaiverClaimPlayer(null)}
          onSubmitted={() => { setWaiverClaimPlayer(null); fetchMyRosterInfo() }}
        />
      )}
    </div>
  )
}
