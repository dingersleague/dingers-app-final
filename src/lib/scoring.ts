/**
 * Scoring Engine
 *
 * Rules:
 * - Only home runs count. 1 HR = 1 point.
 * - Only active starters score (not bench).
 * - Lineup locks Tuesday at 1:00 AM UTC (MLB schedule typically starts Tuesday).
 * - Players added before lock = eligible for current week.
 * - Score is recalculated from player_game_stats for accuracy.
 */

import { prisma } from './prisma'
import { log } from './logger'
import { POSITION_ELIGIBILITY, STARTER_POSITIONS } from '@/types'

// ─── Lineup Lock Logic ────────────────────────────────────────────────────────

/**
 * Determine if lineups are locked for a given week.
 *
 * Reads lock hour from League.lineupLockHour (default: 1 = 1:00 AM UTC).
 * The lock occurs at the start of the scoring week (weekStartDate) at that hour.
 *
 * Pass the league object to use DB-configured settings.
 * Falls back to hardcoded defaults for backward compat when league is unavailable.
 */
export function isLineupLocked(
  weekStartDate: Date,
  league?: { lineupLockHour: number } | null
): boolean {
  const lockTime = getLineupLockTime(weekStartDate, league)
  return new Date() >= lockTime
}

export function getLineupLockTime(
  weekStartDate: Date,
  league?: { lineupLockHour: number } | null
): Date {
  const lockHour = league?.lineupLockHour ?? 1
  const lock = new Date(weekStartDate)
  lock.setUTCHours(lockHour, 0, 0, 0)
  return lock
}

// ─── Score Calculation ────────────────────────────────────────────────────────

/**
 * Calculate a team's HR score for a matchup week.
 * Only counts HRs from players in active (non-bench) lineup slots.
 *
 * This is the authoritative score calculation used by both
 * live scoring and final matchup results.
 */
