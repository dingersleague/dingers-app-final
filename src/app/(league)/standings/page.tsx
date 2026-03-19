import { optionalAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Trophy, TrendingUp, TrendingDown } from 'lucide-react'
import Link from 'next/link'
import TeamLogo from '@/components/TeamLogo'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Standings' }

async function getStandings(leagueId: string) {
  const teams = await prisma.team.findMany({
    where: { leagueId },
    include: {
      user: { select: { name: true } },
      homeMatchups: {
        where: { status: 'COMPLETE' },
        orderBy: { weekNumber: 'desc' },
        take: 5,
        select: { homeScore: true, awayScore: true, homeTeamId: true },
      },
      awayMatchups: {
        where: { status: 'COMPLETE' },
        orderBy: { weekNumber: 'desc' },
        take: 5,
        select: { homeScore: true, awayScore: true, awayTeamId: true },
      },
    },
    orderBy: [{ wins: 'desc' }, { pointsFor: 'desc' }],
  })

  return teams.map((team, i) => {
    const gamesPlayed = team.wins + team.losses + team.ties
    const pct = gamesPlayed > 0 ? team.wins / gamesPlayed : 0

    // Last 5 results
    const allMatchups = [
      ...team.homeMatchups.map(m => ({ score: m.homeScore, opp: m.awayScore })),
      ...team.awayMatchups.map(m => ({ score: m.awayScore, opp: m.homeScore })),
    ]
    .sort(() => -1)  // already ordered desc; mix home+away
    .slice(0, 5)

    const last5 = allMatchups.map(m =>
      m.score > m.opp ? 'W' : m.score < m.opp ? 'L' : 'T'
    )

    // Streak
    let streakCount = 0
    let streakType = ''
    for (const result of last5) {
      if (streakType === '' || result === streakType) {
        streakType = result
        streakCount++
      } else break
    }
    const streak = streakType ? `${streakType}${streakCount}` : '-'

    return {
      rank: i + 1,
      team,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      pct,
      pointsFor: team.pointsFor,
      pointsAgainst: team.pointsAgainst,
      streak,
      last5,
    }
  })
}

export default async function StandingsPage() {
  const user = await optionalAuth()
  let myTeamId: string | null = null
  let leagueId: string | null = null

  if (user) {
    const userWithTeam = await prisma.user.findUnique({
      where: { id: user.id },
      include: { team: true },
    })
    myTeamId = userWithTeam?.team?.id ?? null
    leagueId = userWithTeam?.team?.leagueId ?? null
  }

  if (!leagueId) {
    const league = await prisma.league.findFirst({ select: { id: true } })
    leagueId = league?.id ?? null
  }
  if (!leagueId) return null

  const standings = await getStandings(leagueId)

  // Playoff picture: top 6 teams make playoffs in a 12-team league
  const PLAYOFF_SPOTS = 6

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="font-display font-black text-4xl tracking-tight">Standings</h1>
        <p className="text-text-muted text-sm mt-1">Top {PLAYOFF_SPOTS} teams advance to playoffs</p>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-surface-border">
              <th className="px-4 py-3 text-left table-header w-8">#</th>
              <th className="px-4 py-3 text-left table-header">Team</th>
              <th className="px-4 py-3 text-center table-header">W</th>
              <th className="px-4 py-3 text-center table-header">L</th>
              <th className="px-4 py-3 text-center table-header hidden sm:table-cell">T</th>
              <th className="px-4 py-3 text-center table-header">PCT</th>
              <th className="px-4 py-3 text-center table-header hidden md:table-cell">HR+</th>
              <th className="px-4 py-3 text-center table-header hidden md:table-cell">HR−</th>
              <th className="px-4 py-3 text-center table-header hidden lg:table-cell">DIFF</th>
              <th className="px-4 py-3 text-center table-header hidden lg:table-cell">STRK</th>
              <th className="px-4 py-3 text-center table-header hidden xl:table-cell">L5</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, i) => {
              const isPlayoffCutLine = i === PLAYOFF_SPOTS - 1
              const inPlayoffs = i < PLAYOFF_SPOTS
              const isMe = row.team.id === myTeamId
              const diff = row.pointsFor - row.pointsAgainst

              return (
                <>
                  <tr
                    key={row.team.id}
                    className={`table-row ${isMe ? 'bg-brand/5' : ''}`}
                  >
                    {/* Rank */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center">
                        {i === 0 ? (
                          <Trophy size={14} className="text-accent-amber" />
                        ) : (
                          <span className={`font-display font-bold text-base ${inPlayoffs ? 'text-brand' : 'text-text-muted'}`}>
                            {row.rank}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Team name */}
                    <td className="px-4 py-3">
                      <Link href={`/teams/${row.team.id}`} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                        <TeamLogo
                          logoUrl={row.team.logoUrl}
                          abbreviation={row.team.abbreviation}
                          primaryColor={row.team.primaryColor}
                          secondaryColor={row.team.secondaryColor}
                          size="sm"
                        />
                        <div>
                          <div className={`font-medium text-sm ${isMe ? 'text-brand' : 'text-text-primary'}`}>
                            {row.team.name}
                            {isMe && <span className="ml-1.5 badge-brand text-xs">You</span>}
                          </div>
                          <div className="text-xs text-text-muted">{row.team.user.name}</div>
                        </div>
                      </Link>
                    </td>

                    <td className="px-4 py-3 text-center font-display font-bold text-base text-text-primary">{row.wins}</td>
                    <td className="px-4 py-3 text-center font-display font-bold text-base text-text-primary">{row.losses}</td>
                    <td className="px-4 py-3 text-center font-mono text-sm text-text-muted hidden sm:table-cell">{row.ties}</td>
                    <td className="px-4 py-3 text-center font-mono text-sm text-text-secondary">
                      {(row.pct * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-sm text-text-secondary hidden md:table-cell">
                      {row.pointsFor.toFixed(0)}
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-sm text-text-secondary hidden md:table-cell">
                      {row.pointsAgainst.toFixed(0)}
                    </td>
                    <td className={`px-4 py-3 text-center font-display font-bold text-sm hidden lg:table-cell ${
                      diff >= 0 ? 'text-brand' : 'text-accent-red'
                    }`}>
                      {diff >= 0 ? '+' : ''}{diff.toFixed(0)}
                    </td>
                    <td className="px-4 py-3 text-center hidden lg:table-cell">
                      <span className={`font-mono font-bold text-sm ${
                        row.streak.startsWith('W') ? 'text-brand' :
                        row.streak.startsWith('L') ? 'text-accent-red' : 'text-text-muted'
                      }`}>
                        {row.streak}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center hidden xl:table-cell">
                      <div className="flex items-center justify-center gap-0.5">
                        {row.last5.map((r, ri) => (
                          <span key={ri} className={`w-4 h-4 rounded-sm text-xs font-bold flex items-center justify-center ${
                            r === 'W' ? 'bg-brand/20 text-brand' :
                            r === 'L' ? 'bg-red-500/20 text-accent-red' :
                            'bg-surface-3 text-text-muted'
                          }`}>
                            {r}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>

                  {/* Playoff cut line */}
                  {isPlayoffCutLine && i < standings.length - 1 && (
                    <tr key="cutline">
                      <td colSpan={11} className="px-4 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-px bg-accent-amber/40" />
                          <span className="text-xs text-accent-amber font-mono uppercase tracking-wider whitespace-nowrap">
                            Playoff Cut Line
                          </span>
                          <div className="flex-1 h-px bg-accent-amber/40" />
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
