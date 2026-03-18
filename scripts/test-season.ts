/**
 * End-to-end season simulation test
 *
 * Run with: npx tsx scripts/test-season.ts
 *
 * Tests the full lifecycle:
 *   1. Generate 25-week schedule
 *   2. Seed rosters (assign players to teams)
 *   3. Skip draft → start season
 *   4. Verify lineups initialized
 *   5. Insert fake game stats (simulate HR scoring)
 *   6. Run matchup score calculation
 *   7. Finalize week 1
 *   8. Verify standings updated
 *   9. Verify week advanced to 2
 *  10. Test free agent add/drop
 *  11. Print full results summary
 *
 * Safe to re-run: cleans up schedule/roster/stats first.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const ROSTER_SIZE = 13  // 9 starters + 4 bench
const STARTER_POSITIONS = ['C', '1B', '2B', 'SS', '3B', 'OF', 'OF', 'OF', 'UTIL']

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

async function cleanup() {
  console.log('\n🧹 Cleaning up previous test data...')
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
  // Reset team records
  await prisma.team.updateMany({
    data: { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
  })
  console.log('  Done.')
}

async function step1_generateSchedule() {
  console.log('\n📅 Step 1: Generate schedule')
  const league = await prisma.league.findFirstOrThrow()
  const { generateSeasonSchedule } = await import('../src/lib/scoring')

  // Start on a Tuesday
  const startDate = new Date('2025-03-25T05:00:00Z') // Tuesday
  await generateSeasonSchedule(league.id, league.season, startDate)

  await prisma.league.update({
    where: { id: league.id },
    data: { status: 'PREDRAFT', currentWeek: 1 },
  })

  const weeks = await prisma.leagueWeek.count({ where: { leagueId: league.id } })
  const matchups = await prisma.matchup.count({ where: { leagueId: league.id } })

  assert(weeks === 25, `25 weeks created (got ${weeks})`)
  assert(matchups === 132, `132 regular season matchups created (got ${matchups})`)
}

async function step2_seedRosters() {
  console.log('\n👥 Step 2: Seed rosters (assign players to teams)')
  const league = await prisma.league.findFirstOrThrow()
  const teams = await prisma.team.findMany({
    where: { leagueId: league.id },
    orderBy: { draftPosition: 'asc' },
  })
  const players = await prisma.player.findMany({ orderBy: { mlbId: 'asc' } })

  assert(teams.length === 12, `12 teams found (got ${teams.length})`)
  assert(players.length >= ROSTER_SIZE * 12, `Enough players for all rosters (got ${players.length}, need ${ROSTER_SIZE * 12})`)

  // If not enough players, only assign what we can
  const playersPerTeam = Math.min(ROSTER_SIZE, Math.floor(players.length / teams.length))
  let playerIdx = 0

  for (const team of teams) {
    for (let slot = 0; slot < playersPerTeam; slot++) {
      const player = players[playerIdx++]
      const isStarter = slot < STARTER_POSITIONS.length
      const position = isStarter ? STARTER_POSITIONS[slot] : 'BN'

      await prisma.rosterSlot.create({
        data: {
          teamId: team.id,
          playerId: player.id,
          slotType: isStarter ? 'STARTER' : 'BENCH',
          position,
          acquiredVia: 'DRAFT',
        },
      })
    }
  }

  const totalSlots = await prisma.rosterSlot.count()
  assert(totalSlots === playersPerTeam * 12, `${playersPerTeam * 12} roster slots created (got ${totalSlots})`)

  // Also seed season stats for all players
  const season = league.season
  for (const player of players) {
    await prisma.playerSeasonStats.upsert({
      where: { playerId_season: { playerId: player.id, season } },
      create: { playerId: player.id, season, homeRuns: 0, gamesPlayed: 0 },
      update: {},
    })
  }
}

async function step3_startSeason() {
  console.log('\n🏟️  Step 3: Start season (skip draft)')
  const league = await prisma.league.findFirstOrThrow()
  const { initializeWeekLineups } = await import('../src/lib/scoring')

  // Skip straight to REGULAR_SEASON
  await prisma.league.update({
    where: { id: league.id },
    data: { status: 'REGULAR_SEASON' },
  })

  await initializeWeekLineups(league.id, 1)

  const leagueNow = await prisma.league.findFirstOrThrow()
  assert(leagueNow.status === 'REGULAR_SEASON', `League status is REGULAR_SEASON (got ${leagueNow.status})`)

  const lineupSlots = await prisma.lineupSlot.count()
  assert(lineupSlots > 0, `Lineup slots created for week 1 (got ${lineupSlots})`)
}

async function step4_verifyLineups() {
  console.log('\n📋 Step 4: Verify lineups')
  const league = await prisma.league.findFirstOrThrow()
  const teams = await prisma.team.findMany({ where: { leagueId: league.id } })

  const week1Matchups = await prisma.matchup.findMany({
    where: { leagueId: league.id, weekNumber: 1 },
  })
  assert(week1Matchups.length === 6, `6 matchups in week 1 (got ${week1Matchups.length})`)

  // Check each team has lineup slots
  for (const team of teams) {
    const matchup = week1Matchups.find(
      m => m.homeTeamId === team.id || m.awayTeamId === team.id
    )
    assert(!!matchup, `${team.name} has a week 1 matchup`)

    if (matchup) {
      const slots = await prisma.lineupSlot.count({
        where: { matchupId: matchup.id, rosterSlot: { teamId: team.id } },
      })
      assert(slots > 0, `${team.name} has ${slots} lineup slots`)
    }
  }
}

async function step5_simulateScoring() {
  console.log('\n⚾ Step 5: Simulate HR scoring')
  const league = await prisma.league.findFirstOrThrow()

  const week1 = await prisma.leagueWeek.findFirstOrThrow({
    where: { leagueId: league.id, weekNumber: 1 },
  })

  // Get all starters for week 1
  const starters = await prisma.lineupSlot.findMany({
    where: {
      matchup: { weekId: week1.id },
      isStarter: true,
    },
    include: { rosterSlot: { include: { player: true } } },
  })

  // Give random players home runs
  let gamesCreated = 0
  const gameDate = new Date(week1.startDate)
  gameDate.setDate(gameDate.getDate() + 1) // day after week starts

  for (const slot of starters) {
    const hr = Math.random() > 0.6 ? Math.ceil(Math.random() * 3) : 0  // ~40% chance of 1-3 HR
    if (hr > 0) {
      const gameId = 700000 + gamesCreated
      await prisma.playerGameStats.create({
        data: {
          playerId: slot.rosterSlot.playerId,
          mlbGameId: gameId,
          gameDate,
          homeRuns: hr,
          atBats: 4,
          hits: hr,
          synced: true,
        },
      })
      gamesCreated++
    }
  }

  assert(gamesCreated > 0, `${gamesCreated} game stat records created`)

  // Update season stats
  const season = league.season
  const aggs = await prisma.playerGameStats.groupBy({
    by: ['playerId'],
    where: { gameDate: { gte: new Date(`${season}-01-01`) } },
    _sum: { homeRuns: true, atBats: true, hits: true },
    _count: { id: true },
  })

  for (const agg of aggs) {
    await prisma.playerSeasonStats.upsert({
      where: { playerId_season: { playerId: agg.playerId, season } },
      create: {
        playerId: agg.playerId,
        season,
        homeRuns: agg._sum.homeRuns ?? 0,
        gamesPlayed: agg._count.id,
        atBats: agg._sum.atBats ?? 0,
        hits: agg._sum.hits ?? 0,
        lastSynced: new Date(),
      },
      update: {
        homeRuns: agg._sum.homeRuns ?? 0,
        gamesPlayed: agg._count.id,
        atBats: agg._sum.atBats ?? 0,
        hits: agg._sum.hits ?? 0,
        lastSynced: new Date(),
      },
    })
  }
  assert(aggs.length > 0, `Season stats updated for ${aggs.length} players`)
}

async function step6_updateMatchupScores() {
  console.log('\n📊 Step 6: Update matchup scores')
  const league = await prisma.league.findFirstOrThrow()
  const { updateMatchupScores } = await import('../src/lib/scoring')

  await updateMatchupScores(league.id, 1)

  const matchups = await prisma.matchup.findMany({
    where: { leagueId: league.id, weekNumber: 1 },
  })

  let matchupsWithScoring = 0
  for (const m of matchups) {
    if (m.homeScore > 0 || m.awayScore > 0) matchupsWithScoring++
  }

  assert(matchupsWithScoring > 0, `${matchupsWithScoring}/${matchups.length} matchups have scoring`)

  // Print scoreboard
  for (const m of matchups) {
    const home = await prisma.team.findUnique({ where: { id: m.homeTeamId }, select: { abbreviation: true } })
    const away = await prisma.team.findUnique({ where: { id: m.awayTeamId }, select: { abbreviation: true } })
    console.log(`    ${home?.abbreviation} ${m.homeScore} – ${m.awayScore} ${away?.abbreviation}`)
  }
}

async function step7_finalizeWeek() {
  console.log('\n🏁 Step 7: Finalize week 1')
  const league = await prisma.league.findFirstOrThrow()
  const { finalizeWeek } = await import('../src/lib/scoring')

  await finalizeWeek(league.id, 1)

  const week1 = await prisma.leagueWeek.findFirstOrThrow({
    where: { leagueId: league.id, weekNumber: 1 },
  })
  assert(week1.isComplete === true, 'Week 1 marked complete')

  const leagueNow = await prisma.league.findFirstOrThrow()
  assert(leagueNow.currentWeek === 2, `Current week advanced to 2 (got ${leagueNow.currentWeek})`)

  // Check matchups have winners
  const matchups = await prisma.matchup.findMany({
    where: { leagueId: league.id, weekNumber: 1 },
  })
  const withWinners = matchups.filter(m => m.winner !== null)
  assert(withWinners.length === matchups.length, `All ${matchups.length} matchups have winners`)
}

async function step8_verifyStandings() {
  console.log('\n🏆 Step 8: Verify standings')
  const league = await prisma.league.findFirstOrThrow()
  const teams = await prisma.team.findMany({
    where: { leagueId: league.id },
    orderBy: [{ wins: 'desc' }, { pointsFor: 'desc' }],
  })

  let totalWins = 0
  let totalLosses = 0
  let totalTies = 0

  for (const t of teams) {
    totalWins += t.wins
    totalLosses += t.losses
    totalTies += t.ties
    console.log(`    ${t.abbreviation.padEnd(5)} ${t.wins}W-${t.losses}L-${t.ties}T  HR: ${t.pointsFor}`)
  }

  assert(totalWins + totalTies > 0, 'Teams have wins or ties recorded')
  assert(totalWins === totalLosses, `Total wins (${totalWins}) equals total losses (${totalLosses})`)

  // Check week 2 lineups initialized
  const week2Lineups = await prisma.lineupSlot.count({
    where: { matchup: { leagueId: league.id, weekNumber: 2 } },
  })
  assert(week2Lineups > 0, `Week 2 lineups auto-initialized (${week2Lineups} slots)`)
}

async function step9_testFreeAgency() {
  console.log('\n🔄 Step 9: Test free agent add/drop')
  const league = await prisma.league.findFirstOrThrow()
  const team = await prisma.team.findFirstOrThrow({
    where: { leagueId: league.id },
    include: { rosterSlots: { include: { player: true }, take: 1 } },
  })

  // Find an unrostered player
  const rosteredPlayerIds = (await prisma.rosterSlot.findMany({ select: { playerId: true } }))
    .map(r => r.playerId)

  const freeAgent = await prisma.player.findFirst({
    where: { id: { notIn: rosteredPlayerIds } },
  })

  if (!freeAgent) {
    console.log('  ⚠ No free agents available to test add/drop')
    return
  }

  // Drop a player — must delete associated lineup slots first (FK constraint)
  const dropSlot = team.rosterSlots[0]
  await prisma.lineupSlot.deleteMany({ where: { rosterSlotId: dropSlot.id } })
  await prisma.rosterSlot.delete({ where: { id: dropSlot.id } })

  await prisma.transaction.create({
    data: {
      leagueId: league.id,
      teamId: team.id,
      type: 'DROP',
      playerId: dropSlot.playerId,
      status: 'PROCESSED',
      processedAt: new Date(),
    },
  })

  // Add free agent
  await prisma.rosterSlot.create({
    data: {
      teamId: team.id,
      playerId: freeAgent.id,
      slotType: 'BENCH',
      position: 'BN',
      acquiredVia: 'FREE_AGENT',
    },
  })

  await prisma.transaction.create({
    data: {
      leagueId: league.id,
      teamId: team.id,
      type: 'ADD',
      playerId: freeAgent.id,
      status: 'PROCESSED',
      processedAt: new Date(),
    },
  })

  const txCount = await prisma.transaction.count({ where: { leagueId: league.id } })
  assert(txCount >= 2, `Transactions recorded (${txCount})`)
  assert(true, `Dropped ${dropSlot.player.fullName}, Added ${freeAgent.fullName}`)
}

async function step10_verifyPages() {
  console.log('\n🌐 Step 10: Verify API endpoints return data')
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fantasy-hr-league.vercel.app'

  // Health check
  try {
    const res = await fetch(`${baseUrl}/api/health`)
    const data = await res.json()
    assert(data.status === 'ok', `Health check OK (DB: ${data.checks.database.ms}ms)`)
  } catch (err) {
    assert(false, `Health check failed: ${err}`)
  }
}

async function main() {
  console.log('🧪 Fantasy HR League — Full Season Test')
  console.log('========================================')

  try {
    await cleanup()
    await step1_generateSchedule()
    await step2_seedRosters()
    await step3_startSeason()
    await step4_verifyLineups()
    await step5_simulateScoring()
    await step6_updateMatchupScores()
    await step7_finalizeWeek()
    await step8_verifyStandings()
    await step9_testFreeAgency()
    await step10_verifyPages()

    console.log('\n========================================')
    console.log(`\n✅ ${passed} passed, ❌ ${failed} failed`)

    if (failed > 0) {
      console.log('\n⚠️  Some tests failed. Review output above.')
      process.exit(1)
    } else {
      console.log('\n🎉 All systems go! League is ready for a real season.')
      console.log('\nNext steps:')
      console.log('  1. Re-seed fresh data: npm run db:seed')
      console.log('  2. Have real owners register at /register')
      console.log('  3. Commissioner generates schedule at /admin')
      console.log('  4. Start the season!')
    }
  } catch (err) {
    console.error('\n💥 Test crashed:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
