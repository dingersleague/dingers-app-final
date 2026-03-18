import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { fetchSchedule, fetchGameHRs } from '@/lib/mlb-api'
import { updateMatchupScores } from '@/lib/scoring'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic'

/**
 * POST /api/matchups/refresh
 *
 * Lightweight score refresh any owner can trigger.
 * Only fetches box scores for games not yet synced.
 * Typically completes in 1-3 seconds.
 */

const lastRefresh = new Map<string, number>()
const COOLDOWN_MS = 30_000

export async function POST() {
  try {
    const user = await requireAuth()
    if (!user.teamId || !user.leagueId) {
      return NextResponse.json({ success: false, error: 'No team' }, { status: 400 })
    }

    const now = Date.now()
    const last = lastRefresh.get(user.id) ?? 0
    if (now - last < COOLDOWN_MS) {
      const waitSec = Math.ceil((COOLDOWN_MS - (now - last)) / 1000)
      return NextResponse.json({ success: false, error: `Refresh available in ${waitSec}s` }, { status: 429 })
    }
    lastRefresh.set(user.id, now)

    const start = Date.now()
    const today = format(new Date(), 'yyyy-MM-dd')
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')

    // Fetch schedule, find new completed games
    const games = await fetchSchedule(yesterday, today)
    const completed = games.filter(g => g.status.codedGameState === 'F' || g.status.detailedState === 'Final')

    const alreadySynced = await prisma.playerGameStats.findMany({
      where: { mlbGameId: { in: completed.map(g => g.gamePk) } },
      select: { mlbGameId: true },
      distinct: ['mlbGameId'],
    })
    const syncedIds = new Set(alreadySynced.map(s => s.mlbGameId))
    const newGames = completed.filter(g => !syncedIds.has(g.gamePk))

    let synced = 0
    for (const game of newGames) {
      if (Date.now() - start > 7000) break
      const hrMap = await fetchGameHRs(game.gamePk)
      for (const [pid, hr] of Object.entries(hrMap)) {
        const player = await prisma.player.findUnique({ where: { mlbId: Number(pid) } })
        if (!player) continue
        await prisma.playerGameStats.upsert({
          where: { playerId_mlbGameId: { playerId: player.id, mlbGameId: game.gamePk } },
          create: { playerId: player.id, mlbGameId: game.gamePk, gameDate: new Date(game.gameDate.split('T')[0]), homeRuns: hr, synced: true },
          update: { homeRuns: hr, synced: true },
        })
        synced++
      }
    }

    // Update matchup scores
    const league = await prisma.league.findUniqueOrThrow({ where: { id: user.leagueId } })
    if (league.status === 'REGULAR_SEASON' || league.status === 'PLAYOFFS') {
      await updateMatchupScores(league.id, league.currentWeek)
    }

    const duration = Date.now() - start
    return NextResponse.json({ success: true, data: { synced, newGames: newGames.length, duration } })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
