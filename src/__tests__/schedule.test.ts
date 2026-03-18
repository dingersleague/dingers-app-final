/**
 * Schedule generator correctness tests.
 *
 * generateSeasonSchedule writes to DB via a transaction, so we mock the
 * transaction and capture matchup.create calls to verify round-robin invariants.
 *
 * Invariants for a 12-team, 22-week regular season:
 *   - Every team plays exactly 22 matchups
 *   - No team plays itself  
 *   - Every team plays every other team at least once
 *   - Each week has exactly 6 matchups (12 / 2)
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { prisma } from '@/lib/prisma'

const TEAM_COUNT = 12
const REGULAR_WEEKS = 22

const fakeTeams = Array.from({ length: TEAM_COUNT }, (_, i) => ({
  id: `team-${i + 1}`,
  name: `Team ${i + 1}`,
  leagueId: 'league-1',
  wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
  faabBalance: 100, waiverPriority: i + 1,
}))

describe('generateSeasonSchedule — round-robin invariants', () => {
  let capturedMatchups: Array<{ homeTeamId: string; awayTeamId: string; weekNumber: number }> = []

  beforeAll(async () => {
    capturedMatchups = []
    let weekCounter = 0

    vi.mocked(prisma.team.findMany).mockResolvedValue(fakeTeams as any)

    // $transaction mock: simulate the tx client used inside generateSeasonSchedule
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') {
        const txClient = {
          leagueWeek: {
            create: vi.fn().mockImplementation(({ data }: any) => {
              weekCounter++
              return { id: `week-${weekCounter}`, ...data }
            }),
          },
          matchup: {
            create: vi.fn().mockImplementation(({ data }: any) => {
              capturedMatchups.push({
                homeTeamId: data.homeTeamId,
                awayTeamId: data.awayTeamId,
                weekNumber: data.weekNumber,
              })
              return { id: `m-${capturedMatchups.length}`, ...data }
            }),
          },
          league: {
            update: vi.fn().mockResolvedValue({}),
          },
        }
        return fn(txClient)
      }
    })

    vi.mocked(prisma.league.update).mockResolvedValue({} as any)

    const { generateSeasonSchedule } = await import('@/lib/scoring')
    await generateSeasonSchedule('league-1', 2026, new Date('2026-04-07'))
  })

  it('generates correct total matchup count (6 games/week × 22 weeks)', () => {
    const regularMatchups = capturedMatchups.filter(m => m.weekNumber <= REGULAR_WEEKS)
    expect(regularMatchups.length).toBe((TEAM_COUNT / 2) * REGULAR_WEEKS)
  })

  it('every team plays exactly 22 regular season games', () => {
    const regularMatchups = capturedMatchups.filter(m => m.weekNumber <= REGULAR_WEEKS)
    for (const team of fakeTeams) {
      const gamesPlayed = regularMatchups.filter(
        m => m.homeTeamId === team.id || m.awayTeamId === team.id
      ).length
      expect(gamesPlayed, `${team.id} should play 22 games`).toBe(REGULAR_WEEKS)
    }
  })

  it('no team plays itself', () => {
    const selfGames = capturedMatchups.filter(m => m.homeTeamId === m.awayTeamId)
    expect(selfGames).toHaveLength(0)
  })

  it('every team plays every other team at least once', () => {
    const regularMatchups = capturedMatchups.filter(m => m.weekNumber <= REGULAR_WEEKS)
    for (const teamA of fakeTeams) {
      for (const teamB of fakeTeams) {
        if (teamA.id === teamB.id) continue
        const played = regularMatchups.some(
          m =>
            (m.homeTeamId === teamA.id && m.awayTeamId === teamB.id) ||
            (m.homeTeamId === teamB.id && m.awayTeamId === teamA.id)
        )
        expect(played, `${teamA.id} never plays ${teamB.id}`).toBe(true)
      }
    }
  })

  it('each regular season week has exactly 6 matchups', () => {
    for (let w = 1; w <= REGULAR_WEEKS; w++) {
      const weekGames = capturedMatchups.filter(m => m.weekNumber === w)
      expect(weekGames.length, `week ${w} should have 6 matchups`).toBe(TEAM_COUNT / 2)
    }
  })
})
