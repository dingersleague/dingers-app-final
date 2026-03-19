import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { log } from '@/lib/logger'
import { LINEUP_POSITIONS } from '@/types'
import { assignStartingPositions } from '@/lib/draft'

export const dynamic = 'force-dynamic'

// ─── Server-side auto-pick (runs inline during GET polling) ─────────────────

async function runServerAutoPick(
  draftSettingsId: string,
  currentPick: number,
  leagueId: string,
): Promise<{ skipped?: boolean; done?: boolean } | null> {
  const result = await prisma.$transaction(async tx => {
    const pick = await tx.draftPick.findFirstOrThrow({
      where: { draftSettingsId, pickNumber: currentPick },
    })

    if (pick.playerId) return { skipped: true }

    // Find best available by HR
    const draftedPlayerIds = await tx.draftPick.findMany({
      where: { draftSettingsId, playerId: { not: null } },
      select: { playerId: true },
    })
    const draftedIds = draftedPlayerIds.map(p => p.playerId).filter(Boolean) as string[]

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

    if (!best) return { skipped: true }

    await tx.draftPick.update({
      where: { id: pick.id },
      data: { playerId: best.id, pickedAt: new Date(), isAutoPick: true },
    })

    await tx.rosterSlot.create({
      data: {
        teamId: pick.teamId,
        playerId: best.id,
        slotType: 'BENCH',
        position: 'BN',
        acquiredVia: 'DRAFT',
      },
    })

    const nextPickNumber = currentPick + 1
    const totalPicks = await tx.draftPick.count({ where: { draftSettingsId } })

    if (nextPickNumber > totalPicks) {
      await tx.draftSettings.update({
        where: { id: draftSettingsId },
        data: { status: 'COMPLETE', completedAt: new Date(), currentPick: nextPickNumber },
      })
      await tx.league.update({
        where: { id: leagueId },
        data: { status: 'REGULAR_SEASON' },
      })
      return { done: true }
    }

    const nextPick = await tx.draftPick.findFirstOrThrow({
      where: { draftSettingsId, pickNumber: nextPickNumber },
    })
    await tx.draftPick.update({
      where: { id: nextPick.id },
      data: { nominatedAt: new Date() },
    })
    await tx.draftSettings.update({
      where: { id: draftSettingsId },
      data: { currentPick: nextPickNumber, currentRound: nextPick.round },
    })

    return { done: false }
  }, { isolationLevel: 'Serializable', timeout: 15_000 })

  // If draft completed, run post-draft setup
  if (result && 'done' in result && result.done) {
    const { assignStartingPositions } = await import('@/lib/draft')
    const { initializeWeekLineups } = await import('@/lib/scoring')
    const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })
    await assignStartingPositions(leagueId)
    await initializeWeekLineups(leagueId, league.currentWeek)
    log('info', 'draft_complete_via_server_autopick', { leagueId })
  }

  return result
}

// ─── GET /api/draft — Poll current draft state ─────────────────────────────

export async function GET() {
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
    const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })

    let draftSettings = await prisma.draftSettings.findFirst({
      where: { leagueId },
    })

    if (!draftSettings) {
      return NextResponse.json({ success: false, error: 'No draft configured' }, { status: 404 })
    }

    // ── Server-side auto-pick: if timer expired, pick before returning state ──
    // This ensures the draft progresses even if the picking team's client is offline.
    // Every polling client triggers this check, so the draft never stalls.
    if (draftSettings.status === 'ACTIVE') {
      let autoPickNeeded = true
      while (autoPickNeeded) {
        autoPickNeeded = false
        const curPick = await prisma.draftPick.findFirst({
          where: { draftSettingsId: draftSettings.id, pickNumber: draftSettings.currentPick },
        })

        if (curPick && !curPick.playerId && curPick.nominatedAt) {
          const deadline = new Date(curPick.nominatedAt.getTime() + draftSettings.timerSeconds * 1000)
          if (new Date() >= deadline) {
            try {
              const result = await runServerAutoPick(draftSettings.id, draftSettings.currentPick, leagueId)
              if (result && !result.skipped) {
                // Refresh draft settings and check if another pick also expired
                draftSettings = await prisma.draftSettings.findFirstOrThrow({ where: { leagueId } })
                if (!result.done && draftSettings.status === 'ACTIVE') {
                  autoPickNeeded = true // Check next pick too (might also be expired)
                }
              }
            } catch {
              // Failed — will retry on next poll
            }
          }
        }
      }
    }

    // All picks with team and player info
    const picks = await prisma.draftPick.findMany({
      where: { draftSettingsId: draftSettings.id },
      include: {
        team: { select: { id: true, name: true, abbreviation: true } },
        player: {
          select: {
            id: true, mlbId: true, fullName: true, positions: true, mlbTeamAbbr: true,
            seasonStats: { where: { season: new Date().getFullYear() }, take: 1 },
          },
        },
      },
      orderBy: { pickNumber: 'asc' },
    })

    // Current pick info
    const currentPick = picks.find(p => p.pickNumber === draftSettings.currentPick)

    // Timer: server-authoritative deadline
    let timerEndsAt: string | null = null
    if (draftSettings.status === 'ACTIVE' && currentPick?.nominatedAt) {
      const deadline = new Date(currentPick.nominatedAt.getTime() + draftSettings.timerSeconds * 1000)
      timerEndsAt = deadline.toISOString()
    }

    // Already-drafted player IDs for quick lookup
    const draftedPlayerIds = new Set(picks.filter(p => p.playerId).map(p => p.playerId))

    // Available players: not yet drafted, sorted by projected HR (season stats desc)
    const availablePlayers = await prisma.player.findMany({
      where: {
        id: { notIn: [...draftedPlayerIds].filter(Boolean) as string[] },
        status: 'ACTIVE',
        // Only hitters (exclude pitchers for a HR-only league)
        NOT: { positions: { hasSome: ['P', 'SP', 'RP'] } },
      },
      include: {
        seasonStats: { where: { season: new Date().getFullYear() }, take: 1 },
      },
      orderBy: { fullName: 'asc' },
    })

    // Sort by projected HR desc (season HR as proxy)
    const sortedAvailable = availablePlayers
      .map(p => ({
        id: p.id,
        mlbId: p.mlbId,
        fullName: p.fullName,
        positions: p.positions,
        mlbTeamAbbr: p.mlbTeamAbbr,
        status: p.status,
        seasonHR: p.seasonStats[0]?.homeRuns ?? 0,
      }))
      .sort((a, b) => b.seasonHR - a.seasonHR)

    const formattedPicks = picks.map(p => ({
      pickNumber: p.pickNumber,
      round: p.round,
      pickInRound: p.pickInRound,
      teamId: p.team.id,
      teamName: p.team.name,
      teamAbbr: p.team.abbreviation,
      player: p.player ? {
        id: p.player.id,
        mlbId: p.player.mlbId,
        fullName: p.player.fullName,
        positions: p.player.positions,
        mlbTeamAbbr: p.player.mlbTeamAbbr,
        seasonHR: p.player.seasonStats[0]?.homeRuns ?? 0,
      } : null,
      isAutoPick: p.isAutoPick,
      pickedAt: p.pickedAt,
    }))

    return NextResponse.json({
      success: true,
      data: {
        status: draftSettings.status,
        currentPick: draftSettings.currentPick,
        currentRound: draftSettings.currentRound,
        currentTeamId: currentPick?.team.id ?? null,
        currentTeamName: currentPick?.team.name ?? null,
        timerSeconds: draftSettings.timerSeconds,
        timerEndsAt,
        totalPicks: picks.length,
        myTeamId: userWithTeam.team.id,
        myAutoPick: userWithTeam.team.draftAutoPick,
        leagueStatus: league.status,
        picks: formattedPicks,
        availablePlayers: sortedAvailable,
      },
    })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}

