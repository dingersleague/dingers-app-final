import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, authError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isLineupLocked, canPlayInSlot } from '@/lib/scoring'
import { z } from 'zod'

export const dynamic = 'force-dynamic' // prevent static build-time evaluation

const LineupUpdateSchema = z.object({
  lineup: z.array(z.object({
    position: z.string(),
    rosterSlotId: z.string().nullable(),
  })),
})

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.teamId) {
      return NextResponse.json({ success: false, error: 'No team' }, { status: 404 })
    }

    const body = await req.json()
    const parsed = LineupUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid lineup data' }, { status: 400 })
    }

    // Get current matchup
    const league = await prisma.league.findFirst({
      where: { teams: { some: { id: user.teamId } } },
    })
    if (!league) return NextResponse.json({ success: false, error: 'League not found' }, { status: 404 })

    const currentWeek = await prisma.leagueWeek.findFirst({
      where: { leagueId: league.id, weekNumber: league.currentWeek },
    })
    if (!currentWeek) return NextResponse.json({ success: false, error: 'No active week' }, { status: 400 })

    // Check lineup lock
    if (isLineupLocked(currentWeek.startDate)) {
      return NextResponse.json(
        { success: false, error: 'Lineup is locked for this scoring period' },
        { status: 403 }
      )
    }

    const matchup = await prisma.matchup.findFirst({
      where: {
        weekId: currentWeek.id,
        OR: [{ homeTeamId: user.teamId }, { awayTeamId: user.teamId }],
      },
    })
    if (!matchup) return NextResponse.json({ success: false, error: 'No matchup found' }, { status: 404 })

    // Validate that all rosterSlotIds belong to this team
    const { lineup } = parsed.data
    const rosterSlotIds = lineup.filter(s => s.rosterSlotId).map(s => s.rosterSlotId!)

    const ownedSlots = await prisma.rosterSlot.findMany({
      where: { id: { in: rosterSlotIds }, teamId: user.teamId },
      include: { player: { select: { positions: true, fullName: true } } },
    })

    if (ownedSlots.length !== rosterSlotIds.length) {
      return NextResponse.json({ success: false, error: 'Invalid roster slots' }, { status: 400 })
    }

    const slotMap = new Map<string, typeof ownedSlots[0]>(ownedSlots.map(s => [s.id, s]))

    // Validate position eligibility
    for (const slot of lineup) {
      if (!slot.rosterSlotId) continue
      const rosterSlot = slotMap.get(slot.rosterSlotId)
      if (!rosterSlot) continue

      if (!canPlayInSlot(rosterSlot.player.positions, slot.position)) {
        return NextResponse.json({
          success: false,
          error: `${rosterSlot.player.fullName} is not eligible for the ${slot.position} slot`,
        }, { status: 400 })
      }
    }

    // Update lineup slots and roster slot types in transaction
    await prisma.$transaction(async tx => {
      for (const slot of lineup) {
        if (!slot.rosterSlotId) continue

        const isBench = slot.position === 'BN'

        // Update lineup slot
        await tx.lineupSlot.upsert({
          where: {
            matchupId_rosterSlotId: {
              matchupId: matchup.id,
              rosterSlotId: slot.rosterSlotId,
            },
          },
          create: {
            matchupId: matchup.id,
            rosterSlotId: slot.rosterSlotId,
            position: slot.position,
            isStarter: !isBench,
          },
          update: {
            position: slot.position,
            isStarter: !isBench,
          },
        })

        // Update roster slot type
        await tx.rosterSlot.update({
          where: { id: slot.rosterSlotId },
          data: {
            slotType: isBench ? 'BENCH' : 'STARTER',
            position: slot.position,
          },
        })
      }
    })

    return NextResponse.json({ success: true, message: 'Lineup saved' })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    console.error('[lineup PUT]', err)
    return NextResponse.json({ success: false, error: 'Failed to save lineup' }, { status: 500 })
  }
}
