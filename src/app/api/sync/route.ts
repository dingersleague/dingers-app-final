import { NextRequest, NextResponse } from 'next/server'
import { requireCommissioner, authError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { fetchHRsForDateRange } from '@/lib/mlb-api'
import { updateMatchupScores } from '@/lib/scoring'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic' // prevent static build-time evaluation

// POST /api/sync - Trigger a manual stat sync
// Requires commissioner role (or internal cron header)
export async function POST(req: NextRequest) {
  // Allow internal cron calls via a secret header
  const cronSecret = req.headers.get('x-cron-secret')
  const isInternalCron = cronSecret === process.env.CRON_SECRET

  if (!isInternalCron) {
    try {
      await requireCommissioner()
    } catch (err: any) {
      if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
      if (err.message === 'UNAUTHORIZED') return authError('UNAUTHORIZED')
    }
  }

  const start = Date.now()

  try {
    const today = format(new Date(), 'yyyy-MM-dd')
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')

    const gameStats = await fetchHRsForDateRange(yesterday, today)
    let synced = 0

    for (const stat of gameStats) {
      const player = await prisma.player.findUnique({
        where: { mlbId: stat.mlbPlayerId },
      })
      if (!player) continue

      await prisma.playerGameStats.upsert({
        where: {
          playerId_mlbGameId: { playerId: player.id, mlbGameId: stat.mlbGameId },
        },
        create: {
          playerId: player.id,
          mlbGameId: stat.mlbGameId,
          gameDate: new Date(stat.gameDate),
          homeRuns: stat.homeRuns,
          synced: true,
        },
        update: {
          homeRuns: stat.homeRuns,
          synced: true,
        },
      })
      synced++
    }

    // Aggregate season stats for all players
    const season = new Date().getFullYear()
    const players = await prisma.player.findMany({ select: { id: true } })
    for (const p of players) {
      const agg = await prisma.playerGameStats.aggregate({
        where: { playerId: p.id, gameDate: { gte: new Date(`${season}-01-01`) } },
        _sum: { homeRuns: true, atBats: true, hits: true },
        _count: { id: true },
      })

      if (agg._count.id > 0) {
        await prisma.playerSeasonStats.upsert({
          where: { playerId_season: { playerId: p.id, season } },
          create: {
            playerId: p.id, season,
            homeRuns: agg._sum.homeRuns ?? 0,
            gamesPlayed: agg._count.id,
            atBats: agg._sum.atBats ?? 0,
            hits: agg._sum.hits ?? 0,
          },
          update: {
            homeRuns: agg._sum.homeRuns ?? 0,
            gamesPlayed: agg._count.id,
            atBats: agg._sum.atBats ?? 0,
            hits: agg._sum.hits ?? 0,
            lastSynced: new Date(),
          },
        })
      }
    }

    // Update matchup scores for all active leagues
    const activeLeagues = await prisma.league.findMany({
      where: { status: 'REGULAR_SEASON' },
    })

    for (const league of activeLeagues) {
      await updateMatchupScores(league.id, league.currentWeek)
    }

    const duration = Date.now() - start

    await prisma.syncLog.create({
      data: { type: 'stats', status: 'success', details: { synced }, duration },
    })

    return NextResponse.json({
      success: true,
      data: { synced, duration },
      message: `Synced ${synced} game stat records in ${duration}ms`,
    })

  } catch (err) {
    const duration = Date.now() - start
    await prisma.syncLog.create({
      data: { type: 'stats', status: 'error', details: { error: String(err) }, duration },
    })
    console.error('[sync]', err)
    return NextResponse.json({ success: false, error: 'Sync failed' }, { status: 500 })
  }
}

// GET /api/sync - Check sync status / last sync time
export async function GET() {
  try {
    await requireCommissioner()

    const lastSync = await prisma.syncLog.findFirst({
      where: { type: 'stats' },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      success: true,
      data: {
        lastSync: lastSync?.createdAt ?? null,
        lastStatus: lastSync?.status ?? null,
        lastDetails: lastSync?.details ?? null,
      },
    })
  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    return authError('UNAUTHORIZED')
  }
}