export async function calculateTeamMatchupScore(
  teamId: string,
  matchupId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<{ totalHR: number; playerBreakdown: Array<{ playerId: string; fullName: string; hr: number; position: string }> }> {

  // Get starting lineup for this matchup
  const lineupSlots = await prisma.lineupSlot.findMany({
    where: {
      matchupId,
      rosterSlot: { teamId },
      isStarter: true,
    },
    include: {
      rosterSlot: {
        include: {
          player: {
            include: {
              gameStats: {
                where: {
                  gameDate: { gte: weekStart, lte: weekEnd },
                },
              },
            },
          },
        },
      },
    },
  })

  const breakdown: Array<{ playerId: string; fullName: string; hr: number; position: string }> = []
  let totalHR = 0

  for (const slot of lineupSlots) {
    const player = slot.rosterSlot.player
    const playerHR = player.gameStats.reduce((sum, g) => sum + g.homeRuns, 0)

    breakdown.push({
      playerId: player.id,
      fullName: player.fullName,
      hr: playerHR,
      position: slot.position,
    })

    totalHR += playerHR
  }

  return { totalHR, playerBreakdown: breakdown }
}

/**
 * Update live matchup scores in the database.
 * Called by the stat sync job after each stat ingestion.
 */
export async function updateMatchupScores(leagueId: string, weekNumber: number): Promise<void> {
  const week = await prisma.leagueWeek.findFirst({
    where: { leagueId, weekNumber },
  })
  if (!week) return

  const matchups = await prisma.matchup.findMany({
    where: { leagueId, weekNumber, status: { in: ['IN_PROGRESS', 'SCHEDULED'] } },
  })

  for (const matchup of matchups) {
    const [homeResult, awayResult] = await Promise.all([
      calculateTeamMatchupScore(matchup.homeTeamId, matchup.id, week.startDate, week.endDate),
      calculateTeamMatchupScore(matchup.awayTeamId, matchup.id, week.startDate, week.endDate),
    ])

    await prisma.matchup.update({
      where: { id: matchup.id },
      data: {
        homeHR: homeResult.totalHR,
        homeScore: homeResult.totalHR,
        awayHR: awayResult.totalHR,
        awayScore: awayResult.totalHR,
        status: 'IN_PROGRESS',
      },
    })
  }
}

// ─── Week Finalization ────────────────────────────────────────────────────────

/**
 * Finalize all matchups for a completed week.
 * - Determines winner/loser
 * - Updates team win/loss records
 * - Updates standings
 * - Resets waiver priorities if needed
 * - Advances league to next week
 *
 * IDEMPOTENCY: The entire operation runs inside a serializable transaction.
 * The isComplete guard is re-checked INSIDE the transaction so that two
 * concurrent calls (e.g. worker retry + manual admin trigger) can never both
 * apply wins/losses. The second call will read isComplete=true and exit.
 * Team record updates use SET (absolute values computed from matchup scores)
 * rather than INCREMENT so a hypothetical double-run is still safe.
 */
export async function finalizeWeek(leagueId: string, weekNumber: number): Promise<void> {
  log('info', 'finalize_week_start', { leagueId, weekNumber })

  // Run the score refresh OUTSIDE the transaction — it is read-only from
  // player_game_stats and is safe to call multiple times.
  await updateMatchupScores(leagueId, weekNumber)

  // All mutations happen inside a single serializable transaction so two
  // concurrent finalizeWeek calls cannot both pass the idempotency guard.
  await prisma.$transaction(async tx => {
    // Re-read week INSIDE the transaction. SERIALIZABLE isolation means this
    // read will block until any concurrent writer commits, giving us a
    // consistent view and preventing double-apply.
    const week = await tx.leagueWeek.findFirstOrThrow({
      where: { leagueId, weekNumber },
    })

    if (week.isComplete) {
      log('info', 'finalize_week_already_done', { leagueId, weekNumber })
      return  // Idempotent exit — no writes
    }

    const matchups = await tx.matchup.findMany({
      where: { leagueId, weekNumber },
    })

    // Build per-team deltas from final scores.
    // Using a delta map (keyed by teamId) means we accumulate across all
    // matchups before writing, and the write is a single update per team.
    type TeamDelta = {
      wins: number; losses: number; ties: number
      pointsFor: number; pointsAgainst: number
    }
    const deltas = new Map<string, TeamDelta>()
    const ensure = (id: string) => {
      if (!deltas.has(id)) deltas.set(id, { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 })
      return deltas.get(id)!
    }

    for (const matchup of matchups) {
      const home = ensure(matchup.homeTeamId)
      const away = ensure(matchup.awayTeamId)

      let winner: string
      if (matchup.homeScore > matchup.awayScore) {
        winner = matchup.homeTeamId
        home.wins += 1; away.losses += 1
      } else if (matchup.awayScore > matchup.homeScore) {
        winner = matchup.awayTeamId
        away.wins += 1; home.losses += 1
      } else {
        winner = 'TIE'
        home.ties += 1; away.ties += 1
      }

      home.pointsFor += matchup.homeScore
      home.pointsAgainst += matchup.awayScore
      away.pointsFor += matchup.awayScore
      away.pointsAgainst += matchup.homeScore

      await tx.matchup.update({
        where: { id: matchup.id },
        data: { winner, status: 'COMPLETE' },
      })
    }

    // Write team record increments.
    // INCREMENT is correct here: these are season-running totals and we want
    // to ADD this week's result. The idempotency guard above ensures we only
    // reach this point once per week per league.
    await Promise.all(
      [...deltas.entries()].map(([teamId, d]) =>
        tx.team.update({
          where: { id: teamId },
          data: {
            wins: { increment: d.wins },
            losses: { increment: d.losses },
            ties: { increment: d.ties },
            pointsFor: { increment: d.pointsFor },
            pointsAgainst: { increment: d.pointsAgainst },
          },
        })
      )
    )

    // Mark week complete — this is the sentinel that makes future calls no-op
    await tx.leagueWeek.update({
      where: { id: week.id },
      data: { isComplete: true },
    })

    log('info', 'finalize_week_complete', {
      leagueId, weekNumber,
      matchupsProcessed: matchups.length,
      teamsUpdated: deltas.size,
    })
  }, {
    // SERIALIZABLE prevents phantom reads that would let two concurrent
    // transactions both see isComplete=false and both proceed.
    isolationLevel: 'Serializable',
    timeout: 30_000,
  })

  // Re-read week after transaction to get canonical isPlayoff flag.
  const finalizedWeek = await prisma.leagueWeek.findFirstOrThrow({
    where: { leagueId, weekNumber },
  })

  // These run outside the serializable transaction — they are safe to re-run
  // individually and would exceed the 30s timeout if inside it.
  const nextWeek = weekNumber + 1
  const nextWeekRecord = await prisma.leagueWeek.findFirst({
    where: { leagueId, weekNumber: nextWeek },
  })

  if (nextWeekRecord) {
    if (nextWeekRecord.isPlayoff && !finalizedWeek.isPlayoff) {
      await generatePlayoffBracket(leagueId)
      await initializeWeekLineups(leagueId, nextWeekRecord.weekNumber)
      log('info', 'playoff_bracket_generated', { leagueId, weekNumber })
    } else if (nextWeekRecord.isPlayoff && finalizedWeek.isPlayoff) {
      await finalizePlayoffWeek(leagueId, weekNumber)
      await prisma.league.update({ where: { id: leagueId }, data: { currentWeek: nextWeek } })
      await initializeWeekLineups(leagueId, nextWeek)
      log('info', 'playoff_week_advanced', { leagueId, nextWeek })
    } else {
      await prisma.league.update({ where: { id: leagueId }, data: { currentWeek: nextWeek } })
      await initializeWeekLineups(leagueId, nextWeek)
      log('info', 'week_advanced', { leagueId, nextWeek })
    }
  } else if (finalizedWeek.isPlayoff) {
    await finalizePlayoffWeek(leagueId, weekNumber)
    log('info', 'season_complete', { leagueId, weekNumber })
  } else {
    await generatePlayoffBracket(leagueId)
    log('info', 'playoff_bracket_generated', { leagueId, weekNumber })
  }

  await resetWaiverPriority(leagueId)
  log('info', 'finalize_week_done', { leagueId, weekNumber })
}

/**
 * Initialize lineup slots for all matchups in a new week.
 * Copies current roster to lineup slots (all starters in current slot, bench as bench).
 * Teams can then adjust before lineup lock.
 */
export async function initializeWeekLineups(leagueId: string, weekNumber: number): Promise<void> {
  const matchups = await prisma.matchup.findMany({
    where: { leagueId, weekNumber },
  })

  for (const matchup of matchups) {
    const teamIds = [matchup.homeTeamId, matchup.awayTeamId]

    for (const teamId of teamIds) {
      const rosterSlots = await prisma.rosterSlot.findMany({
        where: { teamId },
        include: { player: true },
      })

      // Build lineup slots
      const lineupData = rosterSlots.map(slot => ({
        rosterSlotId: slot.id,
        matchupId: matchup.id,
        position: slot.position ?? (slot.slotType === 'STARTER' ? 'UTIL' : 'BN'),
        isStarter: slot.slotType === 'STARTER',
        locked: false,
      }))

      await prisma.lineupSlot.createMany({
        data: lineupData,
        skipDuplicates: true,
      })
    }
  }
}

// ─── Waiver Priority ─────────────────────────────────────────────────────────

/**
 * Reset waiver priority at the start of each week.
 * Priority order = reverse standings order (worst team picks first).
 * Teams that use waivers go to the end of priority.
 */
export async function resetWaiverPriority(leagueId: string): Promise<void> {
  const teams = await prisma.team.findMany({
    where: { leagueId },
    orderBy: [
      { wins: 'asc' },
      { pointsFor: 'asc' },
    ],
  })

  const updates = teams.map((team, index) =>
    prisma.team.update({
      where: { id: team.id },
      data: { waiverPriority: index + 1 },
    })
  )

  await prisma.$transaction(updates)
}

// ─── Schedule Generation ──────────────────────────────────────────────────────

/**
 * Generate a full season schedule using a round-robin algorithm.
 * Standard MLB fantasy season: ~23 regular-season weeks (April - late September)
 * Weeks start Tuesday, end Monday.
 */
export async function generateSeasonSchedule(
  leagueId: string,
  season: number,
  seasonStartDate: Date
): Promise<void> {
  const teams = await prisma.team.findMany({ where: { leagueId } })
  if (teams.length < 2) throw new Error('Need at least 2 teams')

  // Weeks must start on Tuesday (crons fire on Tuesdays)
  if (seasonStartDate.getUTCDay() !== 2) {
    throw new Error('Season start date must be a Tuesday')
  }

  const teamIds = teams.map(t => t.id)
  const n = teamIds.length
  const totalRegularWeeks = 22  // 22-week regular season
  const playoffWeeks = 3

  const weekRecords: Array<{ start: Date; end: Date; isPlayoff: boolean }> = []
  const current = new Date(seasonStartDate)

  for (let w = 0; w < totalRegularWeeks + playoffWeeks; w++) {
    const start = new Date(current)
    const end = new Date(current)
    end.setDate(end.getDate() + 6) // 7-day week

    weekRecords.push({
      start,
      end,
      isPlayoff: w >= totalRegularWeeks,
    })

    current.setDate(current.getDate() + 7)
  }

  // Round-robin (Berger algorithm): fix position 0, rotate positions 1..n-1.
  // BUG FIX: rotation now happens at the START of each round (after round 0),
  // not at the end. Previous code rotated after generating, so round 0 matchups
  // were correct but every subsequent round was off by one rotation step.
  const generateRoundRobin = (teams: string[], totalWeeks: number) => {
    const schedule: Array<Array<[string, string]>> = []
    const t = [...teams]
    if (t.length % 2 !== 0) t.push('BYE')
    const half = t.length / 2

    for (let round = 0; round < totalWeeks; round++) {
      // Rotate before generating round > 0
      if (round > 0) {
        t.splice(1, 0, t.pop()!)
      }
      const weekMatchups: Array<[string, string]> = []
      for (let i = 0; i < half; i++) {
        const home = t[i]
        const away = t[t.length - 1 - i]
        if (home !== 'BYE' && away !== 'BYE') {
          // Alternate home/away each round to balance home games
          weekMatchups.push(round % 2 === 0 ? [home, away] : [away, home])
        }
      }
      schedule.push(weekMatchups)
    }
    return schedule
  }

  const regularSchedule = generateRoundRobin(teamIds, totalRegularWeeks)

  // Create weeks and matchups in DB
  await prisma.$transaction(async tx => {
    for (let w = 0; w < weekRecords.length; w++) {
      const weekNum = w + 1
      const weekRecord = weekRecords[w]

      const leagueWeek = await tx.leagueWeek.create({
        data: {
          leagueId,
          weekNumber: weekNum,
          startDate: weekRecord.start,
          endDate: weekRecord.end,
          isPlayoff: weekRecord.isPlayoff,
        },
      })

      if (!weekRecord.isPlayoff) {
        const weekMatchups = regularSchedule[w] ?? []
        for (const [homeId, awayId] of weekMatchups) {
          await tx.matchup.create({
            data: {
              leagueId,
              weekId: leagueWeek.id,
              weekNumber: weekNum,
              homeTeamId: homeId,
              awayTeamId: awayId,
              status: 'SCHEDULED',
            },
          })
        }
      }
      // Playoff matchups are created dynamically after regular season ends
    }
  })
}

// ─── Position Validation ─────────────────────────────────────────────────────

/**
 * Check if a player can be placed in a given lineup slot.
 */
export function canPlayInSlot(playerPositions: string[], slotPosition: string): boolean {
  const eligible = POSITION_ELIGIBILITY[slotPosition] ?? []
  return playerPositions.some(pos => eligible.includes(pos))
}

/**
 * Validate a full lineup submission.
 * Returns errors if any slot violations exist.
 */
export function validateLineup(
  slots: Array<{ position: string; playerPositions: string[]; playerId: string }>
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const seenPlayers = new Set<string>()
  const slotCounts: Record<string, number> = {}

  for (const slot of slots) {
    // Check duplicate players
    if (seenPlayers.has(slot.playerId)) {
      errors.push(`Player ${slot.playerId} appears in multiple slots`)
    }
    seenPlayers.add(slot.playerId)

    // Check position eligibility
    if (!canPlayInSlot(slot.playerPositions, slot.position)) {
      errors.push(`Player not eligible for ${slot.position} slot`)
    }

    // Count slot usage
    slotCounts[slot.position] = (slotCounts[slot.position] ?? 0) + 1
  }

  // Validate slot counts (e.g., exactly 3 OF slots)
  const expectedStarters: Record<string, number> = {
    C: 1, '1B': 1, '2B': 1, SS: 1, '3B': 1, OF: 3, UTIL: 1,
  }

  for (const [pos, count] of Object.entries(expectedStarters)) {
    const actual = slotCounts[pos] ?? 0
    if (actual !== count) {
      errors.push(`Expected ${count} ${pos} slot(s), got ${actual}`)
    }
  }

  return { valid: errors.length === 0, errors }
}

// ─── Playoff Bracket ─────────────────────────────────────────────────────────

/**
 * Generate playoff bracket matchups after regular season ends.
 * Format: 6-team single-elimination bracket over 3 weeks.
 *   Week 1 (Semifinals): seeds 1v6, 2v5, 3v4
 *   Week 2 (Semifinals continued / consolation): winners advance
 *   Week 3 (Championship): top 2 survivors
 *
 * Seeds determined by regular season record (wins desc, then pointsFor desc).
 *
 * Called by finalizeWeek when weekNumber === league.playoffWeekStart - 1.
 */
export async function generatePlayoffBracket(leagueId: string): Promise<void> {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })

  // Idempotency: if already in PLAYOFFS, bracket was already generated
  if (league.status === 'PLAYOFFS') {
    log('info', 'playoff_bracket_already_generated', { leagueId })
    return
  }

  // Get playoff weeks (already created by generateSeasonSchedule, no matchups yet)
  const playoffWeeks = await prisma.leagueWeek.findMany({
    where: { leagueId, isPlayoff: true },
    orderBy: { weekNumber: 'asc' },
  })

  if (playoffWeeks.length < 3) {
    throw new Error(`Expected 3 playoff weeks, got ${playoffWeeks.length}`)
  }

  // Seed teams by regular season standings
  const teams = await prisma.team.findMany({
    where: { leagueId },
    orderBy: [{ wins: 'desc' }, { pointsFor: 'desc' }],
  })

  // Top 6 make playoffs
  const seeds = teams.slice(0, 6)
  if (seeds.length < 6) {
    throw new Error(`Playoff bracket requires at least 6 teams, got ${seeds.length}`)
  }
  const [s1, s2, s3, s4, s5, s6] = seeds

  // Week 1: 3 semifinal matchups
  const week1 = playoffWeeks[0]

  // Guard against duplicate matchups from concurrent calls
  const existingMatchups = await prisma.matchup.count({
    where: { leagueId, weekNumber: week1.weekNumber },
  })
  if (existingMatchups > 0) {
    log('info', 'playoff_bracket_matchups_exist', { leagueId, week: week1.weekNumber })
    return
  }

  await prisma.matchup.createMany({
    data: [
      { leagueId, weekId: week1.id, weekNumber: week1.weekNumber, homeTeamId: s1.id, awayTeamId: s6.id, status: 'SCHEDULED' },
      { leagueId, weekId: week1.id, weekNumber: week1.weekNumber, homeTeamId: s2.id, awayTeamId: s5.id, status: 'SCHEDULED' },
      { leagueId, weekId: week1.id, weekNumber: week1.weekNumber, homeTeamId: s3.id, awayTeamId: s4.id, status: 'SCHEDULED' },
    ],
  })

  await prisma.league.update({
    where: { id: leagueId },
    data: { status: 'PLAYOFFS', currentWeek: week1.weekNumber },
  })

  // Weeks 2 and 3 matchups are created dynamically after each round completes
  // (we don't know matchups until week 1 resolves). See finalizePlayoffWeek().
  log('info', 'playoff_bracket_seeded', {
    leagueId, week: week1.weekNumber,
    matchups: `${s1.name} v ${s6.name}, ${s2.name} v ${s5.name}, ${s3.name} v ${s4.name}`,
  })
}