// ─── POST /api/draft — Submit a pick ────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json()
    const { playerId, isAutoPick = false } = body

    if (!playerId) {
      return NextResponse.json({ success: false, error: 'playerId required' }, { status: 400 })
    }

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
      return NextResponse.json({ success: false, error: 'Draft is not active' }, { status: 400 })
    }

    // Execute pick inside serializable transaction
    const result = await prisma.$transaction(async tx => {
      const pick = await tx.draftPick.findFirstOrThrow({
        where: { draftSettingsId: draftSettings.id, pickNumber: draftSettings.currentPick },
      })

      // Guard: slot already filled
      if (pick.playerId) {
        return { error: 'PICK_ALREADY_MADE', status: 409 }
      }

      // Guard: wrong turn (only team on the clock or auto-pick can submit)
      if (!isAutoPick && pick.teamId !== userWithTeam.team!.id) {
        return { error: 'WRONG_TURN', status: 403 }
      }

      // Guard: player already drafted
      const alreadyDrafted = await tx.draftPick.findFirst({
        where: { draftSettingsId: draftSettings.id, playerId },
      })
      if (alreadyDrafted) {
        return { error: 'PLAYER_TAKEN', status: 409 }
      }

      // Make the pick
      await tx.draftPick.update({
        where: { id: pick.id },
        data: { playerId, pickedAt: new Date(), isAutoPick },
      })

      // Immediately add player to team's roster
      await tx.rosterSlot.create({
        data: {
          teamId: pick.teamId,
          playerId,
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
        // Draft complete
        await tx.draftSettings.update({
          where: { id: draftSettings.id },
          data: { status: 'COMPLETE', completedAt: new Date(), currentPick: nextPickNumber },
        })

        // Transition league to REGULAR_SEASON and initialize lineups
        await tx.league.update({
          where: { id: leagueId },
          data: { status: 'REGULAR_SEASON' },
        })

        return { done: true, pickNumber: pick.pickNumber }
      }

      // Advance to next pick
      const nextPick = await tx.draftPick.findFirstOrThrow({
        where: { draftSettingsId: draftSettings.id, pickNumber: nextPickNumber },
      })

      await tx.draftPick.update({
        where: { id: nextPick.id },
        data: { nominatedAt: new Date() },
      })

      const nextRound = nextPick.round
      await tx.draftSettings.update({
        where: { id: draftSettings.id },
        data: { currentPick: nextPickNumber, currentRound: nextRound },
      })

      return { done: false, pickNumber: pick.pickNumber }
    }, { isolationLevel: 'Serializable', timeout: 15_000 })

    if ('error' in result) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status })
    }

    const player = await prisma.player.findUnique({ where: { id: playerId }, select: { fullName: true } })
    log('info', 'draft_pick_made', {
      leagueId,
      pickNumber: result.pickNumber,
      playerId,
      playerName: player?.fullName,
      teamId: userWithTeam.team.id,
      isAutoPick,
    })

    // If draft just completed, initialize lineups
    if (result.done) {
      const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })
      // Assign starting positions to drafted players
      await assignStartingPositions(leagueId)
      // Import inline to avoid circular dep
      const { initializeWeekLineups } = await import('@/lib/scoring')
      await initializeWeekLineups(leagueId, league.currentWeek)
      log('info', 'draft_complete', { leagueId })
    }

    return NextResponse.json({ success: true, data: result })
  } catch (err) {
    log('error', 'draft_pick_failed', { error: String(err) })
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}

/**
 * After draft completes, assign starting positions to each team's roster.
 * Fills C, 1B, 2B, SS, 3B, OF, OF, OF, UTIL in draft order, rest go to BN.
 */
