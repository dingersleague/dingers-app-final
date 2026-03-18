import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, authError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { log } from '@/lib/logger'
import { z } from 'zod'

export const dynamic = 'force-dynamic' // prevent static build-time evaluation

// GET /api/trades - list pending trades involving my team
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.teamId || !user.leagueId) {
      return NextResponse.json({ success: false, error: 'No team' }, { status: 404 })
    }

    const trades = await prisma.$queryRaw<Array<{
      trade_id: string
      offer_team_id: string
      offer_team_name: string
      receive_team_id: string
      receive_team_name: string
      offer_player_id: string
      offer_player_name: string
      receive_player_id: string
      receive_player_name: string
      status: string
      created_at: Date
    }>>`
      SELECT
        t1.notes AS trade_id,
        t1.team_id AS offer_team_id,
        ot.name AS offer_team_name,
        t2.team_id AS receive_team_id,
        rt.name AS receive_team_name,
        t1.player_id AS offer_player_id,
        op.full_name AS offer_player_name,
        t2.player_id AS receive_player_id,
        rp.full_name AS receive_player_name,
        t1.status,
        t1.created_at
      FROM transactions t1
      JOIN transactions t2 ON t2.notes = t1.notes AND t2.type = 'TRADE_DROP' AND t2.team_id != t1.team_id
      JOIN teams ot ON ot.id = t1.team_id
      JOIN teams rt ON rt.id = t2.team_id
      JOIN players op ON op.id = t1.player_id
      JOIN players rp ON rp.id = t2.player_id
      WHERE t1.type = 'TRADE_ADD'
        AND t1.league_id = ${user.leagueId}
        AND (t1.team_id = ${user.teamId} OR t2.team_id = ${user.teamId})
      ORDER BY t1.created_at DESC
      LIMIT 50
    `

    return NextResponse.json({ success: true, data: trades })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    console.error('[trades GET]', err)
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 })
  }
}

