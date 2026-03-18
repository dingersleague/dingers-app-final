import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Trophy, TrendingUp, Zap, Clock, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Dashboard' }

async function getDashboardData(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      team: {
        include: {
          league: {
            include: {
              weeks: {
                where: { isComplete: false },
                orderBy: { weekNumber: 'asc' },
                take: 1,
              },
            },
          },
        },
      },
    },
  })

  const team = user.team
  if (!team) return null

  const league = team.league
  const currentWeek = league.weeks[0]

  // Current matchup
  const currentMatchup = currentWeek ? await prisma.matchup.findFirst({
    where: {
      weekId: currentWeek.id,
      OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }],
    },
    include: {
      homeTeam: true,
      awayTeam: true,
      week: true,
    },
  }) : null

  // Standings (top 5)
  const standings = await prisma.team.findMany({
    where: { leagueId: league.id },
    orderBy: [{ wins: 'desc' }, { pointsFor: 'desc' }],
    take: 5,
    select: {
      id: true, name: true, abbreviation: true,
      wins: true, losses: true, ties: true, pointsFor: true,
    },
  })

  // Recent transactions
  const recentTransactions = await prisma.transaction.findMany({
    where: { leagueId: league.id, status: 'PROCESSED' },
    orderBy: { processedAt: 'desc' },
    take: 8,
    include: {
      team: { select: { name: true, abbreviation: true } },
      player: { select: { id: true, fullName: true, positions: true } },
    },
  })

  // Top HR hitters this week (active starters)
  const topPlayers = await prisma.playerSeasonStats.findMany({
    where: { season: new Date().getFullYear() },
    orderBy: { homeRuns: 'desc' },
    take: 10,
    include: {
      player: {
        select: {
          fullName: true, mlbTeamAbbr: true, positions: true,
          rosterSlots: { select: { team: { select: { name: true } } } },
        },
      },
    },
  })

  return { team, league, currentWeek, currentMatchup, standings, recentTransactions, topPlayers }
}

