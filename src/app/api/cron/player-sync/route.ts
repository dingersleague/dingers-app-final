import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchAllPlayers, MLBPlayer } from '@/lib/mlb-api'
import { log } from '@/lib/logger'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(req: NextRequest) {
  const isVercelCron = req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  const isManual = req.headers.get('x-cron-secret') === process.env.CRON_SECRET
  return isVercelCron || isManual
}

function cuid(): string {
  return 'c' + randomBytes(12).toString('hex')
}

async function bulkUpsertPlayers(players: MLBPlayer[]) {
  const BATCH_SIZE = 100
  const now = new Date()

  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE)
    const values: unknown[] = []
    const placeholders: string[] = []
    let paramIdx = 1

    for (const p of batch) {
      const status = p.active ? 'ACTIVE' : 'INACTIVE'
      const pos = p.primaryPosition.abbreviation

      placeholders.push(
        `($${paramIdx++}, $${paramIdx++}::int, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}::text[], $${paramIdx++}::int, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}::"PlayerStatus", $${paramIdx++}, $${paramIdx++}, $${paramIdx++}::timestamp, $${paramIdx++}::timestamp)`
      )
      values.push(
        cuid(),                                     // id
        p.id,                                       // mlbId
        p.fullName,                                 // fullName
        p.firstName,                                // firstName
        p.lastName,                                 // lastName
        [pos],                                      // positions
        p.currentTeam?.id ?? null,                  // mlbTeamId
        p.currentTeam?.name ?? null,                // mlbTeamName
        p.currentTeam?.abbreviation ?? null,        // mlbTeamAbbr
        status,                                     // status
        p.batSide?.code ?? null,                    // bats
        p.pitchHand?.code ?? null,                  // throws
        p.birthDate ? new Date(p.birthDate) : null, // birthDate
        now,                                        // updatedAt
      )
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO players (id, "mlbId", "fullName", "firstName", "lastName", positions, "mlbTeamId", "mlbTeamName", "mlbTeamAbbr", status, bats, throws, "birthDate", "updatedAt")
       VALUES ${placeholders.join(', ')}
       ON CONFLICT ("mlbId") DO UPDATE SET
         "fullName" = EXCLUDED."fullName",
         positions = EXCLUDED.positions,
         "mlbTeamId" = EXCLUDED."mlbTeamId",
         "mlbTeamName" = EXCLUDED."mlbTeamName",
         "mlbTeamAbbr" = EXCLUDED."mlbTeamAbbr",
         status = EXCLUDED.status,
         "updatedAt" = EXCLUDED."updatedAt"`,
      ...values,
    )
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  log('info', 'cron_player_sync_start', {})
  const start = Date.now()

  try {
    // Fetch team abbreviations first (MLB player endpoint doesn't include them)
    const teamsRes = await fetch('https://statsapi.mlb.com/api/v1/teams?sportId=1')
    const teamsData = await teamsRes.json()
    const teamAbbrMap: Record<number, string> = {}
    for (const t of (teamsData.teams ?? [])) {
      teamAbbrMap[t.id] = t.abbreviation
    }

    const players = await fetchAllPlayers(new Date().getFullYear())

    // Enrich players with team abbreviation
    for (const p of players) {
      if (p.currentTeam?.id && !p.currentTeam.abbreviation) {
        (p.currentTeam as any).abbreviation = teamAbbrMap[p.currentTeam.id] ?? null
      }
    }

    await bulkUpsertPlayers(players)

    const duration = Date.now() - start
    await prisma.syncLog.create({
      data: { type: 'roster', status: 'success', details: { synced: players.length }, duration },
    })
    log('info', 'cron_player_sync_done', { upserted: players.length, duration })
    return NextResponse.json({ ok: true, upserted: players.length, duration })

  } catch (err) {
    const duration = Date.now() - start
    log('error', 'cron_player_sync_failed', { error: String(err) })
    await prisma.syncLog.create({
      data: { type: 'roster', status: 'error', details: { error: String(err) }, duration },
    })
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
