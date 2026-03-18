import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, authError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isRosterLocked, isFreeAgencyWindowOpen } from '@/lib/roster-lock'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const MAX_ROSTER_SIZE = 14 // 9 starters + 4 bench + 1 IL

const AddSchema = z.object({
  playerId: z.string().cuid(),
  dropPlayerId: z.string().cuid().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.teamId || !user.leagueId) {
      return NextResponse.json({ success: false, error: 'No team or league' }, { status: 404 })
    }

    if (isRosterLocked()) {
      return NextResponse.json({
        success: false,
        error: 'Roster moves are locked. Rosters unlock after Tuesday rollover.',
      }, { status: 423 })
    }

    // All adds go through waivers unless it's the free agency window (Monday 1AM-noon)
    if (!isFreeAgencyWindowOpen()) {
      return NextResponse.json({
        success: false,
        error: 'All player adds must go through waivers. Submit a waiver claim instead. Free agent pickups are available Monday 1AM-noon UTC.',
      }, { status: 423 })
    }

    const body = await req.json()
    const parsed = AddSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 })
    }

    const { playerId, dropPlayerId } = parsed.data

    // Verify player exists
    const player = await prisma.player.findUnique({ where: { id: playerId } })
    if (!player) {
      return NextResponse.json({ success: false, error: 'Player not found' }, { status: 404 })
    }

    // Check player is not already rostered (anywhere)
    const alreadyRostered = await prisma.rosterSlot.findFirst({
      where: { playerId },
      include: { team: { select: { name: true } } },
    })

    if (alreadyRostered) {
      return NextResponse.json({
        success: false,
        error: `${player.fullName} is already on ${alreadyRostered.team.name}'s roster`,
      }, { status: 409 })
    }

    // Check current roster size
    const currentRosterSize = await prisma.rosterSlot.count({
      where: { teamId: user.teamId },
    })

    if (currentRosterSize >= MAX_ROSTER_SIZE) {
      if (!dropPlayerId) {
        return NextResponse.json({
          success: false,
          error: 'Roster is full. You must drop a player to add this one.',
          requiresDrop: true,
        }, { status: 400 })
      }

      // Verify the drop player is on this team
      const dropSlot = await prisma.rosterSlot.findFirst({
        where: { playerId: dropPlayerId, teamId: user.teamId },
        include: { player: { select: { fullName: true } } },
      })

      if (!dropSlot) {
        return NextResponse.json({
          success: false,
          error: 'Drop player not found on your roster',
        }, { status: 404 })
      }
    }

    // Execute in transaction
    await prisma.$transaction(async tx => {
      // Drop player if needed
      if (dropPlayerId && currentRosterSize >= MAX_ROSTER_SIZE) {
        await tx.rosterSlot.deleteMany({
          where: { playerId: dropPlayerId!, teamId: user.teamId! },
        })

        await tx.transaction.create({
          data: {
            leagueId: user.leagueId!,
            teamId: user.teamId!,
            type: 'DROP',
            playerId: dropPlayerId!,
            status: 'PROCESSED',
            processedAt: new Date(),
          },
        })
      }

      // Add player to bench
      await tx.rosterSlot.create({
        data: {
          teamId: user.teamId!,
          playerId,
          slotType: 'BENCH',
          position: 'BN',
          acquiredVia: 'FREE_AGENT',
        },
      })

      // Log the add transaction
      await tx.transaction.create({
        data: {
          leagueId: user.leagueId!,
          teamId: user.teamId!,
          type: 'ADD',
          playerId,
          relatedPlayerId: dropPlayerId ?? null,
          status: 'PROCESSED',
          processedAt: new Date(),
        },
      })
    })

    return NextResponse.json({
      success: true,
      message: `${player.fullName} added to your roster`,
    })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    console.error('[transactions/add]', err)
    return NextResponse.json({ success: false, error: 'Transaction failed' }, { status: 500 })
  }
}
