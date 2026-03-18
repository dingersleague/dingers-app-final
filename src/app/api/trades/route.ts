import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, authError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { log } from '@/lib/logger'
import { z } from 'zod'

export const dynamic = 'force-dynamic' // prevent static build-time evaluation

// GET /api/trades - list trades involving my team (grouped by tradeId)
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.teamId || !user.leagueId) {
      return NextResponse.json({ success: false, error: 'No team' }, { status: 404 })
    }

    // Get all trade transactions involving my team
    const tradeTxs = await prisma.transaction.findMany({
      where: {
        leagueId: user.leagueId,
        type: { in: ['TRADE_ADD', 'TRADE_DROP'] },
        OR: [{ teamId: user.teamId }, { relatedTeamId: user.teamId }],
        notes: { not: null },
      },
      include: {
        team: { select: { id: true, name: true } },
        player: { select: { id: true, fullName: true, positions: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    // Group by tradeId (notes field)
    const tradeMap = new Map<string, typeof tradeTxs>()
    for (const tx of tradeTxs) {
      if (!tx.notes) continue
      const list = tradeMap.get(tx.notes) ?? []
      list.push(tx)
      tradeMap.set(tx.notes, list)
    }

    const trades = [...tradeMap.entries()].map(([tradeId, txs]) => {
      const status = txs[0].status
      const createdAt = txs[0].createdAt

      // Find the two teams involved
      const teamIds = new Set(txs.map(t => t.teamId))
      const otherTeamId = [...teamIds].find(id => id !== user.teamId) ?? [...teamIds][0]

      // Players I get (TRADE_ADD where teamId = me)
      const iGet = txs.filter(t => t.type === 'TRADE_ADD' && t.teamId === user.teamId).map(t => t.player)
      // Players I give (TRADE_DROP where teamId = me)
      const iGive = txs.filter(t => t.type === 'TRADE_DROP' && t.teamId === user.teamId).map(t => t.player)
      // Other team name
      const otherTeam = txs.find(t => t.teamId === otherTeamId)?.team ?? txs.find(t => t.relatedTeamId === otherTeamId)?.team

      // Am I the one who needs to respond? (I'm the receiver if I have TRADE_DROP pending)
      const needsMyResponse = txs.some(t => t.type === 'TRADE_DROP' && t.teamId === user.teamId && t.status === 'PENDING')

      return {
        trade_id: tradeId,
        status,
        created_at: createdAt,
        other_team_name: otherTeam?.name ?? 'Unknown',
        i_get: iGet.map(p => ({ id: p.id, name: p.fullName })),
        i_give: iGive.map(p => ({ id: p.id, name: p.fullName })),
        needs_my_response: needsMyResponse,
      }
    })

    return NextResponse.json({ success: true, data: trades })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
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
