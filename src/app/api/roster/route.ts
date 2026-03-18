import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, authError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isLineupLocked, getLineupLockTime } from '@/lib/scoring'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic' // prevent static build-time evaluation

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.teamId) {
      return NextResponse.json({ success: false, error: 'No team' }, { status: 404 })
    }

    const season = new Date().getFullYear()

    // Get current league week
    const league = await prisma.league.findFirst({
      where: { teams: { some: { id: user.teamId } } },
      include: {
        weeks: {
          where: { weekNumber: { gt: 0 } },
          orderBy: { weekNumber: 'desc' },
          take: 1,
        },
      },
    })

    const currentWeek = league?.weeks[0]

    // Get team roster with player stats
    const rosterSlots = await prisma.rosterSlot.findMany({
      where: { teamId: user.teamId },
      include: {
        player: {
          include: {
            seasonStats: {
              where: { season },
              take: 1,
            },
            gameStats: currentWeek ? {
              where: {
                gameDate: {
                  gte: currentWeek.startDate,
                  lte: currentWeek.endDate,
                },
              },
            } : false,
          },
        },
      },
    })

    // Get current matchup for lineup slots
    let lineupSlots: any[] = []
    let matchup: any = null

    if (currentWeek) {
      matchup = await prisma.matchup.findFirst({
        where: {
          weekId: currentWeek.id,
          OR: [{ homeTeamId: user.teamId }, { awayTeamId: user.teamId }],
        },
      })

      if (matchup) {
        lineupSlots = await prisma.lineupSlot.findMany({
          where: { matchupId: matchup.id, rosterSlot: { teamId: user.teamId } },
        })
      }
    }

    // Build lineup map: position -> rosterSlotId
    const lineupMap = new Map(lineupSlots.map(s => [s.rosterSlotId, s]))

    // Determine lock status
    const locked = currentWeek ? isLineupLocked(currentWeek.startDate) : false
    const lockTime = currentWeek ? getLineupLockTime(currentWeek.startDate) : null

    // Build full lineup structure
    const LINEUP_POSITIONS = ['C', '1B', '2B', 'SS', '3B', 'OF', 'OF', 'OF', 'UTIL', 'BN', 'BN', 'BN', 'BN', 'IL']

    const rosterPlayers = rosterSlots.map(slot => ({
      rosterSlotId: slot.id,
      position: slot.position ?? 'BN',
      isStarter: slot.slotType === 'STARTER',
      player: {
        id: slot.player.id,
        fullName: slot.player.fullName,
        positions: slot.player.positions,
        mlbTeamAbbr: slot.player.mlbTeamAbbr,
        status: slot.player.status,
        seasonHR: slot.player.seasonStats[0]?.homeRuns ?? 0,
      },
      weeklyHR: slot.player.gameStats
        ? slot.player.gameStats.reduce((s: number, g: any) => s + g.homeRuns, 0)
        : 0,
      locked: lineupMap.get(slot.id)?.locked ?? false,
    }))

    // Build lineup slots (ordered) — track used roster slots to prevent
    // the same player appearing in multiple slots of the same position (OF, BN)
    const usedRosterSlotIds = new Set<string>()
    const lineup = LINEUP_POSITIONS.map(pos => {
      const player = rosterPlayers.find(p =>
        p.position === pos &&
        !usedRosterSlotIds.has(p.rosterSlotId) &&
        (pos !== 'BN' ? p.isStarter : !p.isStarter)
      )
      if (player) usedRosterSlotIds.add(player.rosterSlotId)
      return { position: pos, player: player ?? null }
    })

    return NextResponse.json({
      success: true,
      data: {
        roster: rosterPlayers,
        lineup,
        isLocked: locked,
        lockTime: lockTime ? format(lockTime, 'MMM d, h:mm a') : null,
        matchupId: matchup?.id ?? null,
        weekNumber: currentWeek?.weekNumber ?? null,
      },
    })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    console.error('[roster GET]', err)
    return NextResponse.json({ success: false, error: 'Failed to load roster' }, { status: 500 })
  }
}
