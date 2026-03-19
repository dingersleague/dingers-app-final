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

    // Support viewing another team's roster (for trades)
    const { searchParams } = req.nextUrl
    const viewTeamId = searchParams.get('teamId') || user.teamId

    const season = new Date().getFullYear()

    // Get current league week
    const league = await prisma.league.findFirst({
      where: { teams: { some: { id: viewTeamId } } },
    })

    const currentWeek = league ? await prisma.leagueWeek.findFirst({
      where: { leagueId: league.id, weekNumber: league.currentWeek },
    }) : null

    // Get team roster with player stats
    const rosterSlots = await prisma.rosterSlot.findMany({
      where: { teamId: viewTeamId },
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
          OR: [{ homeTeamId: viewTeamId }, { awayTeamId: viewTeamId }],
        },
      })

      if (matchup) {
        lineupSlots = await prisma.lineupSlot.findMany({
          where: { matchupId: matchup.id, rosterSlot: { teamId: viewTeamId } },
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

    // Fetch MLB schedule for the current week (games per team)
    let teamSchedules: Record<string, Array<{ date: string; opponent: string; home: boolean }>> = {}
    if (currentWeek) {
      try {
        const startDate = format(new Date(currentWeek.startDate), 'yyyy-MM-dd')
        const endDate = format(new Date(currentWeek.endDate), 'yyyy-MM-dd')
        const schedRes = await fetch(
          `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&hydrate=team&gameType=R`,
          { next: { revalidate: 3600 } }
        )
        const schedData = await schedRes.json()
        const games = (schedData.dates ?? []).flatMap((d: any) => d.games ?? [])

        for (const game of games) {
          const homeAbbr = game.teams?.home?.team?.abbreviation
          const awayAbbr = game.teams?.away?.team?.abbreviation
          const gameDate = game.gameDate?.split('T')[0] ?? ''

          if (homeAbbr) {
            if (!teamSchedules[homeAbbr]) teamSchedules[homeAbbr] = []
            teamSchedules[homeAbbr].push({ date: gameDate, opponent: awayAbbr ?? '?', home: true })
          }
          if (awayAbbr) {
            if (!teamSchedules[awayAbbr]) teamSchedules[awayAbbr] = []
            teamSchedules[awayAbbr].push({ date: gameDate, opponent: homeAbbr ?? '?', home: false })
          }
        }
      } catch {
        // Schedule fetch failed — continue without it
      }
    }

    // Fetch MLB injury report for rostered players
    let playerNotes: Record<string, string> = {}
    try {
      const injRes = await fetch(
        'https://statsapi.mlb.com/api/v1/injuries?sportId=1',
        { next: { revalidate: 3600 } }
      )
      const injData = await injRes.json()
      const mlbIds = new Set(rosterSlots.map(s => s.player.mlbId))
      for (const inj of (injData.injuries ?? [])) {
        if (mlbIds.has(inj.player?.id)) {
          const note = [inj.description, inj.status].filter(Boolean).join(' — ')
          if (note) playerNotes[inj.player.id] = note
        }
      }
    } catch {
      // Injury fetch failed — continue without it
    }

    // Add schedule and notes to player data
    const enrichedRoster = rosterPlayers.map(rp => {
      const slot = rosterSlots.find(s => s.id === rp.rosterSlotId)
      const mlbTeamAbbr = slot?.player.mlbTeamAbbr
      const mlbId = slot?.player.mlbId
      const games = mlbTeamAbbr ? (teamSchedules[mlbTeamAbbr] ?? []) : []
      return {
        ...rp,
        player: {
          ...rp.player,
          gamesThisWeek: games.length,
          schedule: games.slice(0, 7).map(g => ({
            date: g.date,
            opponent: g.home ? `vs ${g.opponent}` : `@ ${g.opponent}`,
          })),
          news: mlbId ? (playerNotes[mlbId] ?? null) : null,
        },
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        roster: enrichedRoster,
        lineup,
        isLocked: locked,
        lockTime: lockTime ? format(lockTime, 'MMM d, h:mm a') : null,
        matchupId: matchup?.id ?? null,
        weekNumber: currentWeek?.weekNumber ?? null,
        weekStart: currentWeek ? format(new Date(currentWeek.startDate), 'MMM d') : null,
        weekEnd: currentWeek ? format(new Date(currentWeek.endDate), 'MMM d') : null,
      },
    })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    console.error('[roster GET]', err)
    return NextResponse.json({ success: false, error: 'Failed to load roster' }, { status: 500 })
  }
}
