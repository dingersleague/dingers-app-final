import { NextRequest, NextResponse } from 'next/server'
import { requireCommissioner, authError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateSeasonSchedule, finalizeWeek, initializeWeekLineups } from '@/lib/scoring'
import { z } from 'zod'

export const dynamic = 'force-dynamic' // prevent static build-time evaluation

// GET /api/admin - League summary for commissioner
export async function GET(req: NextRequest) {
  try {
    const user = await requireCommissioner()

    const league = await prisma.league.findFirst({
      include: {
        teams: {
          include: {
            user: { select: { email: true, name: true } },
            _count: { select: { rosterSlots: true } },
          },
          orderBy: { waiverPriority: 'asc' },
        },
        draftSettings: true,
        weeks: { orderBy: { weekNumber: 'asc' } },
        _count: { select: { transactions: true } },
      },
    })

    const recentSyncLogs = await prisma.syncLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    return NextResponse.json({
      success: true,
      data: { league, recentSyncLogs },
    })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    return authError('UNAUTHORIZED')
  }
}

// PATCH /api/admin - Update league settings
const LeagueUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  status: z.enum(['SETUP', 'PREDRAFT', 'DRAFT', 'REGULAR_SEASON', 'PLAYOFFS', 'OFFSEASON']).optional(),
  currentWeek: z.number().int().min(0).optional(),
  waiverType: z.enum(['PRIORITY', 'FAAB', 'FREE_AGENCY']).optional(),
  faabBudget: z.number().int().min(1).max(9999).optional(),
  faabAllowZeroBid: z.boolean().optional(),
  lineupLockDay: z.string().optional(),
  lineupLockHour: z.number().int().min(0).max(23).optional(),
})

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireCommissioner()

    const body = await req.json()
    const parsed = LeagueUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 })
    }

    const league = await prisma.league.findFirst()
    if (!league) return NextResponse.json({ success: false, error: 'No league' }, { status: 404 })

    const updated = await prisma.league.update({
      where: { id: league.id },
      data: parsed.data,
    })

    return NextResponse.json({ success: true, data: updated })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    return authError('UNAUTHORIZED')
  }
}

