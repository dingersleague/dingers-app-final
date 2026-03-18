import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { fetchHRsForDateRange } from '@/lib/mlb-api'
import { updateMatchupScores } from '@/lib/scoring'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic'

/**
 * POST /api/matchups/refresh
 *
 * Lightweight score refresh any owner can trigger.
 * Fetches today's + yesterday's completed game HRs from MLB API,
 * upserts game stats, and recalculates matchup scores.
 * Typically completes in 2-5 seconds.
 *
 * Rate limited: one refresh per 30 seconds per user (via simple time check).
 */

const lastRefresh = new Map<string, number>()
const COOLDOWN_MS = 30_000

export async function POST() {
  try {
    const user = await requireAuth()
    if (!user.teamId || !user.leagueId) {
      return NextResponse.json({ success: false, error: 'No team' }, { status: 400 })
    }

    // Simple rate limit
    const now = Date.now()
    const last = lastRefresh.get(user.id) ?? 0
    if (now - last < COOLDOWN_MS) {
      const waitSec = Math.ceil((COOLDOWN_MS - (now - last)) / 1000)
      return NextResponse.json({
        success: false,
        error: `Refresh available in ${waitSec}s`,
      }, { status: 429 })
    }
    lastRefresh.set(user.id, now)

    const start = Date.now()
    const today = format(new Date(), 'yyyy-MM-dd')
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')

    // Fetch HR data from MLB API
    const gameStats = await fetchHRsForDateRange(yesterday, today)
    let synced = 0

    for (const stat of gameStats) {
      const player = await prisma.player.findUnique({ where: { mlbId: stat.mlbPlayerId } })
      if (!player) continue

      await prisma.playerGameStats.upsert({
        where: { playerId_mlbGameId: { playerId: player.id, mlbGameId: stat.mlbGameId } },
        create: {
          playerId: player.id, mlbGameId: stat.mlbGameId,
          gameDate: new Date(stat.gameDate), homeRuns: stat.homeRuns, synced: true,
        },
        update: { homeRuns: stat.homeRuns, synced: true },
      })
      synced++
    }

    // Update matchup scores for the user's league
    const league = await prisma.league.findUniqueOrThrow({ where: { id: user.leagueId } })
    if (league.status === 'REGULAR_SEASON' || league.status === 'PLAYOFFS') {
      await updateMatchupScores(league.id, league.currentWeek)
    }

    const duration = Date.now() - start
    return NextResponse.json({
      success: true,
      data: { synced, duration },
    })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
