import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchHRsForDateRange } from '@/lib/mlb-api'
import { updateMatchupScores } from '@/lib/scoring'
import { log } from '@/lib/logger'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(req: NextRequest) {
  // Vercel Cron sends this header automatically
  const isVercelCron = req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  // Also allow manual trigger from commissioner via x-cron-secret
  const isManual = req.headers.get('x-cron-secret') === process.env.CRON_SECRET
  return isVercelCron || isManual
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const start = Date.now()
  log('info', 'cron_stat_sync_start', {})

  try {
    const today = format(new Date(), 'yyyy-MM-dd')
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')

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

    // Aggregate season stats in a single groupBy query instead of N+1 loops
    const season = new Date().getFullYear()
    const aggregated = await prisma.playerGameStats.groupBy({
      by: ['playerId'],
      where: { gameDate: { gte: new Date(`${season}-01-01`) } },
      _sum: { homeRuns: true, atBats: true, hits: true },
      _count: { id: true },
    })

    // Batch upserts in groups of 50 for concurrency control
    const BATCH_SIZE = 50
    for (let i = 0; i < aggregated.length; i += BATCH_SIZE) {
      const batch = aggregated.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map((agg) =>
          prisma.playerSeasonStats.upsert({
            where: { playerId_season: { playerId: agg.playerId, season } },
            create: {
              playerId: agg.playerId, season,
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
        )
      )
    }

    // Update live matchup scores (parallel across leagues)
    const activeLeagues = await prisma.league.findMany({ where: { status: 'REGULAR_SEASON' } })
    await Promise.all(
      activeLeagues.map((league) => updateMatchupScores(league.id, league.currentWeek))
    )

    const duration = Date.now() - start
    await prisma.syncLog.create({
      data: { type: 'stats', status: 'success', details: { synced }, duration },
    })

    log('info', 'cron_stat_sync_done', { synced, duration })
    return NextResponse.json({ ok: true, synced, duration })

  } catch (err) {
    const duration = Date.now() - start
    log('error', 'cron_stat_sync_failed', { error: String(err), duration })
    await prisma.syncLog.create({
      data: { type: 'stats', status: 'error', details: { error: String(err) }, duration },
    })
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
