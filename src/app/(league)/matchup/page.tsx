import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
import { Zap, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import RefreshScoresButton from '@/components/RefreshScoresButton'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Matchup' }
export const revalidate = 60  // Revalidate every minute for live scores

async function getMatchupData(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { team: { include: { league: true } } },
  })

  const team = user.team!
  const league = team.league

  const currentWeek = await prisma.leagueWeek.findFirst({
    where: { leagueId: league.id, weekNumber: league.currentWeek },
  })

  if (!currentWeek) return null

  const matchup = await prisma.matchup.findFirst({
    where: {
      weekId: currentWeek.id,
      OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }],
    },
    include: {
      homeTeam: { include: { user: { select: { name: true } } } },
      awayTeam: { include: { user: { select: { name: true } } } },
    },
  })

  if (!matchup) return null

  // Get lineup details with player stats for this week
  const getTeamLineup = async (teamId: string) => {
    const slots = await prisma.lineupSlot.findMany({
      where: { matchupId: matchup.id, rosterSlot: { teamId } },
      include: {
        rosterSlot: {
          include: {
            player: {
              include: {
                gameStats: {
                  where: {
                    gameDate: { gte: currentWeek.startDate, lte: currentWeek.endDate },
                  },
                },
                seasonStats: {
                  where: { season: new Date().getFullYear() },
                  take: 1,
                },
              },
            },
          },
        },
      },
      orderBy: { position: 'asc' },
    })

    return slots.map(slot => ({
      position: slot.position,
      isStarter: slot.isStarter,
      locked: slot.locked,
      player: {
        id: slot.rosterSlot.player.id,
        fullName: slot.rosterSlot.player.fullName,
        positions: slot.rosterSlot.player.positions,
        mlbTeamAbbr: slot.rosterSlot.player.mlbTeamAbbr,
        status: slot.rosterSlot.player.status,
        seasonHR: slot.rosterSlot.player.seasonStats[0]?.homeRuns ?? 0,
        weeklyHR: slot.rosterSlot.player.gameStats.reduce((s, g) => s + g.homeRuns, 0),
      },
    }))
  }

  const [homeLineup, awayLineup] = await Promise.all([
    getTeamLineup(matchup.homeTeamId),
    getTeamLineup(matchup.awayTeamId),
  ])

  const isMyTeamHome = matchup.homeTeamId === team.id

  return {
    matchup,
    week: currentWeek,
    myTeam: isMyTeamHome ? matchup.homeTeam : matchup.awayTeam,
    opponentTeam: isMyTeamHome ? matchup.awayTeam : matchup.homeTeam,
    myScore: isMyTeamHome ? matchup.homeScore : matchup.awayScore,
    opponentScore: isMyTeamHome ? matchup.awayScore : matchup.homeScore,
    myLineup: isMyTeamHome ? homeLineup : awayLineup,
    opponentLineup: isMyTeamHome ? awayLineup : homeLineup,
    isMyTeamHome,
  }
}

const POSITION_ORDER = ['C', '1B', '2B', 'SS', '3B', 'OF', 'UTIL', 'BN']

