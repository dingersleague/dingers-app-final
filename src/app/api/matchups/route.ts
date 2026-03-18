import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, authError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic' // prevent static build-time evaluation

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.teamId || !user.leagueId) {
      return NextResponse.json({ success: false, error: 'No team' }, { status: 404 })
    }

    const weekParam = req.nextUrl.searchParams.get('week')
    const season = new Date().getFullYear()

    const league = await prisma.league.findUnique({ where: { id: user.leagueId } })
    if (!league) return NextResponse.json({ success: false, error: 'League not found' }, { status: 404 })

    const weekNumber = weekParam ? parseInt(weekParam) : league.currentWeek

    const week = await prisma.leagueWeek.findFirst({
      where: { leagueId: user.leagueId, weekNumber },
    })

    if (!week) {
      return NextResponse.json({ success: false, error: 'Week not found' }, { status: 404 })
    }

    const matchup = await prisma.matchup.findFirst({
      where: {
        weekId: week.id,
        OR: [{ homeTeamId: user.teamId }, { awayTeamId: user.teamId }],
      },
      include: {
        homeTeam: { select: { id: true, name: true, abbreviation: true } },
        awayTeam: { select: { id: true, name: true, abbreviation: true } },
      },
    })

    if (!matchup) {
      return NextResponse.json({ success: false, error: 'Matchup not found' }, { status: 404 })
    }

    // Get lineup + stats for both teams
    const getLineup = async (teamId: string) => {
      const slots = await prisma.lineupSlot.findMany({
        where: { matchupId: matchup.id, rosterSlot: { teamId } },
        include: {
          rosterSlot: {
            include: {
              player: {
                include: {
                  gameStats: {
                    where: { gameDate: { gte: week.startDate, lte: week.endDate } },
                  },
                  seasonStats: { where: { season }, take: 1 },
                },
              },
            },
          },
        },
      })

      return slots.map(s => ({
        position: s.position,
        isStarter: s.isStarter,
        player: {
          id: s.rosterSlot.player.id,
          fullName: s.rosterSlot.player.fullName,
          positions: s.rosterSlot.player.positions,
          mlbTeamAbbr: s.rosterSlot.player.mlbTeamAbbr,
          status: s.rosterSlot.player.status,
          seasonHR: s.rosterSlot.player.seasonStats[0]?.homeRuns ?? 0,
          weeklyHR: s.rosterSlot.player.gameStats.reduce((a: number, g: any) => a + g.homeRuns, 0),
        },
      }))
    }

    const [homeLineup, awayLineup] = await Promise.all([
      getLineup(matchup.homeTeamId),
      getLineup(matchup.awayTeamId),
    ])

    return NextResponse.json({
      success: true,
      data: {
        matchup: {
          id: matchup.id,
          weekNumber,
          status: matchup.status,
          homeScore: matchup.homeScore,
          awayScore: matchup.awayScore,
          winner: matchup.winner,
          homeTeam: matchup.homeTeam,
          awayTeam: matchup.awayTeam,
        },
        week: {
          startDate: week.startDate,
          endDate: week.endDate,
          isPlayoff: week.isPlayoff,
        },
        homeLineup,
        awayLineup,
      },
    })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    console.error('[matchups GET]', err)
    return NextResponse.json({ success: false, error: 'Failed to load matchup' }, { status: 500 })
  }
}
