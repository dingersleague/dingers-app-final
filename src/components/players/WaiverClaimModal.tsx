'use client'

import { useState, useEffect } from 'react'
import { X, Clock, DollarSign, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

interface WaiverClaimModalProps {
  player: {
    id: string
    fullName: string
    positions: string[]
    mlbTeamAbbr: string | null
    seasonHR: number
  }
  myRoster: Array<{
    playerId: string
    playerName: string
    position: string
  }>
  onClose: () => void
  onSubmitted: () => void
}

interface WaiverMeta {
  waiverType: 'PRIORITY' | 'FAAB' | 'FREE_AGENCY'
  faabBalance: number
  faabBudget: number
  faabAllowZeroBid: boolean
  waiverPriority: number
}

export default function WaiverClaimModal({
  player, myRoster, onClose, onSubmitted
}: WaiverClaimModalProps) {
  const [dropPlayerId, setDropPlayerId] = useState<string>('')
  const [faabBid, setFaabBid] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [meta, setMeta] = useState<WaiverMeta | null>(null)
  const [metaLoading, setMetaLoading] = useState(true)

  const rosterFull = myRoster.length >= 13

  // Fetch current FAAB balance and league waiver mode on mount
  useEffect(() => {
    async function fetchMeta() {
      try {
        const res = await fetch('/api/waivers')
        const data = await res.json()
        if (data.success) {
          setMeta({
            waiverType: data.data.waiverType,
            faabBalance: data.data.faabBalance,
            faabBudget: data.data.faabBudget,
            faabAllowZeroBid: data.data.faabAllowZeroBid,
            waiverPriority: data.data.waiverPriority,
          })
        }
      } catch {
        // Non-critical — modal still works without meta
      } finally {
        setMetaLoading(false)
      }
    }
    fetchMeta()
  }, [])

  const isFaab = meta?.waiverType === 'FAAB'
  const minBid = meta?.faabAllowZeroBid ? 0 : 1
  const bidNum = parseInt(faabBid, 10)
  const bidValid = isFaab
    ? !isNaN(bidNum) && bidNum >= minBid && bidNum <= (meta?.faabBalance ?? 0)
    : true

  async function submitClaim() {
    if (rosterFull && !dropPlayerId) {
      toast.error('Your roster is full. Select a player to drop.')
      return
    }

    if (isFaab) {
      if (faabBid === '') {
        toast.error('Enter a bid amount.')
        return
      }
      if (!bidValid) {
        toast.error(
          bidNum > (meta?.faabBalance ?? 0)
            ? `Bid exceeds your balance of $${meta?.faabBalance}`
            : `Minimum bid is $${minBid}`
        )
        return
      }
    }

    setSubmitting(true)
    try {
      const body: Record<string, any> = {
        playerId: player.id,
        dropPlayerId: dropPlayerId || undefined,
      }
      if (isFaab) body.faabBid = bidNum

      const res = await fetch('/api/waivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message)
        onSubmitted()
        onClose()
      } else {
        toast.error(data.error || 'Claim failed')
      }
    } catch {
      toast.error('Request failed')
    }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative card w-full max-w-md p-6 shadow-2xl animate-slide-up">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-muted hover:text-text-primary"
        >
          <X size={18} />
        </button>

        <h2 className="font-display font-bold text-2xl mb-1">Waiver Claim</h2>
        <p className="text-text-muted text-sm mb-5">
          {isFaab
            ? 'Submit a blind bid. Highest valid bid wins when claims process Tuesday morning.'
            : 'Claims process Tuesday morning in priority order.'}
        </p>

        {/* Player being claimed */}
        <div className="card p-4 mb-4 bg-brand/5 border-brand/20">
          <div className="text-xs text-text-muted uppercase tracking-wider mb-2">Claiming</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-text-primary">{player.fullName}</div>
              <div className="text-xs text-text-muted">
                {player.positions.join('/')} · {player.mlbTeamAbbr ?? 'FA'}
              </div>
            </div>
            <div className="font-display font-black text-2xl text-brand">{player.seasonHR} HR</div>
          </div>
        </div>

        {/* FAAB bid input */}
        {isFaab && (
          <div className="mb-4">
            <label className="text-xs text-text-muted block mb-2 uppercase tracking-wider">
              Your Bid (FAAB)
            </label>

            {/* Balance indicator */}
            {!metaLoading && meta && (
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-muted">Available balance</span>
                <span className="font-mono text-sm font-bold text-brand">
                  ${meta.faabBalance}
                  <span className="text-text-muted font-normal"> / ${meta.faabBudget}</span>
                </span>
              </div>
            )}

            <div className="relative">
              <DollarSign
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
              />
              <input
                type="number"
                min={minBid}
                max={meta?.faabBalance ?? 999}
                value={faabBid}
                onChange={e => setFaabBid(e.target.value)}
                placeholder={`${minBid}–${meta?.faabBalance ?? '?'}`}
                className="input pl-8"
              />
            </div>

            {/* Quick-pick shortcuts */}
            {meta && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {[1, 5, 10, 25, 50].filter(v => v <= meta.faabBalance).map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setFaabBid(String(v))}
                    className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                      bidNum === v
                        ? 'bg-brand/20 text-brand border-brand/40'
                        : 'bg-surface-3 text-text-muted border-surface-border hover:text-text-primary'
                    }`}
                  >
                    ${v}
                  </button>
                ))}
                {meta.faabBalance > 0 && (
                  <button
                    type="button"
                    onClick={() => setFaabBid(String(meta.faabBalance))}
                    className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                      bidNum === meta.faabBalance
                        ? 'bg-brand/20 text-brand border-brand/40'
                        : 'bg-surface-3 text-text-muted border-surface-border hover:text-text-primary'
                    }`}
                  >
                    Max (${meta.faabBalance})
                  </button>
                )}
              </div>
            )}

            {/* Validation feedback */}
            {faabBid !== '' && !bidValid && (
              <div className="flex items-center gap-1.5 mt-2 text-xs text-accent-red">
                <AlertCircle size={12} />
                {bidNum > (meta?.faabBalance ?? 0)
                  ? `Exceeds your balance ($${meta?.faabBalance})`
                  : `Minimum bid is $${minBid}`}
              </div>
            )}
          </div>
        )}

        {/* Drop player if roster full */}
        {rosterFull && (
          <div className="mb-4">
            <label className="text-xs text-text-muted block mb-2 uppercase tracking-wider">
              Drop Player (roster full)
            </label>
            <select
              value={dropPlayerId}
              onChange={e => setDropPlayerId(e.target.value)}
              className="input"
            >
              <option value="">— Select player to drop —</option>
              {myRoster.map(p => (
                <option key={p.playerId} value={p.playerId}>
                  {p.playerName} ({p.position})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Info footer */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-surface-3 border border-surface-border mb-5">
          <Clock size={14} className="text-text-muted flex-shrink-0 mt-0.5" />
          <p className="text-xs text-text-muted">
            {isFaab
              ? 'Bids are blind — other teams cannot see your bid amount. Winning bid is deducted from your FAAB balance after processing.'
              : "Waiver claims run Tuesday at 3 AM ET. You'll be notified if your claim is processed or blocked by a higher-priority team."}
          </p>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button
            onClick={submitClaim}
            disabled={submitting || (rosterFull && !dropPlayerId) || (isFaab && !bidValid)}
            className="btn-brand flex-1 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : isFaab ? `Bid $${faabBid || '—'}` : 'Submit Claim'}
          </button>
        </div>
      </div>
    </div>
  )
}
