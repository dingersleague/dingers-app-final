import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { log } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/**
 * POST /api/draft/autopick
 *
 * Called by any client when they detect the timer has expired.
 * The server validates that time is truly up before auto-picking.
 * Uses the same serializable transaction as manual picks, so only
 * the first caller succeeds — subsequent calls see the slot filled.
 */
export async function POST() {
  try {
    const user = await requireAuth()
    const userWithTeam = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { team: true },
    })
    if (!userWithTeam.team) {
      return NextResponse.json({ success: false, error: 'No team' }, { status: 400 })
    }

    const leagueId = userWithTeam.team.leagueId
    const draftSettings = await prisma.draftSettings.findFirstOrThrow({
      where: { leagueId },
    })

    if (draftSettings.status !== 'ACTIVE') {
      return NextResponse.json({ success: false, error: 'Draft not active' }, { status: 400 })
    }

    const result = await prisma.$transaction(async tx => {
      const pick = await tx.draftPick.findFirstOrThrow({
        where: { draftSettingsId: draftSettings.id, pickNumber: draftSettings.currentPick },
      })

      // Already picked (manual pick or another auto-pick raced ahead)
      if (pick.playerId) {
        return { skipped: true, reason: 'ALREADY_PICKED' }
      }

      // Verify timer has actually expired (server-authoritative)
      if (pick.nominatedAt) {
        const deadline = new Date(pick.nominatedAt.getTime() + draftSettings.timerSeconds * 1000)
        // Allow 2s grace period for network latency
        if (new Date() < new Date(deadline.getTime() - 2000)) {
          return { skipped: true, reason: 'TIMER_NOT_EXPIRED' }
        }
      }

      // Find best available player by season HR
      const draftedPlayerIds = await tx.draftPick.findMany({
        where: { draftSettingsId: draftSettings.id, playerId: { not: null } },
        select: { playerId: true },
      })
      const draftedIds = draftedPlayerIds.map(p => p.playerId).filter(Boolean) as string[]

      const bestPlayer = await tx.player.findFirst({
        where: {
          id: { notIn: draftedIds },
          status: 'ACTIVE',
          NOT: { positions: { hasSome: ['P', 'SP', 'RP'] } },
        },
        include: {
          seasonStats: { where: { season: new Date().getFullYear() }, take: 1 },
        },
        orderBy: { fullName: 'asc' }, // Prisma can't order by relation, we'll sort manually
      })

      // Actually get best by HR — fetch top candidates and pick the best
      const candidates = await tx.player.findMany({
        where: {
          id: { notIn: draftedIds },
          status: 'ACTIVE',
          NOT: { positions: { hasSome: ['P', 'SP', 'RP'] } },
        },
        include: {
          seasonStats: { where: { season: new Date().getFullYear() }, take: 1 },
        },
        take: 500,
      })

      const best = candidates
        .map(p => ({ ...p, hr: p.seasonStats[0]?.homeRuns ?? 0 }))
        .sort((a, b) => b.hr - a.hr)[0]

      if (!best) {
        return { skipped: true, reason: 'NO_PLAYERS_AVAILABLE' }
      }

      // Make the auto-pick
      await tx.draftPick.update({
        where: { id: pick.id },
        data: { playerId: best.id, pickedAt: new Date(), isAutoPick: true },
      })

      // Add to roster immediately
      await tx.rosterSlot.create({
        data: {
          teamId: pick.teamId,
          playerId: best.id,
          slotType: 'BENCH',
          position: 'BN',
          acquiredVia: 'DRAFT',
        },
      })

      const nextPickNumber = draftSettings.currentPick + 1
      const totalPicks = await tx.draftPick.count({
        where: { draftSettingsId: draftSettings.id },
      })

      if (nextPickNumber > totalPicks) {
        await tx.draftSettings.update({
          where: { id: draftSettings.id },
          data: { status: 'COMPLETE', completedAt: new Date(), currentPick: nextPickNumber },
        })
        await tx.league.update({
          where: { id: leagueId },
          data: { status: 'REGULAR_SEASON' },
        })
        return { done: true, playerId: best.id, playerName: best.fullName }
      }

      // Advance
      const nextPick = await tx.draftPick.findFirstOrThrow({
        where: { draftSettingsId: draftSettings.id, pickNumber: nextPickNumber },
      })
      await tx.draftPick.update({
        where: { id: nextPick.id },
        data: { nominatedAt: new Date() },
      })
      await tx.draftSettings.update({
        where: { id: draftSettings.id },
        data: { currentPick: nextPickNumber, currentRound: nextPick.round },
      })

      return { done: false, playerId: best.id, playerName: best.fullName }
    }, { isolationLevel: 'Serializable', timeout: 15_000 })

    if ('skipped' in result) {
      return NextResponse.json({ success: true, data: result })
    }

    log('info', 'draft_autopick', {
      leagueId,
      playerName: result.playerName,
      done: result.done,
    })

    // If draft just completed, handle post-draft
    if (result.done) {
      const { initializeWeekLineups } = await import('@/lib/scoring')
      const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })
      await initializeWeekLineups(leagueId, league.currentWeek)
      log('info', 'draft_complete', { leagueId })
    }

    return NextResponse.json({ success: true, data: result })
  } catch (err) {
    log('error', 'draft_autopick_failed', { error: String(err) })
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
