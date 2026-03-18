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

// POST /api/trades - propose a trade
const TradeSchema = z.object({
  offerPlayerId: z.string().cuid(),
  receivePlayerId: z.string().cuid(),
  targetTeamId: z.string().cuid(),
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

    const { offerPlayerId, receivePlayerId, targetTeamId } = parsed.data

    if (targetTeamId === user.teamId) {
      return NextResponse.json({ success: false, error: 'Cannot trade with yourself' }, { status: 400 })
    }

    // Verify ownership at proposal time (informational — re-verified at accept time inside tx)
    const mySlot = await prisma.rosterSlot.findFirst({
      where: { playerId: offerPlayerId, teamId: user.teamId },
      include: { player: { select: { fullName: true } } },
    })
    if (!mySlot) {
      return NextResponse.json({ success: false, error: 'You do not own the offered player' }, { status: 400 })
    }

    const theirSlot = await prisma.rosterSlot.findFirst({
      where: { playerId: receivePlayerId, teamId: targetTeamId },
      include: { player: { select: { fullName: true } } },
    })
    if (!theirSlot) {
      return NextResponse.json({ success: false, error: 'Target team does not own that player' }, { status: 400 })
    }

    const tradeId = `trade:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    await prisma.transaction.createMany({
      data: [
        {
          leagueId: user.leagueId,
          teamId: user.teamId,
          type: 'TRADE_ADD',
          playerId: receivePlayerId,
          relatedPlayerId: offerPlayerId,
          relatedTeamId: targetTeamId,
          status: 'PENDING',
          notes: tradeId,
        },
        {
          leagueId: user.leagueId,
          teamId: targetTeamId,
          type: 'TRADE_DROP',
          playerId: receivePlayerId,
          relatedPlayerId: offerPlayerId,
          relatedTeamId: user.teamId,
          status: 'PENDING',
          notes: tradeId,
        },
      ],
    })

    log('info', 'trade_proposed', {
      tradeId,
      proposerTeamId: user.teamId,
      targetTeamId,
      offerPlayerId,
      receivePlayerId,
    })

    return NextResponse.json({
      success: true,
      message: `Trade proposed: ${mySlot.player.fullName} for ${theirSlot.player.fullName}`,
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

    // The players involved:
    //   proposerTx.playerId      = player proposer WANTS (currently on receiver's roster)
    //   proposerTx.relatedPlayerId = player proposer IS GIVING (currently on proposer's roster)
    const wantedPlayerId = proposerTx.playerId        // receiver currently owns this
    const givenPlayerId  = proposerTx.relatedPlayerId // proposer currently owns this
    const proposerTeamId = proposerTx.teamId
    const receiverTeamId = myTx.teamId

    try {
      await prisma.$transaction(async tx => {
        // ── Re-validate status inside tx (idempotency guard) ──────────────
        const freshTxs = await tx.transaction.findMany({
          where: { notes: tradeId },
          select: { status: true },
        })
        if (freshTxs.some(t => t.status !== 'PENDING')) {
          throw new Error('TRADE_ALREADY_PROCESSED')
        }

        // ── Re-validate ownership inside tx (TOCTOU fix) ──────────────────
        // Both checks use SELECT FOR UPDATE semantics via Prisma's serializable
        // isolation to prevent concurrent trades from swapping the same player.
        const receiverOwnsWanted = await tx.rosterSlot.findFirst({
          where: { playerId: wantedPlayerId, teamId: receiverTeamId },
        })
        if (!receiverOwnsWanted) {
          throw new Error('RECEIVER_LOST_PLAYER')
        }

        const proposerOwnsGiven = await tx.rosterSlot.findFirst({
          where: { playerId: givenPlayerId, teamId: proposerTeamId },
        })
        if (!proposerOwnsGiven) {
          throw new Error('PROPOSER_LOST_PLAYER')
        }

        // ── Execute swap ───────────────────────────────────────────────────
        // Proposer gets the wanted player
        await tx.rosterSlot.updateMany({
          where: { playerId: wantedPlayerId, teamId: receiverTeamId },
          data: { teamId: proposerTeamId, acquiredVia: 'TRADE' },
        })

        // Receiver gets the given player
        await tx.rosterSlot.updateMany({
          where: { playerId: givenPlayerId, teamId: proposerTeamId },
          data: { teamId: receiverTeamId, acquiredVia: 'TRADE' },
        })

        // Mark both transaction records processed
        await tx.transaction.updateMany({
          where: { notes: tradeId },
          data: { status: 'PROCESSED', processedAt: new Date() },
        })
      }, { isolationLevel: 'Serializable' })
    } catch (txErr: any) {
      if (txErr.message === 'TRADE_ALREADY_PROCESSED') {
        return NextResponse.json({ success: false, error: 'Trade already processed' }, { status: 409 })
      }
      if (txErr.message === 'RECEIVER_LOST_PLAYER') {
        // Reject the trade since the offered player is no longer available
        await prisma.transaction.updateMany({
          where: { notes: tradeId },
          data: { status: 'REJECTED', processedAt: new Date() },
        })
        log('warn', 'trade_accept_invalidated', { tradeId, reason: 'receiver_lost_player' })
        return NextResponse.json({ success: false, error: 'Trade invalidated: player no longer on your roster' }, { status: 409 })
      }
      if (txErr.message === 'PROPOSER_LOST_PLAYER') {
        await prisma.transaction.updateMany({
          where: { notes: tradeId },
          data: { status: 'REJECTED', processedAt: new Date() },
        })
        log('warn', 'trade_accept_invalidated', { tradeId, reason: 'proposer_lost_player' })
        return NextResponse.json({ success: false, error: 'Trade invalidated: offered player no longer available' }, { status: 409 })
      }
      throw txErr
    }

    log('info', 'trade_accepted', { tradeId, proposerTeamId, receiverTeamId, wantedPlayerId, givenPlayerId })
    return NextResponse.json({ success: true, message: 'Trade accepted and executed' })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    log('error', 'trade_accept_failed', { error: String(err) })
    return NextResponse.json({ success: false, error: 'Trade action failed' }, { status: 500 })
  }
}
