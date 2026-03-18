import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchAllPlayers } from '@/lib/mlb-api'
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

  log('info', 'cron_player_sync_start', {})
  const start = Date.now()

  try {
    const players = await fetchAllPlayers(new Date().getFullYear())
    let upserted = 0

    for (const p of players) {
      await prisma.player.upsert({
        where: { mlbId: p.mlbId },
        create: {
          mlbId: p.mlbId, fullName: p.fullName, firstName: p.firstName,
          lastName: p.lastName, positions: p.positions, mlbTeam: p.mlbTeam,
          mlbTeamAbbr: p.mlbTeamAbbr, status: p.status, batsHand: p.batsHand,
          throwsHand: p.throwsHand, birthDate: p.birthDate ? new Date(p.birthDate) : null,
        },
        update: {
          fullName: p.fullName, positions: p.positions, mlbTeam: p.mlbTeam,
          mlbTeamAbbr: p.mlbTeamAbbr, status: p.status,
        },
      })
      upserted++
    }

    const duration = Date.now() - start
    log('info', 'cron_player_sync_done', { upserted, duration })
    return NextResponse.json({ ok: true, upserted, duration })

  } catch (err) {
    log('error', 'cron_player_sync_failed', { error: String(err) })
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