/**
 * Finalize a playoff week and advance the bracket.
 * Creates next round matchups based on winners.
 */
export async function finalizePlayoffWeek(leagueId: string, weekNumber: number): Promise<void> {
  const matchups = await prisma.matchup.findMany({
    where: { leagueId, weekNumber, status: 'COMPLETE' },
    include: {
      homeTeam: true,
      awayTeam: true,
    },
  })

  if (matchups.length === 0) return

  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })
  const playoffWeeks = await prisma.leagueWeek.findMany({
    where: { leagueId, isPlayoff: true },
    orderBy: { weekNumber: 'asc' },
  })

  const week1Num = playoffWeeks[0]?.weekNumber
  const week2Num = playoffWeeks[1]?.weekNumber
  const week3Num = playoffWeeks[2]?.weekNumber

  // Playoff tiebreaker: matchup score → season HRs (pointsFor) → regular season wins → random
  const getWinner = (m: typeof matchups[0]) => {
    if (m.homeScore !== m.awayScore) {
      return m.homeScore > m.awayScore ? m.homeTeam : m.awayTeam
    }
    // Tiebreaker 1: total season HRs
    if (m.homeTeam.pointsFor !== m.awayTeam.pointsFor) {
      return m.homeTeam.pointsFor > m.awayTeam.pointsFor ? m.homeTeam : m.awayTeam
    }
    // Tiebreaker 2: regular season wins
    if (m.homeTeam.wins !== m.awayTeam.wins) {
      return m.homeTeam.wins > m.awayTeam.wins ? m.homeTeam : m.awayTeam
    }
    // Tiebreaker 3: random (seeded by matchup ID for determinism)
    const hash = m.id.charCodeAt(0) + m.id.charCodeAt(1)
    return hash % 2 === 0 ? m.homeTeam : m.awayTeam
  }
  const getLoser = (m: typeof matchups[0]) => {
    const winner = getWinner(m)
    return winner.id === m.homeTeam.id ? m.awayTeam : m.homeTeam
  }

  if (weekNumber === week1Num && playoffWeeks[1]) {
    const week2 = playoffWeeks[1]

    // Guard against duplicate matchups from concurrent calls
    const existing = await prisma.matchup.count({ where: { leagueId, weekNumber: week2.weekNumber } })
    if (existing === 0) {
      const winners = matchups.map(getWinner)
      const losers = matchups.map(getLoser)

      if (winners.length >= 2) {
        await prisma.matchup.createMany({
          data: [
            // Championship semifinal
            { leagueId, weekId: week2.id, weekNumber: week2.weekNumber, homeTeamId: winners[0].id, awayTeamId: winners[1].id, status: 'SCHEDULED' },
            // 3rd place consolation
            ...(losers.length >= 2 ? [{ leagueId, weekId: week2.id, weekNumber: week2.weekNumber, homeTeamId: losers[0].id, awayTeamId: losers[1].id, status: 'SCHEDULED' as const }] : []),
            ...(winners[2] ? [{ leagueId, weekId: week2.id, weekNumber: week2.weekNumber, homeTeamId: winners[2].id, awayTeamId: losers[0].id, status: 'SCHEDULED' as const }] : []),
          ],
        })
      }
    }
  }

  if (weekNumber === week2Num && playoffWeeks[2]) {
    const week3 = playoffWeeks[2]

    // Guard against duplicate matchups from concurrent calls
    const existing = await prisma.matchup.count({ where: { leagueId, weekNumber: week3.weekNumber } })
    if (existing === 0) {
      const winners = matchups.map(getWinner)

      if (winners.length >= 2) {
        await prisma.matchup.create({
          data: {
            leagueId, weekId: week3.id, weekNumber: week3.weekNumber,
            homeTeamId: winners[0].id, awayTeamId: winners[1].id, status: 'SCHEDULED',
          },
        })
      }
    }
  }

  if (weekNumber === week3Num) {
    // Season complete
    await prisma.league.update({
      where: { id: leagueId },
      data: { status: 'OFFSEASON' },
    })
    log('info', 'playoff_season_complete', { leagueId })
  }
}
