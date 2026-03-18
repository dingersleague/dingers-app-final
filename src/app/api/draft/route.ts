import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { log } from '@/lib/logger'
import { LINEUP_POSITIONS } from '@/types'

export const dynamic = 'force-dynamic'

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

    const draftSettings = await prisma.draftSettings.findFirst({
      where: { leagueId },
    })

    if (!draftSettings) {
      return NextResponse.json({ success: false, error: 'No draft configured' }, { status: 404 })
    }

    // All picks with team and player info
    const picks = await prisma.draftPick.findMany({
      where: { draftSettingsId: draftSettings.id },
      include: {
        team: { select: { id: true, name: true, abbreviation: true } },
        player: {
          select: {
            id: true, fullName: true, positions: true, mlbTeamAbbr: true,
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
async function assignStartingPositions(leagueId: string) {
  const teams = await prisma.team.findMany({
    where: { leagueId },
    include: {
      rosterSlots: {
        where: { acquiredVia: 'DRAFT' },
        include: { player: true },
        orderBy: { acquiredAt: 'asc' }, // draft order
      },
    },
  })

  for (const team of teams) {
    const filled = new Set<string>()
    const starterSlots = ['C', '1B', '2B', 'SS', '3B', 'OF', 'OF', 'OF', 'UTIL']

    for (const slot of team.rosterSlots) {
      const playerPos = slot.player.positions

      // Try to fill a starter slot
      let assigned = false
      for (const targetPos of starterSlots) {
        const slotKey = `${targetPos}-${[...filled].filter(f => f.startsWith(targetPos)).length}`
        if (filled.has(slotKey)) continue

        const eligible = targetPos === 'UTIL'
          ? true // anyone can UTIL
          : playerPos.some(p => {
              if (targetPos === 'OF') return ['OF', 'LF', 'CF', 'RF'].includes(p)
              return p === targetPos
            })

        if (eligible) {
          await prisma.rosterSlot.update({
            where: { id: slot.id },
            data: { position: targetPos, slotType: 'STARTER' },
          })
          filled.add(slotKey)
          assigned = true
          break
        }
      }

      if (!assigned) {
        await prisma.rosterSlot.update({
          where: { id: slot.id },
          data: { position: 'BN', slotType: 'BENCH' },
        })
      }
    }
  }
}
