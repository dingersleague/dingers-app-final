import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
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

  log('info', 'cron_waiver_process_start', {})

  // Get all active leagues
  const leagues = await prisma.league.findMany({
    where: { status: { in: ['REGULAR_SEASON', 'PLAYOFFS'] } },
    select: { id: true, waiverType: true, faabAllowZeroBid: true },
  })

  let totalProcessed = 0

  for (const league of leagues) {
    // Get all pending waiver claims for this league, grouped by player
    const pendingClaims = await prisma.transaction.findMany({
      where: { leagueId: league.id, type: 'WAIVER_ADD', status: 'PENDING' },
      include: {
        team: { select: { id: true, faabBalance: true, waiverPriority: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Group by playerId
    const byPlayer = new Map<string, typeof pendingClaims>()
    for (const claim of pendingClaims) {
      const list = byPlayer.get(claim.playerId) ?? []
      list.push(claim)
      byPlayer.set(claim.playerId, list)
    }

    const processedPlayers = new Set<string>()

    for (const [playerId, claims] of byPlayer) {
      // Sort: FAAB by bid desc then createdAt asc, PRIORITY by priority asc
      const sorted = [...claims].sort((a, b) => {
        if (league.waiverType === 'FAAB') {
          if ((b.faabBid ?? 0) !== (a.faabBid ?? 0)) return (b.faabBid ?? 0) - (a.faabBid ?? 0)
        } else {
          if (a.team.waiverPriority !== b.team.waiverPriority)
            return a.team.waiverPriority - b.team.waiverPriority
        }
        return a.createdAt.getTime() - b.createdAt.getTime()
      })

      const winner = sorted[0]
      const losers = sorted.slice(1)

      await prisma.$transaction(async tx => {
        // Check player still available
        const alreadyOwned = await tx.rosterSlot.findFirst({ where: { playerId } })
        if (alreadyOwned) {
          // Reject all — player was added via free agency while claims were pending
          await tx.transaction.updateMany({
            where: { id: { in: claims.map(c => c.id) } },
            data: { status: 'REJECTED', processedAt: new Date() },
          })
          return
        }

        // Validate winner still has enough FAAB
        if (league.waiverType === 'FAAB') {
          const freshTeam = await tx.team.findUniqueOrThrow({
            where: { id: winner.teamId }, select: { faabBalance: true },
          })
          const minBid = league.faabAllowZeroBid ? 0 : 1
          if ((winner.faabBid ?? 0) < minBid || (winner.faabBid ?? 0) > freshTeam.faabBalance) {
            await tx.transaction.update({
              where: { id: winner.id },
              data: { status: 'REJECTED', processedAt: new Date() },
            })
            await tx.transaction.updateMany({
              where: { id: { in: losers.map(c => c.id) } },
              data: { status: 'REJECTED', processedAt: new Date() },
            })
            return
          }
          // Deduct FAAB atomically
          await tx.team.update({
            where: { id: winner.teamId },
            data: { faabBalance: { decrement: winner.faabBid ?? 0 } },
          })
        }

        // Add player to winner's roster
        await tx.rosterSlot.create({
          data: {
            teamId: winner.teamId, playerId,
            slotType: 'BENCH', position: 'BN', acquiredVia: 'WAIVER',
          },
        })

        // Handle drop if specified
        if (winner.relatedPlayerId) {
          await tx.rosterSlot.deleteMany({
            where: { teamId: winner.teamId, playerId: winner.relatedPlayerId },
          })
          await tx.transaction.create({
            data: {
              leagueId: league.id, teamId: winner.teamId,
              type: 'WAIVER_DROP', playerId: winner.relatedPlayerId,
              status: 'PROCESSED', processedAt: new Date(),
            },
          })
        }

        // Mark winner processed, losers rejected
        await tx.transaction.update({
          where: { id: winner.id },
          data: { status: 'PROCESSED', processedAt: new Date() },
        })
        await tx.transaction.updateMany({
          where: { id: { in: losers.map(c => c.id) } },
          data: { status: 'REJECTED', processedAt: new Date() },
        })
      }, { isolationLevel: 'Serializable' })

      processedPlayers.add(playerId)
      totalProcessed++
    }

    log('info', 'cron_waiver_process_league_done', {
      leagueId: league.id, players: processedPlayers.size,
    })
  }

  log('info', 'cron_waiver_process_done', { totalProcessed })
  return NextResponse.json({ ok: true, totalProcessed })
}
