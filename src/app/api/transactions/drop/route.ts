import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, authError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export const dynamic = 'force-dynamic' // prevent static build-time evaluation

const DropSchema = z.object({
  playerId: z.string().cuid(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.teamId || !user.leagueId) {
      return NextResponse.json({ success: false, error: 'No team' }, { status: 404 })
    }

    const body = await req.json()
    const parsed = DropSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 })
    }

    const { playerId } = parsed.data

    const rosterSlot = await prisma.rosterSlot.findFirst({
      where: { playerId, teamId: user.teamId },
      include: { player: { select: { fullName: true } } },
    })

    if (!rosterSlot) {
      return NextResponse.json(
        { success: false, error: 'Player not on your roster' },
        { status: 404 }
      )
    }

    await prisma.$transaction(async tx => {
      // Remove from roster
      await tx.rosterSlot.delete({ where: { id: rosterSlot.id } })

      // Also remove from any active lineup slots
      await tx.lineupSlot.deleteMany({ where: { rosterSlotId: rosterSlot.id } })

      // Log transaction
      await tx.transaction.create({
        data: {
          leagueId: user.leagueId!,
          teamId: user.teamId!,
          type: 'DROP',
          playerId,
          status: 'PROCESSED',
          processedAt: new Date(),
        },
      })
    })

    return NextResponse.json({
      success: true,
      message: `${rosterSlot.player.fullName} dropped`,
    })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    console.error('[transactions/drop]', err)
    return NextResponse.json({ success: false, error: 'Transaction failed' }, { status: 500 })
  }
}