export default async function DashboardPage() {
  const user = await requireAuth()
  const data = await getDashboardData(user.id)
  if (!data) redirect('/setup')

  const { team, league, currentWeek, currentMatchup, standings, recentTransactions, topPlayers } = data
  const isHome = currentMatchup?.homeTeamId === team.id
  const opponent = isHome ? currentMatchup?.awayTeam : currentMatchup?.homeTeam
  const myScore = isHome ? currentMatchup?.homeScore : currentMatchup?.awayScore
  const opponentScore = isHome ? currentMatchup?.awayScore : currentMatchup?.homeScore
  const winPct = team.wins + team.losses > 0
    ? ((team.wins / (team.wins + team.losses)) * 100).toFixed(1)
    : '—'

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <div className="text-text-muted text-sm font-mono uppercase tracking-widest mb-1">
          {league.name} · Season {league.season}
        </div>
        <h1 className="font-display font-black text-4xl text-text-primary tracking-tight">
          {team.name}
        </h1>
        <div className="flex items-center gap-4 mt-2">
          <span className="font-display font-bold text-lg text-brand">
            {team.wins}–{team.losses}{team.ties > 0 ? `–${team.ties}` : ''}
          </span>
          <span className="text-text-muted text-sm">{winPct}%</span>
          <span className="text-text-muted text-sm">{team.pointsFor.toFixed(0)} HR for</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Current Matchup Card */}
        <div className="lg:col-span-2">
          {currentMatchup ? (
            <Link href={`/matchup/${currentMatchup.id}`} className="card-hover p-6 block group">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Zap size={16} className="text-brand" />
                  <span className="text-sm text-text-muted font-mono uppercase tracking-wider">
                    Week {currentWeek?.weekNumber} Matchup
                  </span>
                </div>
                {currentMatchup.status === 'IN_PROGRESS' && (
                  <span className="badge-brand animate-pulse-brand">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand inline-block" />
                    Live
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between">
                {/* My Team */}
                <div className="flex-1">
                  <div className="text-text-muted text-xs uppercase tracking-wider mb-1">Your Score</div>
                  <div className="font-display font-black text-6xl text-text-primary leading-none">
                    {myScore ?? 0}
                  </div>
                  <div className="text-text-secondary text-sm mt-1 font-medium">{team.name}</div>
                </div>

                {/* VS */}
                <div className="px-6 text-center">
                  <div className="font-display font-black text-2xl text-text-muted">VS</div>
                  {currentWeek && (
                    <div className="text-xs text-text-muted mt-1 font-mono">
                      {format(new Date(currentWeek.startDate), 'MMM d')}–
                      {format(new Date(currentWeek.endDate), 'MMM d')}
                    </div>
                  )}
                </div>

                {/* Opponent */}
                <div className="flex-1 text-right">
                  <div className="text-text-muted text-xs uppercase tracking-wider mb-1">Opponent</div>
                  <div className={`font-display font-black text-6xl leading-none ${
                    (opponentScore ?? 0) > (myScore ?? 0) ? 'text-accent-red' : 'text-text-primary'
                  }`}>
                    {opponentScore ?? 0}
                  </div>
                  <div className="text-text-secondary text-sm mt-1 font-medium">{opponent?.name}</div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-surface-border flex items-center justify-between">
                <span className="text-text-muted text-xs">
                  {(myScore ?? 0) > (opponentScore ?? 0) ? '🔥 Leading' :
                   (myScore ?? 0) < (opponentScore ?? 0) ? '📉 Trailing' : '⚡ Tied'}
                </span>
                <span className="text-brand text-xs flex items-center gap-1 group-hover:gap-2 transition-all">
                  View full matchup <ChevronRight size={12} />
                </span>
              </div>
            </Link>
          ) : (
            <div className="card p-6 flex items-center justify-center h-40">
              <div className="text-center">
                <Clock size={24} className="text-text-muted mx-auto mb-2" />
                <div className="text-text-muted text-sm">No active matchup</div>
              </div>
            </div>
          )}
        </div>

        {/* Quick Stats */}
        <div className="space-y-3">
          <div className="card p-4">
            <div className="stat-label mb-2">Season Record</div>
            <div className="font-display font-black text-3xl text-text-primary">
              {team.wins}–{team.losses}
            </div>
          </div>
          <div className="card p-4">
            <div className="stat-label mb-2">HRs Scored</div>
            <div className="font-display font-black text-3xl text-brand">
              {team.pointsFor.toFixed(0)}
            </div>
          </div>
          <div className="card p-4">
            <div className="stat-label mb-2">HR Differential</div>
            <div className={`font-display font-black text-3xl ${
              team.pointsFor >= team.pointsAgainst ? 'text-brand' : 'text-accent-red'
            }`}>
              {team.pointsFor >= team.pointsAgainst ? '+' : ''}
              {(team.pointsFor - team.pointsAgainst).toFixed(0)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Standings preview */}
        <div className="card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
            <div className="flex items-center gap-2">
              <Trophy size={16} className="text-accent-amber" />
              <span className="font-medium text-sm">Standings</span>
            </div>
            <Link href="/standings" className="text-brand text-xs hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-surface-border/50">
            {standings.map((t: typeof standings[0], i: number) => (
              <div
                key={t.id}
                className={`flex items-center gap-3 px-5 py-3 ${t.id === team.id ? 'bg-brand/5' : ''}`}
              >
                <span className={`font-display font-bold text-lg w-6 text-center ${
                  i === 0 ? 'text-accent-amber' : 'text-text-muted'
                }`}>{i + 1}</span>
                <Link href={`/teams/${t.id}`} className={`flex-1 text-sm font-medium hover:underline ${t.id === team.id ? 'text-brand' : 'text-text-primary'}`}>
                  {t.name}
                </Link>
                <span className="font-mono text-sm text-text-secondary">{t.wins}–{t.losses}</span>
                <span className="font-mono text-xs text-text-muted">{t.pointsFor.toFixed(0)} HR</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-accent-blue" />
              <span className="font-medium text-sm">Activity</span>
            </div>
            <Link href="/transactions" className="text-brand text-xs hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-surface-border/50">
            {recentTransactions.length === 0 ? (
              <div className="px-5 py-8 text-center text-text-muted text-sm">No recent activity</div>
            ) : recentTransactions.map((tx: typeof recentTransactions[0]) => (
              <div key={tx.id} className="flex items-start gap-3 px-5 py-3">
                <span className={`text-lg leading-none mt-0.5 ${
                  tx.type.includes('ADD') ? 'text-brand' : 'text-accent-red'
                }`}>
                  {tx.type.includes('ADD') ? '+' : '−'}
                </span>
                <div className="flex-1 min-w-0">
                  <Link href={`/players/${tx.player.id}`} className="text-sm font-medium text-text-primary truncate hover:underline block">{tx.player.fullName}</Link>
                  <div className="text-xs text-text-muted">{tx.team.name} · {tx.type.replace('_', ' ').toLowerCase()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
