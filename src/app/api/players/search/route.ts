import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, authError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export const dynamic = 'force-dynamic' // prevent static build-time evaluation

const SearchSchema = z.object({
  q: z.string().optional().default(''),
  position: z.string().optional().default('ALL'),
  availability: z.enum(['ALL', 'FREE_AGENT', 'ON_ROSTER']).optional().default('ALL'),
  limit: z.coerce.number().min(1).max(200).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
})

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()

    const params = Object.fromEntries(req.nextUrl.searchParams)
    const parsed = SearchSchema.safeParse(params)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid parameters' }, { status: 400 })
    }

    const { q, position, availability, limit, offset } = parsed.data
    const season = new Date().getFullYear()

    // Get all rostered player IDs for availability filtering
    const teamId = user.teamId

    const where: any = {}

    // Text search
    if (q.trim()) {
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { mlbTeamAbbr: { equals: q.toUpperCase() } },
      ]
    }

    // Position filter
    if (position && position !== 'ALL') {
      if (position === 'OF') {
        where.positions = { hasSome: ['OF', 'LF', 'CF', 'RF'] }
      } else {
        where.positions = { has: position }
      }
    }

    // Availability filter
    if (availability === 'FREE_AGENT') {
      where.rosterSlots = { none: {} }
    } else if (availability === 'ON_ROSTER') {
      where.rosterSlots = { some: {} }
    }

    const players = await prisma.player.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: [
        { seasonStats: { _count: 'desc' } },
        { fullName: 'asc' },
      ],
      include: {
        seasonStats: {
          where: { season },
          select: { homeRuns: true },
          take: 1,
        },
        rosterSlots: {
          select: {
            teamId: true,
            team: { select: { name: true } },
          },
          take: 1,
        },
      },
    })

    // Determine which free-agent players are in the 3-day waiver window.
    // These must be claimed via waiver (FAAB bid or priority), not an immediate free-agent add.
    const waiverCutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    const freeAgentIds = players.filter(p => p.rosterSlots.length === 0).map(p => p.id)
    const waiverPlayerIds = new Set<string>()

    if (freeAgentIds.length > 0) {
      const recentDrops = await prisma.transaction.findMany({
        where: {
          playerId: { in: freeAgentIds },
          type: { in: ['DROP', 'WAIVER_DROP'] },
          status: 'PROCESSED',
          processedAt: { gte: waiverCutoff },
        },
        select: { playerId: true },
        distinct: ['playerId'],
      })
      recentDrops.forEach(d => waiverPlayerIds.add(d.playerId))
    }

    const result = players.map(p => {
      const rosterSlot = p.rosterSlots[0]
      return {
        id: p.id,
        mlbId: p.mlbId,
        fullName: p.fullName,
        positions: p.positions,
        mlbTeamAbbr: p.mlbTeamAbbr,
        status: p.status,
        seasonHR: p.seasonStats[0]?.homeRuns ?? 0,
        isOnRoster: p.rosterSlots.length > 0,
        isOnWaivers: waiverPlayerIds.has(p.id),
        ownedByTeamId: rosterSlot?.teamId ?? null,
        ownedByTeamName: rosterSlot?.team?.name ?? null,
      }
    })

    return NextResponse.json({ success: true, data: result })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    console.error('[players/search]', err)
    return NextResponse.json({ success: false, error: 'Search failed' }, { status: 500 })
  }
}
