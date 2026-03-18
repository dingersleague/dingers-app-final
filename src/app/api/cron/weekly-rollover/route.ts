import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { finalizeWeek } from '@/lib/scoring'
import { log } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(req: NextRequest) {
  const isVercelCron = req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  const isManual = req.headers.get('x-cron-secret') === process.env.CRON_SECRET
  return isVercelCron || isManual
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  log('info', 'cron_weekly_rollover_start', {})

  const activeLeagues = await prisma.league.findMany({
    where: { status: { in: ['REGULAR_SEASON', 'PLAYOFFS'] } },
  })

  const results: Record<string, string> = {}

  for (const league of activeLeagues) {
    try {
      await finalizeWeek(league.id, league.currentWeek)
      results[league.id] = 'ok'
      log('info', 'cron_weekly_rollover_finalized', { leagueId: league.id, week: league.currentWeek })
    } catch (err) {
      results[league.id] = String(err)
      log('error', 'cron_weekly_rollover_failed', { leagueId: league.id, error: String(err) })
    }
  }

  log('info', 'cron_weekly_rollover_done', { leagues: activeLeagues.length })
  return NextResponse.json({ ok: true, results })
}
