import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, authError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic' // prevent static build-time evaluation

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.leagueId) return NextResponse.json({ success: false, error: 'No league' }, { status: 404 })

    const teams = await prisma.team.findMany({
      where: { leagueId: user.leagueId },
      orderBy: [{ wins: 'desc' }, { pointsFor: 'desc' }],
      include: {
        user: { select: { name: true } },
        homeMatchups: {
          where: { status: 'COMPLETE' },
          orderBy: { weekNumber: 'desc' },
          take: 5,
          select: { homeScore: true, awayScore: true },
        },
        awayMatchups: {
          where: { status: 'COMPLETE' },
          orderBy: { weekNumber: 'desc' },
          take: 5,
          select: { homeScore: true, awayScore: true },
        },
      },
    })

    const standings = teams.map((team, i) => {
      const gp = team.wins + team.losses + team.ties
      const last5 = [
        ...team.homeMatchups.map(m => m.homeScore > m.awayScore ? 'W' : m.homeScore < m.awayScore ? 'L' : 'T'),
        ...team.awayMatchups.map(m => m.awayScore > m.homeScore ? 'W' : m.awayScore < m.homeScore ? 'L' : 'T'),
      ].slice(0, 5)

      let streak = '-'
      if (last5.length > 0) {
        let count = 1
        for (let j = 1; j < last5.length; j++) {
          if (last5[j] === last5[0]) count++
          else break
        }
        streak = `${last5[0]}${count}`
      }

      return {
        rank: i + 1,
        team: {
          id: team.id,
          name: team.name,
          abbreviation: team.abbreviation,
          logoUrl: team.logoUrl,
          ownerName: team.user.name,
        },
        wins: team.wins,
        losses: team.losses,
        ties: team.ties,
        pct: gp > 0 ? team.wins / gp : 0,
        pointsFor: team.pointsFor,
        pointsAgainst: team.pointsAgainst,
        streak,
        last5,
      }
    })

    return NextResponse.json({ success: true, data: standings })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 })
  }
}
