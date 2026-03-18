import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, authError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic' // prevent static build-time evaluation

const MAX_ROSTER = 14

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.teamId) return NextResponse.json({ success: false, error: 'No team' }, { status: 404 })

    const slots = await prisma.rosterSlot.findMany({
      where: { teamId: user.teamId },
      select: { playerId: true },
    })

    return NextResponse.json({
      success: true,
      data: {
        teamId: user.teamId,
        playerIds: slots.map(s => s.playerId),
        count: slots.length,
        isFull: slots.length >= MAX_ROSTER,
      },
    })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 })
  }
}