function sortByPosition(slots: Array<{ position: string; isStarter: boolean; player: any }>) {
  return [...slots].sort((a, b) => {
    const ai = POSITION_ORDER.indexOf(a.position)
    const bi = POSITION_ORDER.indexOf(b.position)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
}

function PlayerRow({ slot, showScore = true }: { slot: any; showScore?: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 table-row ${!slot.isStarter ? 'opacity-60' : ''}`}>
      <span className="w-10 font-mono text-xs text-text-muted font-semibold">{slot.position}</span>
      <Link href={`/players/${slot.player.id}`} className="flex-1 min-w-0 hover:opacity-80 transition-opacity">
        <div className="text-sm font-medium text-text-primary truncate">{slot.player.fullName}</div>
        <div className="text-xs text-text-muted">{slot.player.mlbTeamAbbr ?? 'FA'} · {slot.player.positions.join('/')}</div>
      </Link>
      {showScore && slot.isStarter && (
        <div className={`font-display font-black text-xl w-8 text-right ${slot.player.weeklyHR > 0 ? 'text-brand' : 'text-text-muted'}`}>
          {slot.player.weeklyHR}
        </div>
      )}
      {(!showScore || !slot.isStarter) && (
        <div className="font-display font-semibold text-lg text-text-muted w-8 text-right">
          {slot.player.seasonHR}
        </div>
      )}
    </div>
  )
}

export default async function MatchupPage() {
  const user = await requireAuth()
  const data = await getMatchupData(user.id)

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Zap size={32} className="text-text-muted mx-auto mb-3" />
          <div className="text-text-secondary">No matchup scheduled</div>
        </div>
      </div>
    )
  }

  const { matchup, week, myTeam, opponentTeam, myScore, opponentScore, myLineup, opponentLineup } = data
  const myStarters = sortByPosition(myLineup.filter(s => s.isStarter))
  const myBench = myLineup.filter(s => !s.isStarter)
  const oppStarters = sortByPosition(opponentLineup.filter(s => s.isStarter))
  const oppBench = opponentLineup.filter(s => !s.isStarter)

  const leading = myScore > opponentScore ? 'me' : myScore < opponentScore ? 'opponent' : 'tied'

  return (
    <div className="space-y-6 animate-fade-in">
      {matchup.status !== 'COMPLETE' && (
        <div className="flex justify-end">
          <RefreshScoresButton />
        </div>
      )}
      {/* Scoreboard */}
      <div className="card overflow-hidden">
        <div className="bg-hero-gradient p-6 lg:p-8">
          <div className="flex items-center gap-2 mb-6">
            <Zap size={16} className="text-brand" />
            <span className="text-sm text-text-muted font-mono uppercase tracking-wider">
              Week {week.weekNumber} · {format(new Date(week.startDate), 'MMM d')} – {format(new Date(week.endDate), 'MMM d')}
            </span>
            {matchup.status === 'IN_PROGRESS' && (
              <span className="badge-brand ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-brand inline-block animate-pulse" />
                Live
              </span>
            )}
            {matchup.status === 'COMPLETE' && (
              <span className="badge-secondary ml-2">Final</span>
            )}
          </div>

          <div className="flex items-center justify-between">
            {/* My team */}
            <div className="flex-1 text-center">
              <div className={`font-display font-black text-7xl lg:text-8xl leading-none ${
                leading === 'me' ? 'text-brand glow-brand' : 'text-text-primary'
              }`}>
                {myScore.toFixed(0)}
              </div>
              <Link href={`/teams/${myTeam.id}`} className="mt-2 font-display font-bold text-lg text-text-secondary hover:text-brand transition-colors block">{myTeam.name}</Link>
              <div className="text-xs text-text-muted">{myTeam.abbreviation}</div>
            </div>

            <div className="px-8 text-center">
              <div className="font-display font-black text-3xl text-text-muted">VS</div>
              {leading !== 'tied' && (
                <div className={`text-xs mt-1 font-semibold ${leading === 'me' ? 'text-brand' : 'text-accent-red'}`}>
                  {leading === 'me' ? 'WINNING' : 'LOSING'} by {Math.abs(myScore - opponentScore).toFixed(0)}
                </div>
              )}
              {leading === 'tied' && <div className="text-xs mt-1 text-accent-amber font-semibold">TIED</div>}
            </div>

            {/* Opponent */}
            <div className="flex-1 text-center">
              <div className={`font-display font-black text-7xl lg:text-8xl leading-none ${
                leading === 'opponent' ? 'text-accent-red' : 'text-text-primary'
              }`}>
                {opponentScore.toFixed(0)}
              </div>
              <Link href={`/teams/${opponentTeam.id}`} className="mt-2 font-display font-bold text-lg text-text-secondary hover:text-brand transition-colors block">{opponentTeam.name}</Link>
              <div className="text-xs text-text-muted">{opponentTeam.abbreviation}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Side-by-side lineups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* My lineup */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-border bg-brand/5">
            <Link href={`/teams/${myTeam.id}`} className="font-display font-bold text-lg text-brand hover:underline">{myTeam.name}</Link>
            <div className="text-xs text-text-muted">Starting Lineup</div>
          </div>
          <div>
            <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-border/30">
              <span className="w-10 table-header">POS</span>
              <span className="flex-1 table-header">PLAYER</span>
              <span className="w-8 table-header text-right">HR</span>
            </div>
            {myStarters.map((slot, i) => <PlayerRow key={i} slot={slot} showScore={true} />)}
            <div className="px-4 py-2 border-t border-surface-border bg-surface-1/50">
              <div className="flex justify-between items-center">
                <span className="text-xs text-text-muted uppercase tracking-wider">Bench (no score)</span>
              </div>
            </div>
            {myBench.map((slot, i) => <PlayerRow key={i} slot={slot} showScore={false} />)}
          </div>
        </div>

        {/* Opponent lineup */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-border bg-surface-3/50">
            <Link href={`/teams/${opponentTeam.id}`} className="font-display font-bold text-lg text-text-primary hover:underline">{opponentTeam.name}</Link>
            <div className="text-xs text-text-muted">Starting Lineup</div>
          </div>
          <div>
            <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-border/30">
              <span className="w-10 table-header">POS</span>
              <span className="flex-1 table-header">PLAYER</span>
              <span className="w-8 table-header text-right">HR</span>
            </div>
            {oppStarters.map((slot, i) => <PlayerRow key={i} slot={slot} showScore={true} />)}
            <div className="px-4 py-2 border-t border-surface-border bg-surface-1/50">
              <span className="text-xs text-text-muted uppercase tracking-wider">Bench (no score)</span>
            </div>
            {oppBench.map((slot, i) => <PlayerRow key={i} slot={slot} showScore={false} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
