'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Lock, Unlock, RefreshCw, Save, AlertCircle, Calendar, AlertTriangle } from 'lucide-react'
import Link from 'next/link'

const POSITIONS = ['C', '1B', '2B', 'SS', '3B', 'OF', 'OF', 'OF', 'UTIL', 'BN', 'BN', 'BN', 'BN', 'IL']

interface RosterPlayer {
  rosterSlotId: string
  position: string
  isStarter: boolean
  player: {
    id: string
    fullName: string
    positions: string[]
    mlbTeamAbbr: string | null
    status: string
    seasonHR: number
    gamesThisWeek: number
    schedule: Array<{ date: string; opponent: string }>
    news: string | null
  }
  weeklyHR: number
  locked: boolean
}

interface LineupSlot {
  position: string
  player: RosterPlayer | null
}

export default function RosterPage() {
  const [roster, setRoster] = useState<RosterPlayer[]>([])
  const [lineup, setLineup] = useState<LineupSlot[]>([])
  const [isLocked, setIsLocked] = useState(false)
  const [lockTime, setLockTime] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const [weekLabel, setWeekLabel] = useState<string | null>(null)
  const [selectedSlotIdx, setSelectedSlotIdx] = useState<number | null>(null) // tap-to-swap

  useEffect(() => {
    fetchRoster()
  }, [])

  async function fetchRoster() {
    setLoading(true)
    try {
      const res = await fetch('/api/roster')
      const data = await res.json()
      if (data.success) {
        setRoster(data.data.roster)
        setLineup(data.data.lineup)
        setIsLocked(data.data.isLocked)
        setLockTime(data.data.lockTime)
        if (data.data.weekStart && data.data.weekEnd) {
          setWeekLabel(`${data.data.weekStart} – ${data.data.weekEnd}`)
        }
      }
    } catch (err) {
      toast.error('Failed to load roster')
    }
    setLoading(false)
  }

  async function saveLineup() {
    if (isLocked) {
      toast.error('Lineup is locked for this week')
      return
    }
    setSaving(true)
    try {
      // Transform lineup to API format: { position, rosterSlotId }
      const payload = lineup.map(slot => ({
        position: slot.position,
        rosterSlotId: slot.player?.rosterSlotId ?? null,
      }))
      const res = await fetch('/api/roster/lineup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineup: payload }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Lineup saved')
      } else {
        toast.error(data.error || 'Failed to save lineup')
      }
    } catch {
      toast.error('Failed to save lineup')
    }
    setSaving(false)
  }

  function handleDragStart(rosterSlotId: string) {
    setDragging(rosterSlotId)
  }

  function handleDrop(targetPosition: string) {
    if (!dragging || isLocked) return

    const draggedPlayer = roster.find(p => p.rosterSlotId === dragging)
    if (!draggedPlayer) return

    const eligible = canPlayInSlot(draggedPlayer.player.positions, targetPosition)
    if (!eligible) {
      toast.error(`${draggedPlayer.player.fullName} is not eligible for ${targetPosition}`)
      setDragging(null)
      return
    }

    setLineup(prev => {
      const newLineup = [...prev]
      const targetSlot = newLineup.find(s => s.position === targetPosition)
      const currentSlot = newLineup.find(s => s.player?.rosterSlotId === dragging)

      if (targetSlot && currentSlot) {
        const temp = targetSlot.player
        targetSlot.player = draggedPlayer
        currentSlot.player = temp
      } else if (targetSlot) {
        targetSlot.player = draggedPlayer
      }

      return newLineup
    })

    setDragging(null)
  }

  // Tap-to-swap: first tap selects, second tap swaps
  function handleTapSlot(slotIndex: number) {
    if (isLocked) return

    if (selectedSlotIdx === null) {
      // First tap — select this slot
      setSelectedSlotIdx(slotIndex)
      return
    }

    if (selectedSlotIdx === slotIndex) {
      // Tapped same slot — deselect
      setSelectedSlotIdx(null)
      return
    }

    // Second tap — swap the two slots
    const fromSlot = lineup[selectedSlotIdx]
    const toSlot = lineup[slotIndex]

    // Check eligibility both ways
    if (toSlot.player && fromSlot.position !== 'BN' && fromSlot.position !== 'IL') {
      if (!canPlayInSlot(toSlot.player.player.positions, fromSlot.position)) {
        toast.error(`${toSlot.player.player.fullName} can't play ${fromSlot.position}`)
        setSelectedSlotIdx(null)
        return
      }
    }
    if (fromSlot.player && toSlot.position !== 'BN' && toSlot.position !== 'IL') {
      if (!canPlayInSlot(fromSlot.player.player.positions, toSlot.position)) {
        toast.error(`${fromSlot.player.player.fullName} can't play ${toSlot.position}`)
        setSelectedSlotIdx(null)
        return
      }
    }

    setLineup(prev => {
      const newLineup = [...prev]
      const temp = newLineup[selectedSlotIdx].player
      newLineup[selectedSlotIdx] = { ...newLineup[selectedSlotIdx], player: newLineup[slotIndex].player }
      newLineup[slotIndex] = { ...newLineup[slotIndex], player: temp }
      return newLineup
    })

    setSelectedSlotIdx(null)
    toast('Players swapped — save to confirm', { icon: '🔄' })
  }

  function canPlayInSlot(positions: string[], slot: string): boolean {
    const eligibility: Record<string, string[]> = {
      C: ['C'],
      '1B': ['1B', '3B'],
      '2B': ['2B', 'SS'],
      SS: ['SS', '2B'],
      '3B': ['3B', '1B'],
      OF: ['OF', 'LF', 'CF', 'RF'],
      UTIL: ['C', '1B', '2B', 'SS', '3B', 'OF', 'LF', 'CF', 'RF', 'DH'],
      BN: positions,  // bench accepts all
    }
    return positions.some(p => (eligibility[slot] ?? []).includes(p))
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'INJURED_10_DAY': return 'text-accent-red'
      case 'INJURED_60_DAY': return 'text-accent-red'
      case 'SUSPENDED': return 'text-accent-amber'
      case 'MINORS': return 'text-accent-purple'
      default: return 'text-brand'
    }
  }

  function getStatusLabel(status: string) {
    switch (status) {
      case 'INJURED_10_DAY': return 'IL-10'
      case 'INJURED_60_DAY': return 'IL-60'
      case 'SUSPENDED': return 'SUSP'
      case 'MINORS': return 'MiLB'
      default: return 'ACT'
    }
  }

  const starters = lineup.filter(s => s.position !== 'BN' && s.position !== 'IL')
  const bench = lineup.filter(s => s.position === 'BN')
  const ilSlots = lineup.filter(s => s.position === 'IL')
  const totalWeeklyHR = starters.reduce((sum, s) => sum + (s.player?.weeklyHR ?? 0), 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-brand" size={24} />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display font-black text-4xl tracking-tight">My Roster</h1>
          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1.5">
              {isLocked ? (
                <Lock size={14} className="text-accent-red" />
              ) : (
                <Unlock size={14} className="text-brand" />
              )}
              <span className={`text-sm ${isLocked ? 'text-accent-red' : 'text-brand'}`}>
                {isLocked ? 'Lineup locked' : 'Lineup open'}
              </span>
            </div>
            {lockTime && !isLocked && (
              <span className="text-text-muted text-xs">Locks {lockTime}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="stat-label">This Week</div>
            <div className="font-display font-black text-2xl text-brand">{totalWeeklyHR} HR</div>
          </div>
          <button
            onClick={saveLineup}
            disabled={isLocked || saving}
            className="btn-brand flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={14} />
            {saving ? 'Saving...' : 'Save Lineup'}
          </button>
        </div>
      </div>

      {isLocked && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertCircle size={16} className="text-accent-red flex-shrink-0" />
          <p className="text-sm text-red-400">
            Lineups are locked for this scoring period. Changes will apply next week.
          </p>
        </div>
      )}

      {/* Player News & Injuries */}
      {(() => {
        const alerts = roster.filter(r => r.player.news || (r.player.status !== 'ACTIVE' && r.player.status !== 'INACTIVE'))
        return alerts.length > 0 ? (
          <div className="card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-surface-border bg-accent-red/5 flex items-center gap-2">
              <AlertTriangle size={14} className="text-accent-red" />
              <span className="font-display font-bold text-sm text-accent-red">Player Alerts</span>
            </div>
            <div className="divide-y divide-surface-border/30">
              {alerts.map(a => (
                <div key={a.rosterSlotId} className="flex items-center gap-3 px-4 py-2.5">
                  <Link href={`/players/${a.player.id}`} className="font-medium text-sm text-text-primary hover:underline min-w-0 truncate">
                    {a.player.fullName}
                  </Link>
                  <span className={`text-xs font-mono font-semibold flex-shrink-0 ${getStatusColor(a.player.status)}`}>
                    {getStatusLabel(a.player.status)}
                  </span>
                  {a.player.news && (
                    <span className="text-xs text-text-muted truncate flex-1">{a.player.news}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null
      })()}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Starting Lineup */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border">
            <h2 className="font-display font-bold text-xl tracking-tight">Starting Lineup</h2>
            <p className="text-text-muted text-xs mt-0.5">
              {selectedSlotIdx !== null ? 'Tap another player to swap' : 'Tap a player to move them'}
            </p>
          </div>
          <div className="divide-y divide-surface-border/50">
            {starters.map((slot, i) => {
              const globalIdx = lineup.indexOf(slot)
              const isSelected = selectedSlotIdx === globalIdx
              return (
              <div
                key={`${slot.position}-${i}`}
                className={`flex items-center gap-3 px-5 py-3 transition-colors cursor-pointer
                  ${isSelected ? 'bg-brand/10 border-l-3 border-brand' : ''}
                  ${selectedSlotIdx !== null && !isSelected ? 'hover:bg-brand/5' : ''}
                  ${dragging ? 'hover:bg-brand/5' : ''}
                `}
                onClick={() => handleTapSlot(globalIdx)}
                onDragOver={e => { e.preventDefault() }}
                onDrop={() => handleDrop(slot.position)}
              >
                {/* Position badge */}
                <div className="w-12 flex-shrink-0">
                  <span className={`badge font-mono font-bold text-xs
                    ${slot.position === 'UTIL' ? 'badge-secondary' : 'badge-brand'}
                  `}>
                    {slot.position}
                  </span>
                </div>

                {slot.player ? (
                  <div
                    className="flex-1 cursor-grab active:cursor-grabbing"
                    draggable={!isLocked}
                    onDragStart={() => handleDragStart(slot.player!.rosterSlotId)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link href={`/players/${slot.player.player.id}`} className="font-medium text-sm text-text-primary truncate hover:underline">
                            {slot.player.player.fullName}
                          </Link>
                          <span className={`text-xs font-mono font-semibold ${getStatusColor(slot.player.player.status)}`}>
                            {getStatusLabel(slot.player.player.status)}
                          </span>
                        </div>
                        <div className="text-xs text-text-muted">
                          {slot.player.player.positions.join(', ')} · {slot.player.player.mlbTeamAbbr ?? 'FA'}
                        </div>
                        {slot.player.player.news && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <AlertTriangle size={10} className="text-accent-red flex-shrink-0" />
                            <span className="text-[10px] text-accent-red truncate">{slot.player.player.news}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-display font-bold text-lg text-brand">{slot.player.weeklyHR}</div>
                        <div className="text-xs text-text-muted">{slot.player.player.seasonHR} szn</div>
                      </div>
                    </div>
                    {slot.player.player.schedule.length > 0 && (
                      <div className="flex gap-1 mt-1.5">
                        {slot.player.player.schedule.map((g, gi) => (
                          <div key={gi} className={`px-1.5 py-0.5 rounded text-[9px] font-mono leading-tight ${
                            g.opponent.startsWith('vs') ? 'bg-brand/10 text-brand' : 'bg-surface-3 text-text-muted'
                          }`}>
                            {g.opponent}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 text-text-muted text-sm italic">Empty slot</div>
                )}
              </div>
              )
            })}
          </div>
        </div>

        {/* Bench */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border">
            <h2 className="font-display font-bold text-xl tracking-tight">Bench</h2>
            <p className="text-text-muted text-xs mt-0.5">Bench players do not score</p>
          </div>
          <div className="divide-y divide-surface-border/50">
            {bench.map((slot, i) => {
              const globalIdx = lineup.indexOf(slot)
              const isSelected = selectedSlotIdx === globalIdx
              return (
              <div
                key={`BN-${i}`}
                className={`flex items-center gap-3 px-5 py-3 transition-colors cursor-pointer
                  ${isSelected ? 'bg-brand/10 border-l-3 border-brand' : ''}
                  ${selectedSlotIdx !== null && !isSelected ? 'hover:bg-brand/5' : ''}
                  ${dragging ? 'hover:bg-surface-3' : ''}
                `}
                onClick={() => handleTapSlot(globalIdx)}
                onDragOver={e => e.preventDefault()}
                onDrop={() => handleDrop('BN')}
              >
                <div className="w-12 flex-shrink-0">
                  <span className="badge-secondary font-mono font-bold text-xs">BN</span>
                </div>

                {slot.player ? (
                  <div
                    className="flex-1 cursor-grab active:cursor-grabbing"
                    draggable={!isLocked}
                    onDragStart={() => handleDragStart(slot.player!.rosterSlotId)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link href={`/players/${slot.player.player.id}`} className="font-medium text-sm text-text-primary truncate hover:underline">
                            {slot.player.player.fullName}
                          </Link>
                          <span className={`text-xs font-mono font-semibold ${getStatusColor(slot.player.player.status)}`}>
                            {getStatusLabel(slot.player.player.status)}
                          </span>
                        </div>
                        <div className="text-xs text-text-muted">
                          {slot.player.player.positions.join(', ')} · {slot.player.player.mlbTeamAbbr ?? 'FA'}
                        </div>
                        {slot.player.player.news && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <AlertTriangle size={10} className="text-accent-red flex-shrink-0" />
                            <span className="text-[10px] text-accent-red truncate">{slot.player.player.news}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-display font-bold text-lg text-text-muted">{slot.player.player.seasonHR}</div>
                        <div className="text-xs text-text-muted">szn</div>
                      </div>
                    </div>
                    {slot.player.player.schedule.length > 0 && (
                      <div className="flex gap-1 mt-1.5">
                        {slot.player.player.schedule.map((g, gi) => (
                          <div key={gi} className={`px-1.5 py-0.5 rounded text-[9px] font-mono leading-tight ${
                            g.opponent.startsWith('vs') ? 'bg-brand/10 text-brand' : 'bg-surface-3 text-text-muted'
                          }`}>
                            {g.opponent}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 text-text-muted text-sm italic">Empty bench spot</div>
                )}
              </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Selection hint — positioned above mobile bottom nav and save button */}
      {selectedSlotIdx !== null && (
        <div className="fixed bottom-36 lg:bottom-20 left-1/2 -translate-x-1/2 z-40 bg-brand text-surface-0 px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-3 animate-fade-in text-sm">
          <span className="font-semibold truncate max-w-[180px]">
            {lineup[selectedSlotIdx]?.player?.player.fullName ?? 'Empty slot'}
          </span>
          <span className="text-xs opacity-80 hidden sm:inline">→ Tap to swap</span>
          <button onClick={() => setSelectedSlotIdx(null)} className="text-xs px-2 py-1 rounded-lg bg-white/20 hover:bg-white/30">✕</button>
        </div>
      )}
    </div>
  )
}
