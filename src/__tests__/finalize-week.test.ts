/**
 * finalizeWeek idempotency tests.
 *
 * This is the highest-stakes test file in the codebase.
 * A double-run of finalizeWeek corrupts season standings permanently.
 *
 * Tests verify:
 *   1. Normal finalization: correct W/L assigned, week marked complete
 *   2. Second call is a no-op (idempotent)
 *   3. Tie handling: both teams get ties, not wins
 *   4. Team point totals accumulate correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockWeekOpen     = { id: 'week-1', leagueId: 'league-1', weekNumber: 3, isComplete: false, isPlayoff: false, startDate: new Date('2026-04-07'), endDate: new Date('2026-04-14') }
const mockWeekComplete = { ...mockWeekOpen, isComplete: true }
const nextWeekRecord   = { ...mockWeekOpen, id: 'week-2', weekNumber: 4, isComplete: false, isPlayoff: false }

const mockMatchupHomeWin = {
  id: 'm1', leagueId: 'league-1', weekNumber: 3,
  homeTeamId: 'team-a', awayTeamId: 'team-b',
  homeScore: 5, awayScore: 2, homeHR: 5, awayHR: 2, winner: null, status: 'IN_PROGRESS',
}

const mockMatchupTie = {
  id: 'm2', leagueId: 'league-1', weekNumber: 3,
  homeTeamId: 'team-c', awayTeamId: 'team-d',
  homeScore: 3, awayScore: 3, homeHR: 3, awayHR: 3, winner: null, status: 'IN_PROGRESS',
}

// Helper that builds a standard tx mock client
const makeTxClient = (weekRecord: typeof mockWeekOpen, matchups: typeof mockMatchupHomeWin[]) => {
  const teamUpdates: Array<{ id: string; data: any }> = []
  const matchupUpdates: Array<{ id: string; data: any }> = []

  return {
    txClient: {
      leagueWeek: {
        findFirstOrThrow: vi.fn().mockResolvedValue(weekRecord),
        update: vi.fn().mockResolvedValue(mockWeekComplete),
      },
      matchup: {
        findMany: vi.fn().mockResolvedValue(matchups),
        update: vi.fn().mockImplementation(({ where, data }: any) => {
          matchupUpdates.push({ id: where.id, data })
          return {}
        }),
      },
      team: {
        update: vi.fn().mockImplementation(({ where, data }: any) => {
          teamUpdates.push({ id: where.id, data })
          return {}
        }),
      },
    },
    teamUpdates,
    matchupUpdates,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('finalizeWeek', () => {
  let finalizeWeek: (leagueId: string, weekNumber: number) => Promise<void>

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('@/lib/scoring')
    finalizeWeek = mod.finalizeWeek

    // Default: updateMatchupScores is a no-op (mocked via prisma.matchup calls)
    vi.mocked(prisma.matchup.findMany).mockResolvedValue([])
    vi.mocked(prisma.matchup.update).mockResolvedValue({} as any)

    // After-tx reads — default to next week exists (avoids playoff codepath)
    vi.mocked(prisma.leagueWeek.findFirstOrThrow).mockResolvedValue(mockWeekComplete as any)
    vi.mocked(prisma.leagueWeek.findFirst).mockResolvedValue(nextWeekRecord as any)
    vi.mocked(prisma.leagueWeek.findMany).mockResolvedValue([mockWeekComplete as any])
    vi.mocked(prisma.league.update).mockResolvedValue({} as any)
    vi.mocked(prisma.leagueWeek.createMany).mockResolvedValue({ count: 1 } as any)
    // resetWaiverPriority calls team.findMany then $transaction(updates[])
    vi.mocked(prisma.team.findMany).mockResolvedValue([
      { id: 'team-a', wins: 1, pointsFor: 5 } as any,
      { id: 'team-b', wins: 0, pointsFor: 2 } as any,
    ])
    vi.mocked(prisma.team.update).mockResolvedValue({} as any)
  })

  it('exits immediately (no team writes) when week is already complete', async () => {
    let teamWritten = false

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') {
        const { txClient } = makeTxClient(mockWeekComplete, [mockMatchupHomeWin])
        txClient.team.update = vi.fn().mockImplementation(() => { teamWritten = true })
        return fn(txClient)
      }
    })

    await finalizeWeek('league-1', 3)

    // isComplete=true inside tx means no writes should happen
    expect(teamWritten).toBe(false)
  })

  it('assigns TIE to both teams when scores are equal', async () => {
    const { txClient, teamUpdates, matchupUpdates } = makeTxClient(mockWeekOpen, [mockMatchupTie])

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') return fn(txClient)
    })

    await finalizeWeek('league-1', 3)

    const matchupResult = matchupUpdates.find(u => u.id === 'm2')
    expect(matchupResult?.data.winner).toBe('TIE')

    const teamC = teamUpdates.find(u => u.id === 'team-c')
    const teamD = teamUpdates.find(u => u.id === 'team-d')
    expect(teamC?.data.ties.increment).toBe(1)
    expect(teamC?.data.wins.increment).toBe(0)
    expect(teamC?.data.losses.increment).toBe(0)
    expect(teamD?.data.ties.increment).toBe(1)
    expect(teamD?.data.wins.increment).toBe(0)
    expect(teamD?.data.losses.increment).toBe(0)
  })

  it('awards win to home team and loss to away when home score is higher', async () => {
    const { txClient, teamUpdates, matchupUpdates } = makeTxClient(mockWeekOpen, [mockMatchupHomeWin])

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') return fn(txClient)
    })

    await finalizeWeek('league-1', 3)

    const home = teamUpdates.find(u => u.id === 'team-a')
    const away = teamUpdates.find(u => u.id === 'team-b')

    expect(home?.data.wins.increment).toBe(1)
    expect(home?.data.losses.increment).toBe(0)
    expect(home?.data.pointsFor.increment).toBe(5)
    expect(home?.data.pointsAgainst.increment).toBe(2)

    expect(away?.data.wins.increment).toBe(0)
    expect(away?.data.losses.increment).toBe(1)
    expect(away?.data.pointsFor.increment).toBe(2)
    expect(away?.data.pointsAgainst.increment).toBe(5)
  })

  it('marks week as complete after processing matchups', async () => {
    let weekMarkedComplete = false
    const { txClient } = makeTxClient(mockWeekOpen, [mockMatchupHomeWin])
    txClient.leagueWeek.update = vi.fn().mockImplementation(() => {
      weekMarkedComplete = true
      return mockWeekComplete
    })

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') return fn(txClient)
    })

    await finalizeWeek('league-1', 3)

    expect(weekMarkedComplete).toBe(true)
  })
})
