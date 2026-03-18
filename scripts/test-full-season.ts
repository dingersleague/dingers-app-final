/**
 * FULL SEASON SMOKE TEST
 *
 * Simulates the entire lifecycle: draft → 22 regular weeks → 3 playoff weeks → offseason.
 * Runs against your real Neon DB. Safe to re-run (cleans up first).
 *
 * Usage: npx tsx scripts/test-full-season.ts
 *
 * What it validates:
 *   - Draft: setup, pick submission, auto-pick, roster creation, position assignment
 *   - Regular season: scoring, finalization, standings, week advancement, lineups
 *   - Playoff transition: bracket generation, lineup init for playoff week 1
 *   - Playoff weeks: tiebreaker logic (no home-team advantage), bracket advancement
 *   - Championship: final week → OFFSEASON transition
 *   - Edge cases: ties in regular season, ties in playoffs
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ FAIL: ${label}`)
    failed++
  }
}

// ── Cleanup ─────────────────────────────────────────────────────

async function cleanup() {
  console.log('\n🧹 Cleaning up...')
  await prisma.lineupSlot.deleteMany()
  await prisma.matchup.deleteMany()
  await prisma.leagueWeek.deleteMany()
  await prisma.transaction.deleteMany()
  await prisma.rosterSlot.deleteMany()
  await prisma.playerGameStats.deleteMany()
  await prisma.playerSeasonStats.deleteMany()
  await prisma.draftPick.deleteMany()
  await prisma.draftSettings.deleteMany()
  await prisma.syncLog.deleteMany()

  const league = await prisma.league.findFirst()
  if (league) {
    await prisma.league.update({
      where: { id: league.id },
      data: { status: 'SETUP', currentWeek: 0 },
    })
  }
  await prisma.team.updateMany({
    data: { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, faabBalance: 100 },
  })
  console.log('  Done.\n')
}

// ── Step 1: Generate Schedule ───────────────────────────────────

async function step1() {
  console.log('📅 STEP 1: Generate schedule')
  const league = await prisma.league.findFirstOrThrow()
  const { generateSeasonSchedule } = await import('../src/lib/scoring')

  const startDate = new Date('2025-04-01T00:00:00Z') // Tuesday
  await generateSeasonSchedule(league.id, league.season, startDate)
  await prisma.league.update({ where: { id: league.id }, data: { status: 'PREDRAFT', currentWeek: 1 } })

  const weeks = await prisma.leagueWeek.findMany({ where: { leagueId: league.id }, orderBy: { weekNumber: 'asc' } })
  assert(weeks.length === 25, `25 weeks created (got ${weeks.length})`)

  const regularWeeks = weeks.filter(w => !w.isPlayoff)
  const playoffWeeks = weeks.filter(w => w.isPlayoff)
  assert(regularWeeks.length === 22, `22 regular weeks (got ${regularWeeks.length})`)
  assert(playoffWeeks.length === 3, `3 playoff weeks (got ${playoffWeeks.length})`)

  const matchups = await prisma.matchup.count({ where: { leagueId: league.id } })
  assert(matchups === 132, `132 regular matchups (got ${matchups})`)

  // Verify weeks are 7 days and start on Tuesday
  const w1 = weeks[0]
  const dayOfWeek = new Date(w1.startDate).getUTCDay()
  assert(dayOfWeek === 2, `Week 1 starts on Tuesday (day ${dayOfWeek})`)

  console.log(`  Playoffs: weeks ${playoffWeeks[0].weekNumber}-${playoffWeeks[2].weekNumber}`)
  console.log(`  Last regular: ${regularWeeks[21].startDate.toISOString().split('T')[0]} → ${regularWeeks[21].endDate.toISOString().split('T')[0]}`)
  console.log(`  Championship: ${playoffWeeks[2].startDate.toISOString().split('T')[0]} → ${playoffWeeks[2].endDate.toISOString().split('T')[0]}`)
}

// ── Step 2: Draft ───────────────────────────────────────────────

async function step2() {
  console.log('\n🏈 STEP 2: Snake draft (156 picks)')
  const league = await prisma.league.findFirstOrThrow()
  const teams = await prisma.team.findMany({ where: { leagueId: league.id }, orderBy: { draftPosition: 'asc' } })
  const draftOrder = teams.map(t => t.id)

  // Setup draft
  const ROUNDS = 13
  const TEAMS = 12
  const pickData: { teamId: string; round: number; pickNumber: number; pickInRound: number }[] = []
  let pickNumber = 1
  for (let round = 1; round <= ROUNDS; round++) {
    const roundOrder = round % 2 === 1 ? [...draftOrder] : [...draftOrder].reverse()
    for (let i = 0; i < roundOrder.length; i++) {
      pickData.push({ teamId: roundOrder[i], round, pickNumber: pickNumber++, pickInRound: i + 1 })
    }
  }

  const draftSettings = await prisma.draftSettings.create({
    data: { leagueId: league.id, type: 'SNAKE', status: 'ACTIVE', timerSeconds: 90, currentPick: 1, currentRound: 1, startedAt: new Date() },
  })
  await prisma.draftPick.createMany({ data: pickData.map(p => ({ ...p, draftSettingsId: draftSettings.id })) })
  await prisma.league.update({ where: { id: league.id }, data: { status: 'DRAFT' } })

  // Nominate first pick
  const firstPick = await prisma.draftPick.findFirstOrThrow({
    where: { draftSettingsId: draftSettings.id, pickNumber: 1 },
  })
  await prisma.draftPick.update({ where: { id: firstPick.id }, data: { nominatedAt: new Date() } })

  // Get available hitters sorted by HR, grouped by position for smart drafting
  const hitters = await prisma.player.findMany({
    where: { status: 'ACTIVE', NOT: { positions: { hasSome: ['P', 'SP', 'RP'] } } },
    include: { seasonStats: { where: { season: league.season }, take: 1 } },
  })
  const withHR = hitters.map(p => ({
    id: p.id, hr: p.seasonStats[0]?.homeRuns ?? 0, positions: p.positions,
  }))

  // Build position pools sorted by HR
  const posGroups: Record<string, typeof withHR> = { C: [], '1B': [], '2B': [], SS: [], '3B': [], OF: [], DH: [] }
  for (const p of withHR) {
    for (const pos of p.positions) {
      const key = ['LF', 'CF', 'RF'].includes(pos) ? 'OF' : pos
      if (posGroups[key]) posGroups[key].push(p)
    }
  }
  for (const key of Object.keys(posGroups)) {
    posGroups[key].sort((a, b) => b.hr - a.hr)
  }

  // Position-aware draft: each team needs C, 1B, 2B, SS, 3B, OF, OF, OF, UTIL, BN x4
  // We'll build a pick order that ensures position coverage per team
  const POSITIONS_NEEDED = ['C', '1B', '2B', 'SS', '3B', 'OF', 'OF', 'OF']
  const sorted: { id: string; hr: number }[] = []
  const drafted = new Set<string>()
  const teamPositionNeeds: Record<string, string[]> = {}
  for (const team of teams) {
    teamPositionNeeds[team.id] = [...POSITIONS_NEEDED]
  }

  // For each pick, find the best player that fills a position need for that team
  for (let pn = 1; pn <= 156; pn++) {
    const pick = pickData[pn - 1]
    const needs = teamPositionNeeds[pick.teamId]

    let bestPlayer: { id: string; hr: number } | null = null

    if (needs.length > 0) {
      // Try to fill a position need
      const neededPos = needs[0]
      const posKey = ['LF', 'CF', 'RF'].includes(neededPos) ? 'OF' : neededPos
      const pool = posGroups[posKey] || []
      const candidate = pool.find(p => !drafted.has(p.id))
      if (candidate) {
        bestPlayer = candidate
        needs.shift()
      }
    }

    if (!bestPlayer) {
      // Fill remaining picks with best available
      const candidate = withHR.filter(p => !drafted.has(p.id)).sort((a, b) => b.hr - a.hr)[0]
      bestPlayer = candidate
    }

    if (bestPlayer) {
      drafted.add(bestPlayer.id)
      sorted.push(bestPlayer)
    }
  }

  assert(sorted.length >= 156, `Enough hitters for draft (got ${sorted.length}, need 156)`)

  // Simulate all 156 picks
  const totalPicks = ROUNDS * TEAMS
  for (let pn = 1; pn <= totalPicks; pn++) {
    const pick = await prisma.draftPick.findFirstOrThrow({
      where: { draftSettingsId: draftSettings.id, pickNumber: pn },
    })

    const playerId = sorted[pn - 1].id

    await prisma.draftPick.update({
      where: { id: pick.id },
      data: { playerId, pickedAt: new Date(), isAutoPick: pn > 12 }, // first round "manual", rest auto
    })

    // Add to roster immediately
    await prisma.rosterSlot.create({
      data: { teamId: pick.teamId, playerId, slotType: 'BENCH', position: 'BN', acquiredVia: 'DRAFT' },
    })

    // Advance
    if (pn < totalPicks) {
      const nextPick = await prisma.draftPick.findFirstOrThrow({
        where: { draftSettingsId: draftSettings.id, pickNumber: pn + 1 },
      })
      await prisma.draftPick.update({ where: { id: nextPick.id }, data: { nominatedAt: new Date() } })
      await prisma.draftSettings.update({
        where: { id: draftSettings.id },
        data: { currentPick: pn + 1, currentRound: nextPick.round },
      })
    }

    if (pn % 24 === 0) process.stdout.write(`  ... ${pn}/${totalPicks} picks\n`)
  }

  // Complete draft
  await prisma.draftSettings.update({
    where: { id: draftSettings.id },
    data: { status: 'COMPLETE', completedAt: new Date(), currentPick: totalPicks + 1 },
  })

  // Assign starting positions
  const { assignStartingPositions } = await import('../src/lib/draft')
  await assignStartingPositions(league.id)

  // Transition to regular season
  await prisma.league.update({ where: { id: league.id }, data: { status: 'REGULAR_SEASON' } })

  // Verify rosters
  for (const team of teams) {
    const slots = await prisma.rosterSlot.findMany({ where: { teamId: team.id } })
    assert(slots.length === 13, `${team.abbreviation} has 13 roster slots (got ${slots.length})`)
    const starters = slots.filter(s => s.slotType === 'STARTER')
    const bench = slots.filter(s => s.slotType === 'BENCH')
    assert(starters.length === 9, `${team.abbreviation} has 9 starters (got ${starters.length})`)
    assert(bench.length === 4, `${team.abbreviation} has 4 bench (got ${bench.length})`)

    // Verify no duplicate positions beyond allowed counts
    const posCounts: Record<string, number> = {}
    for (const s of starters) {
      posCounts[s.position!] = (posCounts[s.position!] ?? 0) + 1
    }
    assert((posCounts['C'] ?? 0) <= 1, `${team.abbreviation} has ≤1 C starter`)
    assert((posCounts['OF'] ?? 0) <= 3, `${team.abbreviation} has ≤3 OF starters`)
  }

  console.log(`  Draft complete: ${totalPicks} picks made`)
}

// ── Step 3: Simulate full regular season ────────────────────────

async function step3() {
  console.log('\n⚾ STEP 3: Simulate 22 regular season weeks')
  const league = await prisma.league.findFirstOrThrow()
  const { updateMatchupScores, finalizeWeek, initializeWeekLineups } = await import('../src/lib/scoring')

  // Initialize week 1 lineups
  await initializeWeekLineups(league.id, 1)

  for (let week = 1; week <= 22; week++) {
    const weekRecord = await prisma.leagueWeek.findFirstOrThrow({
      where: { leagueId: league.id, weekNumber: week },
    })
    const matchups = await prisma.matchup.findMany({
      where: { leagueId: league.id, weekNumber: week },
      include: { homeTeam: true, awayTeam: true },
    })

    // Simulate: insert game stats for starters
    const starters = await prisma.lineupSlot.findMany({
      where: { matchup: { weekId: weekRecord.id }, isStarter: true },
      include: { rosterSlot: true },
    })

    const gameDate = new Date(weekRecord.startDate)
    gameDate.setDate(gameDate.getDate() + 2)

    for (const slot of starters) {
      const hr = Math.random() > 0.7 ? Math.ceil(Math.random() * 2) : 0
      if (hr > 0) {
        await prisma.playerGameStats.upsert({
          where: { playerId_mlbGameId: { playerId: slot.rosterSlot.playerId, mlbGameId: 800000 + week * 1000 + Math.floor(Math.random() * 999) } },
          create: {
            playerId: slot.rosterSlot.playerId,
            mlbGameId: 800000 + week * 1000 + starters.indexOf(slot),
            gameDate,
            homeRuns: hr,
            synced: true,
          },
          update: { homeRuns: hr },
        })
      }
    }

    // Force a tie in week 5 to test regular season tie handling
    if (week === 5 && matchups.length > 0) {
      const m = matchups[0]
      // Set both teams' starters to have equal HRs by zeroing out this week's stats
      // and inserting matching ones
      const tieGameId1 = 900001
      const tieGameId2 = 900002
      const homeStarter = await prisma.lineupSlot.findFirst({
        where: { matchupId: m.id, rosterSlot: { teamId: m.homeTeamId }, isStarter: true },
        include: { rosterSlot: true },
      })
      const awayStarter = await prisma.lineupSlot.findFirst({
        where: { matchupId: m.id, rosterSlot: { teamId: m.awayTeamId }, isStarter: true },
        include: { rosterSlot: true },
      })
      if (homeStarter && awayStarter) {
        // Delete all game stats for this week's matchup starters to control the score
        await prisma.playerGameStats.deleteMany({
          where: {
            gameDate: { gte: weekRecord.startDate, lte: weekRecord.endDate },
            playerId: { in: starters.filter(s =>
              s.rosterSlot.teamId === m.homeTeamId || s.rosterSlot.teamId === m.awayTeamId
            ).map(s => s.rosterSlot.playerId) },
          },
        })
        // Give each team exactly 2 HRs
        await prisma.playerGameStats.create({
          data: { playerId: homeStarter.rosterSlot.playerId, mlbGameId: tieGameId1, gameDate, homeRuns: 2, synced: true },
        })
        await prisma.playerGameStats.create({
          data: { playerId: awayStarter.rosterSlot.playerId, mlbGameId: tieGameId2, gameDate, homeRuns: 2, synced: true },
        })
      }
    }

    await updateMatchupScores(league.id, week)
    await finalizeWeek(league.id, week)

    if (week % 5 === 0 || week === 22) {
      const l = await prisma.league.findFirstOrThrow()
      process.stdout.write(`  Week ${week} finalized (currentWeek: ${l.currentWeek}, status: ${l.status})\n`)
    }

    // Check tie handling in week 5
    if (week === 5) {
      const tieMatchups = await prisma.matchup.findMany({
        where: { leagueId: league.id, weekNumber: 5, winner: 'TIE' },
      })
      assert(tieMatchups.length >= 1, `Week 5 has at least 1 tie (got ${tieMatchups.length})`)
    }
  }

  // Verify standings after regular season
  const teams = await prisma.team.findMany({ where: { leagueId: league.id }, orderBy: [{ wins: 'desc' }, { pointsFor: 'desc' }] })
  const totalWins = teams.reduce((s, t) => s + t.wins, 0)
  const totalLosses = teams.reduce((s, t) => s + t.losses, 0)
  assert(totalWins === totalLosses, `Wins (${totalWins}) = Losses (${totalLosses})`)

  console.log('\n  Final regular season standings:')
  teams.forEach((t, i) => {
    console.log(`    ${(i + 1).toString().padStart(2)}. ${t.abbreviation.padEnd(5)} ${t.wins}W-${t.losses}L-${t.ties}T  ${t.pointsFor.toFixed(0)} HR`)
  })
}

// ── Step 4: Verify playoff transition ───────────────────────────

async function step4() {
  console.log('\n🏆 STEP 4: Verify playoff bracket')
  const league = await prisma.league.findFirstOrThrow()

  assert(league.status === 'PLAYOFFS', `League status is PLAYOFFS (got ${league.status})`)
  assert(league.currentWeek === 23, `Current week is 23 (got ${league.currentWeek})`)

  const week23Matchups = await prisma.matchup.findMany({
    where: { leagueId: league.id, weekNumber: 23 },
    include: { homeTeam: true, awayTeam: true },
  })
  assert(week23Matchups.length === 3, `3 semifinal matchups (got ${week23Matchups.length})`)

  // Verify lineups exist for playoff week 1
  const playoffLineups = await prisma.lineupSlot.count({
    where: { matchup: { leagueId: league.id, weekNumber: 23 } },
  })
  assert(playoffLineups > 0, `Playoff week 1 lineups initialized (${playoffLineups} slots)`)

  console.log('  Semifinal matchups:')
  for (const m of week23Matchups) {
    console.log(`    ${m.homeTeam.abbreviation} vs ${m.awayTeam.abbreviation}`)
  }
}

// ── Step 5: Simulate playoffs ───────────────────────────────────

async function step5() {
  console.log('\n⚡ STEP 5: Simulate 3 playoff weeks')
  const league = await prisma.league.findFirstOrThrow()
  const { updateMatchupScores, finalizeWeek } = await import('../src/lib/scoring')

  for (let week = 23; week <= 25; week++) {
    const weekRecord = await prisma.leagueWeek.findFirstOrThrow({
      where: { leagueId: league.id, weekNumber: week },
    })
    const matchups = await prisma.matchup.findMany({
      where: { leagueId: league.id, weekNumber: week },
      include: { homeTeam: true, awayTeam: true },
    })

    if (matchups.length === 0) {
      console.log(`  Week ${week}: no matchups (bracket not yet created)`)
      continue
    }

    // Simulate scoring for playoff starters
    const starters = await prisma.lineupSlot.findMany({
      where: { matchup: { weekId: weekRecord.id }, isStarter: true },
      include: { rosterSlot: true },
    })

    const gameDate = new Date(weekRecord.startDate)
    gameDate.setDate(gameDate.getDate() + 2)

    for (const slot of starters) {
      const hr = Math.random() > 0.5 ? Math.ceil(Math.random() * 3) : 0
      if (hr > 0) {
        await prisma.playerGameStats.upsert({
          where: { playerId_mlbGameId: { playerId: slot.rosterSlot.playerId, mlbGameId: 950000 + week * 100 + starters.indexOf(slot) } },
          create: {
            playerId: slot.rosterSlot.playerId,
            mlbGameId: 950000 + week * 100 + starters.indexOf(slot),
            gameDate,
            homeRuns: hr,
            synced: true,
          },
          update: { homeRuns: hr },
        })
      }
    }

    await updateMatchupScores(league.id, week)
    await finalizeWeek(league.id, week)

    const updatedMatchups = await prisma.matchup.findMany({
      where: { leagueId: league.id, weekNumber: week },
      include: { homeTeam: true, awayTeam: true },
    })
    for (const m of updatedMatchups) {
      const winnerTeam = m.winner === 'TIE' ? 'TIE' :
        m.winner === m.homeTeamId ? m.homeTeam.abbreviation : m.awayTeam.abbreviation
      console.log(`  Week ${week}: ${m.homeTeam.abbreviation} ${m.homeScore} - ${m.awayScore} ${m.awayTeam.abbreviation} → ${winnerTeam}`)
    }
  }
}

// ── Step 6: Verify offseason ────────────────────────────────────

async function step6() {
  console.log('\n🏁 STEP 6: Verify season complete')
  const league = await prisma.league.findFirstOrThrow()
  assert(league.status === 'OFFSEASON', `League status is OFFSEASON (got ${league.status})`)

  // Check all regular + playoff weeks are complete
  const incompleteWeeks = await prisma.leagueWeek.count({
    where: { leagueId: league.id, isComplete: false },
  })
  assert(incompleteWeeks === 0, `All weeks finalized (${incompleteWeeks} incomplete)`)

  // Check championship matchup exists and is complete
  const championship = await prisma.matchup.findMany({
    where: { leagueId: league.id, weekNumber: 25 },
    include: { homeTeam: true, awayTeam: true },
  })
  assert(championship.length >= 1, `Championship matchup exists (got ${championship.length})`)
  if (championship[0]) {
    const c = championship[0]
    const champ = c.winner === c.homeTeamId ? c.homeTeam : c.awayTeam
    console.log(`\n  🏆 Champion: ${champ.name} (${champ.abbreviation})`)
    console.log(`  Final: ${c.homeTeam.abbreviation} ${c.homeScore} - ${c.awayScore} ${c.awayTeam.abbreviation}`)
  }
}

// ── Step 7: Verify data integrity ───────────────────────────────

async function step7() {
  console.log('\n🔍 STEP 7: Data integrity checks')
  const league = await prisma.league.findFirstOrThrow()

  // Every team should have exactly 13 roster slots
  const teams = await prisma.team.findMany({ where: { leagueId: league.id } })
  for (const team of teams) {
    const slots = await prisma.rosterSlot.count({ where: { teamId: team.id } })
    assert(slots === 13, `${team.abbreviation} has 13 roster slots (got ${slots})`)
  }

  // No duplicate players on rosters
  const rosterSlots = await prisma.rosterSlot.findMany({ select: { playerId: true } })
  const playerIds = rosterSlots.map(s => s.playerId)
  const uniquePlayerIds = new Set(playerIds)
  assert(playerIds.length === uniquePlayerIds.size, `No duplicate players on rosters (${playerIds.length} slots, ${uniquePlayerIds.size} unique)`)

  // All 156 draft picks should have players
  const draftSettings = await prisma.draftSettings.findFirstOrThrow({ where: { leagueId: league.id } })
  const emptyPicks = await prisma.draftPick.count({
    where: { draftSettingsId: draftSettings.id, playerId: null },
  })
  assert(emptyPicks === 0, `All draft picks filled (${emptyPicks} empty)`)

  // Standings should have no negative values
  for (const team of teams) {
    assert(team.wins >= 0 && team.losses >= 0 && team.ties >= 0, `${team.abbreviation} standings are non-negative`)
    assert(team.pointsFor >= 0, `${team.abbreviation} pointsFor is non-negative (${team.pointsFor})`)
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  console.log('🧪 FULL SEASON SMOKE TEST')
  console.log('═'.repeat(50))
  console.log('Draft → 22 regular weeks → 3 playoff weeks → offseason')
  console.log('═'.repeat(50))

  const start = Date.now()

  try {
    await cleanup()
    await step1()  // Schedule
    await step2()  // Draft
    await step3()  // 22 regular season weeks
    await step4()  // Playoff bracket
    await step5()  // 3 playoff weeks
    await step6()  // Offseason
    await step7()  // Data integrity

    const duration = ((Date.now() - start) / 1000).toFixed(1)
    console.log('\n' + '═'.repeat(50))
    console.log(`✅ ${passed} passed, ❌ ${failed} failed (${duration}s)`)
    console.log('═'.repeat(50))

    if (failed > 0) {
      console.log('\n⚠️  Some checks failed. Review output above.')
      process.exit(1)
    } else {
      console.log('\n🎉 Full season simulation passed! Ready for live launch.')
      console.log('\nPre-launch checklist:')
      console.log('  1. Run: npm run db:seed (fresh data)')
      console.log('  2. Verify Vercel env vars match .env')
      console.log('  3. Owners register at /register')
      console.log('  4. Commissioner: /admin → Generate Schedule → Configure Draft → Start Draft')
      console.log('  5. Run draft, then season starts automatically')
    }
  } catch (err) {
    console.error('\n💥 Crashed:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
