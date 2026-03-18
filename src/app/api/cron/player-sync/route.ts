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
      const status = p.active ? 'ACTIVE' : 'INACTIVE'
      const positions = [p.primaryPosition.abbreviation]

      await prisma.player.upsert({
        where: { mlbId: p.id },
        create: {
          mlbId: p.id, fullName: p.fullName, firstName: p.firstName,
          lastName: p.lastName, positions, mlbTeamId: p.currentTeam?.id ?? null,
          mlbTeamName: p.currentTeam?.name ?? null,
          mlbTeamAbbr: p.currentTeam?.abbreviation ?? null, status,
          bats: p.batSide?.code ?? null, throws: p.pitchHand?.code ?? null,
          birthDate: p.birthDate ? new Date(p.birthDate) : null,
        },
        update: {
          fullName: p.fullName, positions, mlbTeamId: p.currentTeam?.id ?? null,
          mlbTeamName: p.currentTeam?.name ?? null,
          mlbTeamAbbr: p.currentTeam?.abbreviation ?? null, status,
        },
      })
      upserted++
    }

    const duration = Date.now() - start
    log('info', 'cron_player_sync_done', { upserted, duration })
    return NextResponse.json({ ok: true, upserted, duration })

  } catch (err) {
    log('error', 'cron_player_sync_failed', { error: String(err) })
    await prisma.syncLog.create({
      data: { type: 'roster', status: 'error', details: { error: String(err) }, duration: Date.now() - start },
    })
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
