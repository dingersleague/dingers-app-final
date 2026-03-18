import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, authError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const UpdateSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  abbreviation: z.string().min(2).max(5).toUpperCase().optional(),
  logoUrl: z.string().max(200_000).nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  draftAutoPick: z.boolean().optional(),
})

// PATCH /api/team — update own team settings
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.teamId || !user.leagueId) {
      return NextResponse.json({ success: false, error: 'No team' }, { status: 404 })
    }

    const body = await req.json()
    const parsed = UpdateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0].message },
        { status: 400 },
      )
    }

    const data = parsed.data

    // If changing name, check uniqueness
    if (data.name) {
      const existing = await prisma.team.findFirst({
        where: { leagueId: user.leagueId, name: data.name, id: { not: user.teamId } },
      })
      if (existing) {
        return NextResponse.json(
          { success: false, error: 'A team with that name already exists' },
          { status: 409 },
        )
      }
    }

    const updated = await prisma.team.update({
      where: { id: user.teamId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.abbreviation !== undefined && { abbreviation: data.abbreviation }),
        ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
        ...(data.primaryColor !== undefined && { primaryColor: data.primaryColor }),
        ...(data.secondaryColor !== undefined && { secondaryColor: data.secondaryColor }),
        ...(data.draftAutoPick !== undefined && { draftAutoPick: data.draftAutoPick }),
      },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}

// GET /api/team — get own team details
export async function GET() {
  try {
    const user = await requireAuth()
    if (!user.teamId) {
      return NextResponse.json({ success: false, error: 'No team' }, { status: 404 })
    }

    const team = await prisma.team.findUniqueOrThrow({
      where: { id: user.teamId },
      select: {
        id: true, name: true, abbreviation: true,
        logoUrl: true, primaryColor: true, secondaryColor: true,
      },
    })

    return NextResponse.json({ success: true, data: team })
  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
