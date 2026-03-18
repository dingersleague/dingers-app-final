import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, authError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic' // prevent static build-time evaluation

// GET /api/faab — league-wide FAAB budget leaderboard
// Returns all teams with their current faabBalance and faabBudget (starting budget).
// Only meaningful when league.waiverType === 'FAAB'.
// All league members can see this — blind bidding means you don't know others' bids
// on specific claims, but seeing balances is standard in FAAB leagues.
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.leagueId) {
      return NextResponse.json({ success: false, error: 'No league' }, { status: 404 })
    }

    const [league, teams] = await Promise.all([
      prisma.league.findUniqueOrThrow({
        where: { id: user.leagueId },
        select: { waiverType: true, faabBudget: true, faabAllowZeroBid: true },
      }),
      prisma.team.findMany({
        where: { leagueId: user.leagueId },
        select: {
          id: true,
          name: true,
          abbreviation: true,
          faabBalance: true,
          // Count how much each team has spent: faabBudget - faabBalance
          // We derive this client-side rather than a raw query
        },
        orderBy: { faabBalance: 'desc' },
      }),
    ])

    const standings = teams.map((t: typeof teams[0]) => ({
      ...t,
      faabSpent: league.faabBudget - t.faabBalance,
      faabPct: league.faabBudget > 0
        ? Math.round((t.faabBalance / league.faabBudget) * 100)
        : 0,
      isMyTeam: user.teamId === t.id,
    }))

    return NextResponse.json({
      success: true,
      data: {
        waiverType: league.waiverType,
        faabBudget: league.faabBudget,
        faabAllowZeroBid: league.faabAllowZeroBid,
        teams: standings,
      },
    })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    console.error('[faab GET]', err)
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 })
  }
}
