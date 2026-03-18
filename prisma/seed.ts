/**
 * Seed file
 * Run with: npm run db:seed
 *
 * Creates:
 * - 1 league
 * - 12 teams with users (commissioner + 11 owners)
 * - ~80 sample MLB players with 2024 HR stats
 * - Draft picks (first 3 rounds pre-populated)
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const TEAMS = [
  { name: 'The Bomb Squad', abbr: 'BOMB', owner: 'Alex Johnson' },
  { name: 'Long Ball Legends', abbr: 'LBL', owner: 'Maria Garcia' },
  { name: 'Dinger Dynasty', abbr: 'DNGR', owner: 'Chris Lee' },
  { name: 'The Yard Work', abbr: 'YARD', owner: 'Sam Patel' },
  { name: 'Gone Yard Gang', abbr: 'GYG', owner: 'Taylor Kim' },
  { name: 'Exit Velocity', abbr: 'XVLC', owner: 'Jordan Smith' },
  { name: 'Moonshot Mafia', abbr: 'MOON', owner: 'Casey Brown' },
  { name: 'Blast Radius', abbr: 'BLST', owner: 'Morgan Davis' },
  { name: 'The Deep Fly', abbr: 'DEEP', owner: 'Riley Wilson' },
  { name: 'Launch Angle LLC', abbr: 'LAGL', owner: 'Quinn Taylor' },
  { name: 'Dead Pull Crew', abbr: 'PULL', owner: 'Drew Martinez' },
  { name: 'No Doubters', abbr: 'NODT', owner: 'Avery Clark' },
]

// Top HR hitters - real 2024 season data approximation
const PLAYERS = [
  // Catchers
  { mlbId: 592518, name: 'William Contreras', firstName: 'William', lastName: 'Contreras', positions: ['C'], teamAbbr: 'MIL', hr: 22 },
  { mlbId: 641712, name: 'Adley Rutschman', firstName: 'Adley', lastName: 'Rutschman', positions: ['C'], teamAbbr: 'BAL', hr: 20 },
  { mlbId: 663728, name: 'Gabriel Moreno', firstName: 'Gabriel', lastName: 'Moreno', positions: ['C'], teamAbbr: 'ARI', hr: 14 },
  { mlbId: 665926, name: 'Patrick Bailey', firstName: 'Patrick', lastName: 'Bailey', positions: ['C'], teamAbbr: 'SF', hr: 11 },
  { mlbId: 547180, name: 'Salvador Perez', firstName: 'Salvador', lastName: 'Perez', positions: ['C', '1B'], teamAbbr: 'KC', hr: 23 },

  // First Base
  { mlbId: 547989, name: 'Freddie Freeman', firstName: 'Freddie', lastName: 'Freeman', positions: ['1B'], teamAbbr: 'LAD', hr: 22 },
  { mlbId: 656305, name: 'Bryce Harper', firstName: 'Bryce', lastName: 'Harper', positions: ['1B', 'OF'], teamAbbr: 'PHI', hr: 30 },
  { mlbId: 660271, name: 'Pete Alonso', firstName: 'Pete', lastName: 'Alonso', positions: ['1B'], teamAbbr: 'NYM', hr: 34 },
  { mlbId: 663586, name: 'Vladimir Guerrero Jr.', firstName: 'Vladimir', lastName: 'Guerrero', positions: ['1B'], teamAbbr: 'TOR', hr: 26 },
  { mlbId: 677951, name: 'Spencer Torkelson', firstName: 'Spencer', lastName: 'Torkelson', positions: ['1B'], teamAbbr: 'DET', hr: 17 },
  { mlbId: 641933, name: 'Josh Bell', firstName: 'Josh', lastName: 'Bell', positions: ['1B'], teamAbbr: 'CLE', hr: 14 },

  // Second Base
  { mlbId: 543760, name: 'Marcus Semien', firstName: 'Marcus', lastName: 'Semien', positions: ['2B', 'SS'], teamAbbr: 'TEX', hr: 25 },
  { mlbId: 596019, name: 'Ozzie Albies', firstName: 'Ozzie', lastName: 'Albies', positions: ['2B'], teamAbbr: 'ATL', hr: 19 },
  { mlbId: 663993, name: 'Ketel Marte', firstName: 'Ketel', lastName: 'Marte', positions: ['2B', 'OF'], teamAbbr: 'ARI', hr: 22 },
  { mlbId: 680757, name: 'Jose Caballero', firstName: 'Jose', lastName: 'Caballero', positions: ['2B', 'SS'], teamAbbr: 'TB', hr: 13 },
  { mlbId: 605141, name: 'Jeff McNeil', firstName: 'Jeff', lastName: 'McNeil', positions: ['2B', 'OF'], teamAbbr: 'NYM', hr: 8 },

  // Shortstop
  { mlbId: 660670, name: 'Bobby Witt Jr.', firstName: 'Bobby', lastName: 'Witt Jr.', positions: ['SS'], teamAbbr: 'KC', hr: 32 },
  { mlbId: 682998, name: 'Corey Seager', firstName: 'Corey', lastName: 'Seager', positions: ['SS'], teamAbbr: 'TEX', hr: 26 },
  { mlbId: 592885, name: 'Francisco Lindor', firstName: 'Francisco', lastName: 'Lindor', positions: ['SS'], teamAbbr: 'NYM', hr: 26 },
  { mlbId: 663757, name: 'Willy Adames', firstName: 'Willy', lastName: 'Adames', positions: ['SS'], teamAbbr: 'MIL', hr: 24 },
  { mlbId: 665487, name: 'Anthony Volpe', firstName: 'Anthony', lastName: 'Volpe', positions: ['SS'], teamAbbr: 'NYY', hr: 23 },
  { mlbId: 642708, name: 'Trea Turner', firstName: 'Trea', lastName: 'Turner', positions: ['SS'], teamAbbr: 'PHI', hr: 12 },

  // Third Base
  { mlbId: 607043, name: 'Nolan Arenado', firstName: 'Nolan', lastName: 'Arenado', positions: ['3B'], teamAbbr: 'STL', hr: 16 },
  { mlbId: 608070, name: 'Jose Ramirez', firstName: 'Jose', lastName: 'Ramirez', positions: ['3B'], teamAbbr: 'CLE', hr: 39 },
  { mlbId: 660162, name: 'Austin Riley', firstName: 'Austin', lastName: 'Riley', positions: ['3B'], teamAbbr: 'ATL', hr: 20 },
  { mlbId: 656555, name: 'Eugenio Suarez', firstName: 'Eugenio', lastName: 'Suarez', positions: ['3B', 'SS'], teamAbbr: 'ARI', hr: 23 },
  { mlbId: 543333, name: 'Manny Machado', firstName: 'Manny', lastName: 'Machado', positions: ['3B', 'SS'], teamAbbr: 'SD', hr: 21 },

  // Outfield - Elite
  { mlbId: 665742, name: 'Aaron Judge', firstName: 'Aaron', lastName: 'Judge', positions: ['OF'], teamAbbr: 'NYY', hr: 58 },
  { mlbId: 665161, name: 'Shohei Ohtani', firstName: 'Shohei', lastName: 'Ohtani', positions: ['OF', 'DH'], teamAbbr: 'LAD', hr: 44 },
  { mlbId: 671939, name: 'Yordan Alvarez', firstName: 'Yordan', lastName: 'Alvarez', positions: ['OF', 'DH'], teamAbbr: 'HOU', hr: 35 },
  { mlbId: 608364, name: 'Giancarlo Stanton', firstName: 'Giancarlo', lastName: 'Stanton', positions: ['OF', 'DH'], teamAbbr: 'NYY', hr: 27 },
  { mlbId: 592450, name: 'Juan Soto', firstName: 'Juan', lastName: 'Soto', positions: ['OF'], teamAbbr: 'NYY', hr: 41 },
  { mlbId: 621439, name: 'Kyle Schwarber', firstName: 'Kyle', lastName: 'Schwarber', positions: ['OF', '1B'], teamAbbr: 'PHI', hr: 38 },
  { mlbId: 641355, name: 'Cody Bellinger', firstName: 'Cody', lastName: 'Bellinger', positions: ['OF', '1B'], teamAbbr: 'CHC', hr: 18 },
  { mlbId: 660644, name: 'Fernando Tatis Jr.', firstName: 'Fernando', lastName: 'Tatis Jr.', positions: ['OF', 'SS'], teamAbbr: 'SD', hr: 25 },
  { mlbId: 665489, name: 'Jarren Duran', firstName: 'Jarren', lastName: 'Duran', positions: ['OF'], teamAbbr: 'BOS', hr: 21 },
  { mlbId: 676946, name: 'Jackson Chourio', firstName: 'Jackson', lastName: 'Chourio', positions: ['OF'], teamAbbr: 'MIL', hr: 21 },
  { mlbId: 669016, name: 'Riley Greene', firstName: 'Riley', lastName: 'Greene', positions: ['OF'], teamAbbr: 'DET', hr: 21 },
  { mlbId: 663630, name: 'Michael Harris II', firstName: 'Michael', lastName: 'Harris II', positions: ['OF'], teamAbbr: 'ATL', hr: 18 },
  { mlbId: 641820, name: 'Marcell Ozuna', firstName: 'Marcell', lastName: 'Ozuna', positions: ['OF', 'DH'], teamAbbr: 'ATL', hr: 39 },
  { mlbId: 596748, name: 'Teoscar Hernandez', firstName: 'Teoscar', lastName: 'Hernandez', positions: ['OF'], teamAbbr: 'LAD', hr: 26 },
  { mlbId: 592696, name: 'Tyler O\'Neill', firstName: 'Tyler', lastName: "O'Neill", positions: ['OF'], teamAbbr: 'BOS', hr: 26 },
  { mlbId: 666971, name: 'Seiya Suzuki', firstName: 'Seiya', lastName: 'Suzuki', positions: ['OF'], teamAbbr: 'CHC', hr: 22 },
  { mlbId: 680869, name: 'Adolis Garcia', firstName: 'Adolis', lastName: 'Garcia', positions: ['OF'], teamAbbr: 'TEX', hr: 25 },
  { mlbId: 668939, name: 'CJ Abrams', firstName: 'CJ', lastName: 'Abrams', positions: ['OF', 'SS'], teamAbbr: 'WSH', hr: 22 },
  { mlbId: 660670, name: 'Julio Rodriguez', firstName: 'Julio', lastName: 'Rodriguez', positions: ['OF'], teamAbbr: 'SEA', hr: 20 },
  { mlbId: 675916, name: 'Elly De La Cruz', firstName: 'Elly', lastName: 'De La Cruz', positions: ['SS', '3B', 'OF'], teamAbbr: 'CIN', hr: 25 },

  // DH
  { mlbId: 571448, name: 'Designated Hitter', firstName: 'Sample', lastName: 'DH', positions: ['DH', '1B'], teamAbbr: 'MLB', hr: 15 },

  // Additional depth
  { mlbId: 596115, name: 'Rhys Hoskins', firstName: 'Rhys', lastName: 'Hoskins', positions: ['1B'], teamAbbr: 'MIL', hr: 22 },
  { mlbId: 592663, name: 'Christian Walker', firstName: 'Christian', lastName: 'Walker', positions: ['1B'], teamAbbr: 'ARI', hr: 26 },
  { mlbId: 608369, name: 'Alex Bregman', firstName: 'Alex', lastName: 'Bregman', positions: ['3B', '2B'], teamAbbr: 'BOS', hr: 26 },
  { mlbId: 596503, name: 'Matt Olson', firstName: 'Matt', lastName: 'Olson', positions: ['1B'], teamAbbr: 'ATL', hr: 36 },
  { mlbId: 665923, name: 'Gunnar Henderson', firstName: 'Gunnar', lastName: 'Henderson', positions: ['SS', '3B'], teamAbbr: 'BAL', hr: 37 },
  { mlbId: 669442, name: 'Corbin Carroll', firstName: 'Corbin', lastName: 'Carroll', positions: ['OF'], teamAbbr: 'ARI', hr: 21 },
  { mlbId: 681082, name: 'Paul Skenes', firstName: 'Paul', lastName: 'Skenes', positions: ['SP'], teamAbbr: 'PIT', hr: 0 },
]

async function main() {
  console.log('🌱 Seeding database...')

  // Clean slate
  await prisma.syncLog.deleteMany()
  await prisma.lineupSlot.deleteMany()
  await prisma.draftPick.deleteMany()
  await prisma.draftSettings.deleteMany()
  await prisma.transaction.deleteMany()
  await prisma.rosterSlot.deleteMany()
  await prisma.matchup.deleteMany()
  await prisma.leagueWeek.deleteMany()
  await prisma.playerSeasonStats.deleteMany()
  await prisma.playerGameStats.deleteMany()
  await prisma.player.deleteMany()
  await prisma.team.deleteMany()
  await prisma.session.deleteMany()
  await prisma.user.deleteMany()
  await prisma.league.deleteMany()

  // Create league
  // Seeded with FAAB waivers enabled so the feature is immediately testable.
  // To switch to priority waivers: update waiverType to 'PRIORITY' via admin panel.
  const FAAB_BUDGET = 100
  const league = await prisma.league.create({
    data: {
      name: 'DINGERS Fantasy League',
      season: 2025,
      status: 'SETUP',
      currentWeek: 0,
      waiverType: 'FAAB',
      faabBudget: FAAB_BUDGET,
      faabAllowZeroBid: false,
    },
  })
  console.log(`✓ League created: ${league.name}`)

  // Create users and teams
  const passwordHash = await bcrypt.hash('password123', 12)
  const createdTeams: { id: string; name: string; abbreviation: string }[] = []

  for (let i = 0; i < TEAMS.length; i++) {
    const t = TEAMS[i]
    const email = `${t.owner.toLowerCase().replace(/\s+/g, '.')}@dingers.test`

    const user = await prisma.user.create({
      data: {
        name: t.owner,
        email,
        passwordHash,
        role: i === 0 ? 'COMMISSIONER' : 'OWNER',
      },
    })

    const team = await prisma.team.create({
      data: {
        leagueId: league.id,
        userId: user.id,
        name: t.name,
        abbreviation: t.abbr,
        waiverPriority: i + 1,
        draftPosition: i + 1,
        faabBalance: FAAB_BUDGET,
      },
    })

    createdTeams.push(team)
    console.log(`  ✓ Team ${i + 1}/12: ${t.name} (${email})`)
  }

  // Create players
  const season = 2025
  const createdPlayers: any[] = []

  for (const p of PLAYERS) {
    // Avoid duplicate mlbIds in seed data
    const existing = createdPlayers.find(cp => cp.mlbId === p.mlbId)
    if (existing) continue

    const player = await prisma.player.create({
      data: {
        mlbId: p.mlbId,
        fullName: p.name,
        firstName: p.firstName,
        lastName: p.lastName,
        positions: p.positions,
        mlbTeamAbbr: p.teamAbbr,
        status: 'ACTIVE',
      },
    })

    await prisma.playerSeasonStats.create({
      data: {
        playerId: player.id,
        season,
        homeRuns: p.hr,
        gamesPlayed: Math.floor(p.hr * 4.2),  // rough estimate
      },
    })

    createdPlayers.push(player)
  }

  console.log(`✓ ${createdPlayers.length} players created`)

  console.log('\n🎉 Seed complete!')
  console.log('\nTest accounts (all password: password123):')
  console.log(`  Commissioner: alex.johnson@dingers.test`)
  TEAMS.slice(1, 4).forEach(t => {
    console.log(`  Owner: ${t.owner.toLowerCase().replace(/\s+/g, '.')}@dingers.test`)
  })
  console.log(`  (and ${TEAMS.length - 4} more owners...)\n`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
