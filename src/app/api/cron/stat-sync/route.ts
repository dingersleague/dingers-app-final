import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchSchedule, fetchGameHRs } from '@/lib/mlb-api'
import { updateMatchupScores } from '@/lib/scoring'
import { log } from '@/lib/logger'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

function isAuthorized(req: NextRequest) {
  const isVercelCron = req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
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

    // 1. Fetch schedule (1 API call)
    const games = await fetchSchedule(yesterday, today)
    const completedGames = games.filter(g =>
      g.status.codedGameState === 'F' || g.status.detailedState === 'Final'
    )

    // 2. Check which games we already synced — skip those
    const completedGameIds = completedGames.map(g => g.gamePk)
    const alreadySynced = await prisma.playerGameStats.findMany({
      where: { mlbGameId: { in: completedGameIds } },
      select: { mlbGameId: true },
      distinct: ['mlbGameId'],
    })
    const syncedGameIds = new Set(alreadySynced.map(s => s.mlbGameId))

    const newGames = completedGames.filter(g => !syncedGameIds.has(g.gamePk))

    // 3. Only fetch box scores for new games (0-3 typically on 15-min cycle)
    let synced = 0
    for (const game of newGames) {
      // Time guard: bail if we're approaching the 10s limit
      if (Date.now() - start > 7000) {
        log('warn', 'cron_stat_sync_time_limit', { processed: synced, remaining: newGames.length - synced })
        break
      }

      try {
        const hrMap = await fetchGameHRs(game.gamePk)

        for (const [playerIdStr, hr] of Object.entries(hrMap)) {
          const mlbPlayerId = Number(playerIdStr)
          const player = await prisma.player.findUnique({ where: { mlbId: mlbPlayerId } })
          if (!player) continue

          await prisma.playerGameStats.upsert({
            where: { playerId_mlbGameId: { playerId: player.id, mlbGameId: game.gamePk } },
            create: {
              playerId: player.id, mlbGameId: game.gamePk,
              gameDate: new Date(game.gameDate.split('T')[0]), homeRuns: hr, synced: true,
            },
            update: { homeRuns: hr, synced: true },
          })
          synced++
        }

        // Also mark games with 0 HRs as synced (insert a placeholder so we skip next time)
        if (Object.keys(hrMap).length === 0) {
          // Use a sentinel: find any active player and insert 0 HR record
          const anyPlayer = await prisma.player.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } })
          if (anyPlayer) {
            await prisma.playerGameStats.upsert({
              where: { playerId_mlbGameId: { playerId: anyPlayer.id, mlbGameId: game.gamePk } },
              create: {
                playerId: anyPlayer.id, mlbGameId: game.gamePk,
                gameDate: new Date(game.gameDate.split('T')[0]), homeRuns: 0, synced: true,
              },
              update: {},
            })
          }
        }
      } catch (err) {
        log('warn', 'cron_stat_sync_game_failed', { gamePk: game.gamePk, error: String(err) })
      }
    }

    // 4. Only aggregate + update scores if we synced new data
    if (synced > 0) {
      const season = new Date().getFullYear()
      const aggregated = await prisma.playerGameStats.groupBy({
        by: ['playerId'],
        where: { gameDate: { gte: new Date(`${season}-01-01`) } },
        _sum: { homeRuns: true, atBats: true, hits: true },
        _count: { id: true },
      })

      const BATCH_SIZE = 50
      for (let i = 0; i < aggregated.length; i += BATCH_SIZE) {
        if (Date.now() - start > 8500) break // time guard
        const batch = aggregated.slice(i, i + BATCH_SIZE)
        await Promise.all(
          batch.map(agg =>
            prisma.playerSeasonStats.upsert({
              where: { playerId_season: { playerId: agg.playerId, season } },
              create: {
                playerId: agg.playerId, season,
                homeRuns: agg._sum.homeRuns ?? 0, gamesPlayed: agg._count.id,
                atBats: agg._sum.atBats ?? 0, hits: agg._sum.hits ?? 0,
              },
              update: {
                homeRuns: agg._sum.homeRuns ?? 0, gamesPlayed: agg._count.id,
                atBats: agg._sum.atBats ?? 0, hits: agg._sum.hits ?? 0,
                lastSynced: new Date(),
              },
            })
          )
        )
      }

      const activeLeagues = await prisma.league.findMany({
        where: { status: { in: ['REGULAR_SEASON', 'PLAYOFFS'] } },
      })
      await Promise.all(
        activeLeagues.map(league => updateMatchupScores(league.id, league.currentWeek))
      )
    }

    const duration = Date.now() - start
    await prisma.syncLog.create({
      data: { type: 'stats', status: 'success', details: { synced, newGames: newGames.length, totalCompleted: completedGames.length }, duration },
    })

    log('info', 'cron_stat_sync_done', { synced, newGames: newGames.length, duration })
    return NextResponse.json({ ok: true, synced, newGames: newGames.length, duration })

  } catch (err) {
    const duration = Date.now() - start
    log('error', 'cron_stat_sync_failed', { error: String(err), duration })
    await prisma.syncLog.create({
      data: { type: 'stats', status: 'error', details: { error: String(err) }, duration },
    })
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