// POST /api/trades - propose a trade (supports multiple players)
const TradeSchema = z.object({
  offerPlayerIds: z.array(z.string().cuid()).min(1).max(5),
  receivePlayerIds: z.array(z.string().cuid()).min(1).max(5),
  targetTeamId: z.string().cuid(),
  // Legacy single-player support
  offerPlayerId: z.string().cuid().optional(),
  receivePlayerId: z.string().cuid().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.teamId || !user.leagueId) {
      return NextResponse.json({ success: false, error: 'No team' }, { status: 404 })
    }

    const body = await req.json()
    const parsed = TradeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 })
    }

    const data = parsed.data
    const offerPlayerIds = data.offerPlayerIds ?? (data.offerPlayerId ? [data.offerPlayerId] : [])
    const receivePlayerIds = data.receivePlayerIds ?? (data.receivePlayerId ? [data.receivePlayerId] : [])
    const { targetTeamId } = data

    if (offerPlayerIds.length === 0 || receivePlayerIds.length === 0) {
      return NextResponse.json({ success: false, error: 'Select at least one player from each side' }, { status: 400 })
    }

    if (targetTeamId === user.teamId) {
      return NextResponse.json({ success: false, error: 'Cannot trade with yourself' }, { status: 400 })
    }

    // Verify ownership
    for (const pid of offerPlayerIds) {
      const slot = await prisma.rosterSlot.findFirst({ where: { playerId: pid, teamId: user.teamId } })
      if (!slot) return NextResponse.json({ success: false, error: 'You do not own one of the offered players' }, { status: 400 })
    }
    for (const pid of receivePlayerIds) {
      const slot = await prisma.rosterSlot.findFirst({ where: { playerId: pid, teamId: targetTeamId } })
      if (!slot) return NextResponse.json({ success: false, error: 'Target team does not own one of the requested players' }, { status: 400 })
    }

    const tradeId = `trade:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Store the full player lists as JSON in the notes field alongside the tradeId
    const tradeData = JSON.stringify({ offerPlayerIds, receivePlayerIds })

    const txRecords: any[] = []
    // For each player the proposer gives, create TRADE_ADD on target + TRADE_DROP on proposer
    for (const pid of offerPlayerIds) {
      txRecords.push({
        leagueId: user.leagueId, teamId: user.teamId, type: 'TRADE_DROP' as const,
        playerId: pid, relatedTeamId: targetTeamId, status: 'PENDING' as const, notes: tradeId,
      })
      txRecords.push({
        leagueId: user.leagueId, teamId: targetTeamId, type: 'TRADE_ADD' as const,
        playerId: pid, relatedTeamId: user.teamId, status: 'PENDING' as const, notes: tradeId,
      })
    }
    // For each player the proposer receives
    for (const pid of receivePlayerIds) {
      txRecords.push({
        leagueId: user.leagueId, teamId: targetTeamId, type: 'TRADE_DROP' as const,
        playerId: pid, relatedTeamId: user.teamId, status: 'PENDING' as const, notes: tradeId,
      })
      txRecords.push({
        leagueId: user.leagueId, teamId: user.teamId, type: 'TRADE_ADD' as const,
        playerId: pid, relatedTeamId: targetTeamId, status: 'PENDING' as const, notes: tradeId,
      })
    }

    await prisma.transaction.createMany({ data: txRecords })

    log('info', 'trade_proposed', { tradeId, proposerTeamId: user.teamId, targetTeamId, offerPlayerIds, receivePlayerIds })

    const offerNames = await prisma.player.findMany({ where: { id: { in: offerPlayerIds } }, select: { fullName: true } })
    const receiveNames = await prisma.player.findMany({ where: { id: { in: receivePlayerIds } }, select: { fullName: true } })

    return NextResponse.json({
      success: true,
      message: `Trade proposed: ${offerNames.map(p => p.fullName).join(', ')} for ${receiveNames.map(p => p.fullName).join(', ')}`,
      data: { tradeId },
    })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    log('error', 'trade_propose_failed', { error: String(err) })
    return NextResponse.json({ success: false, error: 'Trade proposal failed' }, { status: 500 })
  }
}

// PATCH /api/trades - accept or reject a pending trade
const TradeActionSchema = z.object({
  tradeId: z.string(),
  action: z.enum(['accept', 'reject']),
})

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.teamId || !user.leagueId) {
      return NextResponse.json({ success: false, error: 'No team' }, { status: 404 })
    }

    const body = await req.json()
    const parsed = TradeActionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 })
    }

    const { tradeId, action } = parsed.data

    // Pre-flight: confirm trade exists and this user is the recipient
    const tradeTxs = await prisma.transaction.findMany({
      where: { notes: tradeId, leagueId: user.leagueId, status: 'PENDING' },
    })

    if (tradeTxs.length < 2) {
      return NextResponse.json({ success: false, error: 'Trade not found or already processed' }, { status: 404 })
    }

    const myTx = tradeTxs.find(t => t.teamId === user.teamId && t.type === 'TRADE_DROP')
    if (!myTx) {
      return NextResponse.json({ success: false, error: 'Not your trade to respond to' }, { status: 403 })
    }

    if (action === 'reject') {
      await prisma.transaction.updateMany({
        where: { notes: tradeId },
        data: { status: 'REJECTED', processedAt: new Date() },
      })
      log('info', 'trade_rejected', { tradeId, teamId: user.teamId })
      return NextResponse.json({ success: true, message: 'Trade rejected' })
    }

    // ACCEPT — full ownership re-validation happens INSIDE the transaction
    const proposerTx = tradeTxs.find(t => t.type === 'TRADE_ADD')
    if (!proposerTx || !proposerTx.relatedPlayerId) {
      return NextResponse.json({ success: false, error: 'Malformed trade record' }, { status: 500 })
    }

    // Gather all trade transactions to find players involved
    const allTradeTxs = tradeTxs
    const proposerTeamId = allTradeTxs.find(t => t.type === 'TRADE_ADD' && t.teamId !== user.teamId)?.teamId
      ?? allTradeTxs.find(t => t.type === 'TRADE_DROP' && t.teamId !== user.teamId)?.teamId
    const receiverTeamId = user.teamId

    if (!proposerTeamId) {
      return NextResponse.json({ success: false, error: 'Cannot determine trade partner' }, { status: 500 })
    }

    // Players proposer sends (receiver gets) = TRADE_ADD where teamId = receiver
    const receiverGets = allTradeTxs.filter(t => t.type === 'TRADE_ADD' && t.teamId === receiverTeamId).map(t => t.playerId)
    // Players receiver sends (proposer gets) = TRADE_ADD where teamId = proposer
    const proposerGets = allTradeTxs.filter(t => t.type === 'TRADE_ADD' && t.teamId === proposerTeamId).map(t => t.playerId)

    try {
      await prisma.$transaction(async tx => {
        const freshTxs = await tx.transaction.findMany({ where: { notes: tradeId }, select: { status: true } })
        if (freshTxs.some(t => t.status !== 'PENDING')) throw new Error('TRADE_ALREADY_PROCESSED')

        // Validate all players still owned
        for (const pid of receiverGets) {
          const slot = await tx.rosterSlot.findFirst({ where: { playerId: pid, teamId: proposerTeamId } })
          if (!slot) throw new Error('PROPOSER_LOST_PLAYER')
        }
        for (const pid of proposerGets) {
          const slot = await tx.rosterSlot.findFirst({ where: { playerId: pid, teamId: receiverTeamId } })
          if (!slot) throw new Error('RECEIVER_LOST_PLAYER')
        }

        // Execute swaps
        for (const pid of receiverGets) {
          await tx.rosterSlot.updateMany({ where: { playerId: pid, teamId: proposerTeamId }, data: { teamId: receiverTeamId, acquiredVia: 'TRADE' } })
        }
        for (const pid of proposerGets) {
          await tx.rosterSlot.updateMany({ where: { playerId: pid, teamId: receiverTeamId }, data: { teamId: proposerTeamId, acquiredVia: 'TRADE' } })
        }

        await tx.transaction.updateMany({ where: { notes: tradeId }, data: { status: 'PROCESSED', processedAt: new Date() } })
      }, { isolationLevel: 'Serializable' })
    } catch (txErr: any) {
      if (txErr.message === 'TRADE_ALREADY_PROCESSED') {
        return NextResponse.json({ success: false, error: 'Trade already processed' }, { status: 409 })
      }
      if (txErr.message.includes('LOST_PLAYER')) {
        await prisma.transaction.updateMany({ where: { notes: tradeId }, data: { status: 'REJECTED', processedAt: new Date() } })
        return NextResponse.json({ success: false, error: 'Trade invalidated: a player is no longer available' }, { status: 409 })
      }
      throw txErr
    }

    log('info', 'trade_accepted', { tradeId, proposerTeamId, receiverTeamId, receiverGets, proposerGets })
    return NextResponse.json({ success: true, message: 'Trade accepted and executed' })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    log('error', 'trade_accept_failed', { error: String(err) })
    return NextResponse.json({ success: false, error: 'Trade action failed' }, { status: 500 })
  }
}