// POST /api/admin/schedule - Generate season schedule
export async function POST(req: NextRequest) {
  try {
    const user = await requireCommissioner()

    const body = await req.json()
    const { action } = body

    const league = await prisma.league.findFirst()
    if (!league) return NextResponse.json({ success: false, error: 'No league' }, { status: 404 })

    if (action === 'generate_schedule') {
      const { seasonStartDate } = body
      if (!seasonStartDate) {
        return NextResponse.json({ success: false, error: 'seasonStartDate required' }, { status: 400 })
      }

      // Check if schedule already exists
      const existingWeeks = await prisma.leagueWeek.count({ where: { leagueId: league.id } })
      if (existingWeeks > 0) {
        return NextResponse.json({ success: false, error: 'Schedule already exists' }, { status: 409 })
      }

      await generateSeasonSchedule(league.id, league.season, new Date(seasonStartDate))

      await prisma.league.update({
        where: { id: league.id },
        data: { status: 'PREDRAFT', currentWeek: 1 },
      })

      return NextResponse.json({ success: true, message: 'Schedule generated' })
    }

    if (action === 'setup_draft') {
      const { draftOrder, timerSeconds = 90 } = body

      // Validate draft order = array of teamIds
      if (!Array.isArray(draftOrder) || draftOrder.length !== 12) {
        return NextResponse.json({ success: false, error: 'draftOrder must be array of 12 team IDs' }, { status: 400 })
      }

      const teams = await prisma.team.findMany({ where: { leagueId: league.id } })
      if (teams.length !== 12) {
        return NextResponse.json({ success: false, error: 'Need 12 teams to set draft' }, { status: 400 })
      }

      const ROUNDS = 13  // 13-man roster
      const TEAMS = 12
      const TOTAL_PICKS = ROUNDS * TEAMS

      // Build snake draft pick order
      // Round 1: 1-12, Round 2: 12-1, Round 3: 1-12, etc.
      const pickData: { teamId: string; round: number; pickNumber: number; pickInRound: number }[] = []
      let pickNumber = 1

      for (let round = 1; round <= ROUNDS; round++) {
        const roundOrder = round % 2 === 1 ? [...draftOrder] : [...draftOrder].reverse()
        for (let i = 0; i < roundOrder.length; i++) {
          pickData.push({
            teamId: roundOrder[i],
            round,
            pickNumber: pickNumber++,
            pickInRound: i + 1,
          })
        }
      }

      // Create draft settings
      let draftSettings = await prisma.draftSettings.findFirst({
        where: { leagueId: league.id },
      })

      if (draftSettings) {
        // Reset
        await prisma.draftPick.deleteMany({ where: { draftSettingsId: draftSettings.id } })
        await prisma.draftSettings.update({
          where: { id: draftSettings.id },
          data: { status: 'PENDING', currentPick: 1, currentRound: 1, timerSeconds },
        })
      } else {
        draftSettings = await prisma.draftSettings.create({
          data: {
            leagueId: league.id,
            type: 'SNAKE',
            status: 'PENDING',
            timerSeconds,
            currentPick: 1,
            currentRound: 1,
          },
        })
      }

      await prisma.draftPick.createMany({
        data: pickData.map(p => ({ ...p, draftSettingsId: draftSettings!.id })),
      })

      await prisma.league.update({
        where: { id: league.id },
        data: { status: 'PREDRAFT' },
      })

      return NextResponse.json({ success: true, message: `Draft configured with ${TOTAL_PICKS} picks` })
    }

    if (action === 'start_draft') {
      const draftSettings = await prisma.draftSettings.findFirst({
        where: { leagueId: league.id },
        include: { picks: { orderBy: { pickNumber: 'asc' }, take: 1 } },
      })

      if (!draftSettings) return NextResponse.json({ success: false, error: 'No draft configured' }, { status: 400 })
      if (draftSettings.status === 'ACTIVE') return NextResponse.json({ success: false, error: 'Draft already active' }, { status: 409 })

      const firstPick = draftSettings.picks[0]

      await prisma.$transaction([
        prisma.draftSettings.update({
          where: { id: draftSettings.id },
          data: { status: 'ACTIVE', startedAt: new Date() },
        }),
        prisma.draftPick.update({
          where: { id: firstPick.id },
          data: { nominatedAt: new Date() },
        }),
        prisma.league.update({
          where: { id: league.id },
          data: { status: 'DRAFT' },
        }),
      ])

      return NextResponse.json({ success: true, message: 'Draft started' })
    }

    if (action === 'finalize_week') {
      const { weekNumber } = body
      if (!weekNumber) return NextResponse.json({ success: false, error: 'weekNumber required' }, { status: 400 })

      await finalizeWeek(league.id, weekNumber)
      return NextResponse.json({ success: true, message: `Week ${weekNumber} finalized` })
    }

    if (action === 'start_season') {
      await prisma.league.update({
        where: { id: league.id },
        data: { status: 'REGULAR_SEASON' },
      })
      await initializeWeekLineups(league.id, league.currentWeek)
      return NextResponse.json({ success: true, message: 'Season started' })
    }

    // Reset all teams' FAAB balances to the league's configured faabBudget.
    // Use case: commissioner corrects an erroneous waiver run, or resets for testing.
    // Only available when league.waiverType === 'FAAB'.
    if (action === 'reset_faab') {
      if (league.waiverType !== 'FAAB') {
        return NextResponse.json(
          { success: false, error: 'League is not using FAAB waivers' },
          { status: 400 }
        )
      }

      await prisma.team.updateMany({
        where: { leagueId: league.id },
        data: { faabBalance: league.faabBudget },
      })

      return NextResponse.json({
        success: true,
        message: `All team FAAB balances reset to $${league.faabBudget}`,
      })
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 })

  } catch (err: any) {
    if (err.message === 'UNAUTHENTICATED') return authError('UNAUTHENTICATED')
    if (err.message === 'UNAUTHORIZED') return authError('UNAUTHORIZED')
    console.error('[admin POST]', err)
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
