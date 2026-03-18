import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Trophy, Users } from 'lucide-react'
import TeamLogo from '@/components/TeamLogo'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { id: string } }) {
  const team = await prisma.team.findUnique({
    where: { id: params.id },
    select: { name: true },
  })
  return { title: team?.name ?? 'Team' }
}

export default async function TeamPage({ params }: { params: { id: string } }) {
  await requireAuth()
  const season = new Date().getFullYear()

  const team = await prisma.team.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { name: true } },
      league: { select: { id: true, name: true, season: true } },
      rosterSlots: {
        include: {
          player: {
            include: {
              seasonStats: { where: { season }, take: 1 },
            },
          },
        },
        orderBy: { slotType: 'asc' },
      },
      homeMatchups: {
        where: { status: 'COMPLETE' },
        orderBy: { weekNumber: 'desc' },
        take: 10,
        include: { awayTeam: { select: { id: true, name: true, abbreviation: true } } },
      },
      awayMatchups: {
        where: { status: 'COMPLETE' },
        orderBy: { weekNumber: 'desc' },
        take: 10,
        include: { homeTeam: { select: { id: true, name: true, abbreviation: true } } },
      },
    },
  })

  if (!team) notFound()

  const starters = team.rosterSlots.filter(s => s.slotType === 'STARTER')
  const bench = team.rosterSlots.filter(s => s.slotType === 'BENCH')
  const totalSeasonHR = team.rosterSlots.reduce(
    (sum, s) => sum + (s.player.seasonStats[0]?.homeRuns ?? 0), 0
  )

  // Build recent results
  const recentGames = [
    ...team.homeMatchups.map(m => ({
      weekNumber: m.weekNumber,
      opponent: m.awayTeam,
      myScore: m.homeScore,
      oppScore: m.awayScore,
      result: m.homeScore > m.awayScore ? 'W' : m.homeScore < m.awayScore ? 'L' : 'T',
    })),
    ...team.awayMatchups.map(m => ({
      weekNumber: m.weekNumber,
      opponent: m.homeTeam,
      myScore: m.awayScore,
      oppScore: m.homeScore,
      result: m.awayScore > m.homeScore ? 'W' : m.awayScore < m.homeScore ? 'L' : 'T',
    })),
  ].sort((a, b) => b.weekNumber - a.weekNumber).slice(0, 10)

  // Standings rank
  const allTeams = await prisma.team.findMany({
    where: { leagueId: team.leagueId },
    orderBy: [{ wins: 'desc' }, { pointsFor: 'desc' }],
    select: { id: true },
  })
  const rank = allTeams.findIndex(t => t.id === team.id) + 1

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div>
        <Link href="/standings" className="inline-flex items-center gap-1 text-text-muted text-sm hover:text-text-primary mb-4">
          <ArrowLeft size={14} /> Back to standings
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <TeamLogo
              logoUrl={team.logoUrl}
              abbreviation={team.abbreviation}
              primaryColor={team.primaryColor}
              secondaryColor={team.secondaryColor}
              size="xl"
            />
            <div>
              <h1 className="font-display font-black text-4xl tracking-tight leading-tight"
                  style={team.primaryColor ? { color: team.primaryColor } : undefined}>
                {team.name}
              </h1>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="badge-secondary font-mono">{team.abbreviation}</span>
                <span className="text-text-muted text-sm">Owner: {team.user.name}</span>
              </div>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="font-display font-black text-3xl text-text-primary leading-none">
              #{rank}
            </div>
            <div className="stat-label mt-1">Rank</div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Record', value: `${team.wins}-${team.losses}${team.ties > 0 ? `-${team.ties}` : ''}` },
          { label: 'HR Scored', value: team.pointsFor.toFixed(0), highlight: true },
          { label: 'HR Against', value: team.pointsAgainst.toFixed(0) },
          { label: 'Roster HR', value: totalSeasonHR, highlight: true },
          { label: 'FAAB', value: `$${team.faabBalance}` },
        ].map(stat => (
          <div key={stat.label} className="card p-4 text-center">
            <div className={`font-display font-black text-2xl ${stat.highlight ? 'text-brand' : 'text-text-primary'}`}>
              {stat.value}
            </div>
            <div className="stat-label mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Roster */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-border">
          <Users size={16} className="text-brand" />
          <h2 className="font-display font-bold text-xl">Roster ({team.rosterSlots.length})</h2>
        </div>

        {team.rosterSlots.length === 0 ? (
          <div className="px-5 py-10 text-center text-text-muted text-sm">No players on roster</div>
        ) : (
          <>
            {starters.length > 0 && (
              <div className="divide-y divide-surface-border/50">
                {starters.map(slot => (
                  <Link
                    key={slot.id}
                    href={`/players/${slot.player.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-surface-3/50 transition-colors"
                  >
                    <span className="badge-brand font-mono text-xs w-10 text-center">
                      {slot.position ?? 'UTIL'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary truncate">{slot.player.fullName}</div>
                      <div className="text-xs text-text-muted">
                        {slot.player.positions.join('/')} · {slot.player.mlbTeamAbbr ?? 'FA'}
                      </div>
                    </div>
                    <div className="font-display font-black text-xl text-brand">
                      {slot.player.seasonStats[0]?.homeRuns ?? 0}
                    </div>
                  </Link>
                ))}
              </div>
            )}
            {bench.length > 0 && (
              <>
                <div className="px-5 py-2 border-t border-surface-border bg-surface-1/50">
                  <span className="text-xs text-text-muted uppercase tracking-wider">Bench</span>
                </div>
                <div className="divide-y divide-surface-border/50">
                  {bench.map(slot => (
                    <Link
                      key={slot.id}
                      href={`/players/${slot.player.id}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-surface-3/50 transition-colors"
                    >
                      <span className="badge-secondary font-mono text-xs w-10 text-center">BN</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-text-primary truncate">{slot.player.fullName}</div>
                        <div className="text-xs text-text-muted">
                          {slot.player.positions.join('/')} · {slot.player.mlbTeamAbbr ?? 'FA'}
                        </div>
                      </div>
                      <div className="font-display font-bold text-lg text-text-muted">
                        {slot.player.seasonStats[0]?.homeRuns ?? 0}
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Recent Results */}
      {recentGames.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-border">
            <Trophy size={16} className="text-accent-amber" />
            <h2 className="font-display font-bold text-xl">Recent Results</h2>
          </div>
          <div className="divide-y divide-surface-border/50">
            {recentGames.map(game => (
              <div key={game.weekNumber} className="flex items-center gap-4 px-5 py-3">
                <span className="font-mono text-sm text-text-muted w-12">Wk {game.weekNumber}</span>
                <span className={`w-6 h-6 rounded-sm text-xs font-bold flex items-center justify-center ${
                  game.result === 'W' ? 'bg-brand/20 text-brand' :
                  game.result === 'L' ? 'bg-red-500/20 text-accent-red' :
                  'bg-surface-3 text-text-muted'
                }`}>
                  {game.result}
                </span>
                <span className="font-display font-bold text-lg text-text-primary">
                  {game.myScore}–{game.oppScore}
                </span>
                <span className="text-sm text-text-muted">vs</span>
                <Link
                  href={`/teams/${game.opponent.id}`}
                  className="text-sm text-text-secondary hover:text-brand transition-colors"
                >
                  {game.opponent.name}
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
