import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, authError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isWaiverWindowClosed } from '@/lib/roster-lock'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// POST /api/waivers — submit a waiver claim (FAAB blind bid or priority)
// Claims lock Monday 1 AM UTC. Processed Monday 1 AM. Reopen after Tuesday rollover.
const WaiverSchema = z.object({
  playerId: z.string().cuid(),
  dropPlayerId: z.string().cuid().optional(),
  faabBid: z.number().int().min(0).max(999).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.teamId || !user.leagueId) {
      return NextResponse.json({ success: false, error: 'No team' }, { status: 404 })
    }

    if (isWaiverWindowClosed()) {
      return NextResponse.json({
        success: false,
        error: 'Waiver claims are locked. Claims process Monday at 1 AM and reopen after Tuesday rollover.',
      }, { status: 423 })
    }

    const body = await req.json()
    const parsed = WaiverSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0].message },
        { status: 400 }
      )
    }

    const { playerId, dropPlayerId, faabBid } = parsed.data

    // Fetch league settings and team balance together
    const [league, team] = await Promise.all([
      prisma.league.findUniqueOrThrow({ where: { id: user.leagueId } }),
      prisma.team.findUniqueOrThrow({
        where: { id: user.teamId },
        select: { waiverPriority: true, faabBalance: true },
      }),
    ])

    // ── FAAB-specific validation ──────────────────────────────────────────────
    if (league.waiverType === 'FAAB') {
      if (faabBid === undefined || faabBid === null) {
        return NextResponse.json(
          { success: false, error: 'A bid amount is required for FAAB waivers' },
          { status: 400 }
        )
      }

      const minBid = league.faabAllowZeroBid ? 0 : 1
      if (faabBid < minBid) {
        return NextResponse.json(
          {
            success: false,
            error: league.faabAllowZeroBid
              ? 'Bid cannot be negative'
              : 'Minimum bid is $1. Enable $0 bids in commissioner settings if needed.',
          },
          { status: 400 }
        )
      }

      if (faabBid > team.faabBalance) {
        return NextResponse.json(
          {
            success: false,
            error: `Bid of $${faabBid} exceeds your remaining FAAB balance of $${team.faabBalance}`,
          },
          { status: 400 }
        )
      }
    }

    // ── Player availability check ─────────────────────────────────────────────
    const onRoster = await prisma.rosterSlot.findFirst({ where: { playerId } })
    if (onRoster) {
      const recentDrop = await prisma.transaction.findFirst({
        where: {
          playerId,
          type: { in: ['DROP', 'WAIVER_DROP'] },
          status: 'PROCESSED',
          processedAt: { gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { processedAt: 'desc' },
      })

      if (!recentDrop) {
        return NextResponse.json(
          { success: false, error: 'Player is on a roster and not on waivers' },
          { status: 409 }
        )
      }
    }

    // ── Duplicate claim guard ─────────────────────────────────────────────────
    const existing = await prisma.transaction.findFirst({
      where: { teamId: user.teamId, playerId, status: 'PENDING', type: 'WAIVER_ADD' },
    })
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'You already have a pending claim for this player' },
        { status: 409 }
      )
    }

    // ── Create the claim ──────────────────────────────────────────────────────
    await prisma.transaction.create({
      data: {
        leagueId: user.leagueId,
        teamId: user.teamId,
        type: 'WAIVER_ADD',
        playerId,
        relatedPlayerId: dropPlayerId ?? null,
        status: 'PENDING',
        waiverPriority: team.waiverPriority,
        // FAAB: bid stored here, deducted atomically when claim wins
        faabBid: league.waiverType === 'FAAB' ? (faabBid ?? null) : null,
      },
    })

    const message =
      league.waiverType === 'FAAB'
        ? `Claim submitted with $${faabBid} bid. Claims process Monday 1 AM — highest bid wins.`
        : 'Waiver claim submitted. Claims process Monday 1 AM in priority order.'

    return NextResponse.json({ success: true, message })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    console.error('[waivers POST]', err)
    return NextResponse.json({ success: false, error: 'Claim failed' }, { status: 500 })
  }
}

// DELETE /api/waivers?playerId=xxx — cancel a pending claim
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.teamId) return NextResponse.json({ success: false, error: 'No team' }, { status: 404 })

    if (isWaiverWindowClosed()) {
      return NextResponse.json({
        success: false,
        error: 'Waiver claims are locked and cannot be cancelled right now.',
      }, { status: 423 })
    }

    const { searchParams } = req.nextUrl
    const playerId = searchParams.get('playerId')
    if (!playerId) {
      return NextResponse.json({ success: false, error: 'playerId required' }, { status: 400 })
    }

    const deleted = await prisma.transaction.deleteMany({
      where: { teamId: user.teamId, playerId, status: 'PENDING', type: 'WAIVER_ADD' },
    })

    if (deleted.count === 0) {
      return NextResponse.json({ success: false, error: 'No pending claim found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'Waiver claim cancelled' })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 })
  }
}

// GET /api/waivers — pending claims + FAAB context + lock status
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.teamId || !user.leagueId) {
      return NextResponse.json({ success: false, error: 'No team' }, { status: 404 })
    }

    const { getTransactionWindowStatus } = await import('@/lib/roster-lock')
    const windowStatus = getTransactionWindowStatus()

    const [claims, team, league] = await Promise.all([
      prisma.transaction.findMany({
        where: { teamId: user.teamId, leagueId: user.leagueId, status: 'PENDING', type: 'WAIVER_ADD' },
        include: {
          player: { select: { fullName: true, positions: true, mlbTeamAbbr: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.team.findUniqueOrThrow({
        where: { id: user.teamId },
        select: { faabBalance: true, waiverPriority: true },
      }),
      prisma.league.findUniqueOrThrow({
        where: { id: user.leagueId },
        select: { waiverType: true, faabBudget: true, faabAllowZeroBid: true },
      }),
    ])

    const sortedClaims =
      league.waiverType === 'FAAB'
        ? [...claims].sort((a, b) => (b.faabBid ?? 0) - (a.faabBid ?? 0))
        : claims

    return NextResponse.json({
      success: true,
      data: {
        claims: sortedClaims,
        waiverType: league.waiverType,
        faabBalance: team.faabBalance,
        faabBudget: league.faabBudget,
        faabAllowZeroBid: league.faabAllowZeroBid,
        waiverPriority: team.waiverPriority,
        ...windowStatus,
      },
    })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 })
  }
}
