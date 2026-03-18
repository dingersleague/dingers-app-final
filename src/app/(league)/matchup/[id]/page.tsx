import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
import { Zap, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const revalidate = 60

export async function generateMetadata({ params }: { params: { id: string } }) {
  const matchup = await prisma.matchup.findUnique({
    where: { id: params.id },
    include: {
      homeTeam: { select: { abbreviation: true } },
      awayTeam: { select: { abbreviation: true } },
    },
  })
  if (!matchup) return { title: 'Matchup' }
  return {
    title: `${matchup.homeTeam.abbreviation} vs ${matchup.awayTeam.abbreviation} — Week ${matchup.weekNumber}`,
  }
}

async function getMatchupById(matchupId: string) {
  const matchup = await prisma.matchup.findUnique({
    where: { id: matchupId },
    include: {
      homeTeam: { include: { user: { select: { name: true } } } },
      awayTeam: { include: { user: { select: { name: true } } } },
      week: true,
    },
  })

  if (!matchup) return null

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
                    gameDate: { gte: matchup.week.startDate, lte: matchup.week.endDate },
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

  return { matchup, week: matchup.week, homeLineup, awayLineup }
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

export default async function MatchupDetailPage({ params }: { params: { id: string } }) {
  await requireAuth()
  const data = await getMatchupById(params.id)

  if (!data) return notFound()

  const { matchup, week, homeLineup, awayLineup } = data
  const homeStarters = sortByPosition(homeLineup.filter(s => s.isStarter))
  const homeBench = homeLineup.filter(s => !s.isStarter)
  const awayStarters = sortByPosition(awayLineup.filter(s => s.isStarter))
  const awayBench = awayLineup.filter(s => !s.isStarter)

  const homeWinning = matchup.homeScore > matchup.awayScore
  const awayWinning = matchup.awayScore > matchup.homeScore
  const tied = matchup.homeScore === matchup.awayScore

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back link */}
      <Link href="/schedule" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-brand transition-colors">
        <ArrowLeft size={14} />
        Schedule
      </Link>

      {/* Scoreboard */}
      <div className="card overflow-hidden">
        <div className="bg-hero-gradient p-6 lg:p-8">
          <div className="flex items-center gap-2 mb-6">
            <Zap size={16} className="text-brand" />
            <span className="text-sm text-text-muted font-mono uppercase tracking-wider">
              Week {week.weekNumber} · {format(new Date(week.startDate), 'MMM d')} – {format(new Date(week.endDate), 'MMM d')}
            </span>
            {week.isPlayoff && <span className="badge-amber text-xs">Playoffs</span>}
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
            {/* Home team */}
            <div className="flex-1 text-center">
              <div className={`font-display font-black text-7xl lg:text-8xl leading-none ${
                homeWinning ? 'text-brand glow-brand' : 'text-text-primary'
              }`}>
                {matchup.homeScore.toFixed(0)}
              </div>
              <Link href={`/teams/${matchup.homeTeam.id}`} className="mt-2 font-display font-bold text-lg text-text-secondary hover:text-brand transition-colors block">
                {matchup.homeTeam.name}
              </Link>
              <div className="text-xs text-text-muted">{matchup.homeTeam.abbreviation}</div>
            </div>

            <div className="px-8 text-center">
              <div className="font-display font-black text-3xl text-text-muted">VS</div>
              {!tied && (
                <div className="text-xs mt-1 font-mono text-text-muted">
                  +{Math.abs(matchup.homeScore - matchup.awayScore).toFixed(0)}
                </div>
              )}
              {tied && matchup.status !== 'SCHEDULED' && (
                <div className="text-xs mt-1 text-accent-amber font-semibold">TIED</div>
              )}
            </div>

            {/* Away team */}
            <div className="flex-1 text-center">
              <div className={`font-display font-black text-7xl lg:text-8xl leading-none ${
                awayWinning ? 'text-brand glow-brand' : 'text-text-primary'
              }`}>
                {matchup.awayScore.toFixed(0)}
              </div>
              <Link href={`/teams/${matchup.awayTeam.id}`} className="mt-2 font-display font-bold text-lg text-text-secondary hover:text-brand transition-colors block">
                {matchup.awayTeam.name}
              </Link>
              <div className="text-xs text-text-muted">{matchup.awayTeam.abbreviation}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Side-by-side lineups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Home lineup */}
        <div className="card overflow-hidden">
          <div className={`px-4 py-3 border-b border-surface-border ${homeWinning ? 'bg-brand/5' : 'bg-surface-1/50'}`}>
            <Link href={`/teams/${matchup.homeTeam.id}`} className={`font-display font-bold text-lg hover:underline ${homeWinning ? 'text-brand' : 'text-text-primary'}`}>
              {matchup.homeTeam.name}
            </Link>
            <div className="text-xs text-text-muted">Starting Lineup</div>
          </div>
          <div>
            <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-border/30">
              <span className="w-10 table-header">POS</span>
              <span className="flex-1 table-header">PLAYER</span>
              <span className="w-8 table-header text-right">HR</span>
            </div>
            {homeStarters.map((slot, i) => <PlayerRow key={i} slot={slot} showScore={true} />)}
            {homeBench.length > 0 && (
              <>
                <div className="px-4 py-2 border-t border-surface-border bg-surface-1/50">
                  <span className="text-xs text-text-muted uppercase tracking-wider">Bench</span>
                </div>
                {homeBench.map((slot, i) => <PlayerRow key={i} slot={slot} showScore={false} />)}
              </>
            )}
          </div>
        </div>

        {/* Away lineup */}
        <div className="card overflow-hidden">
          <div className={`px-4 py-3 border-b border-surface-border ${awayWinning ? 'bg-brand/5' : 'bg-surface-1/50'}`}>
            <Link href={`/teams/${matchup.awayTeam.id}`} className={`font-display font-bold text-lg hover:underline ${awayWinning ? 'text-brand' : 'text-text-primary'}`}>
              {matchup.awayTeam.name}
            </Link>
            <div className="text-xs text-text-muted">Starting Lineup</div>
          </div>
          <div>
            <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-border/30">
              <span className="w-10 table-header">POS</span>
              <span className="flex-1 table-header">PLAYER</span>
              <span className="w-8 table-header text-right">HR</span>
            </div>
            {awayStarters.map((slot, i) => <PlayerRow key={i} slot={slot} showScore={true} />)}
            {awayBench.length > 0 && (
              <>
                <div className="px-4 py-2 border-t border-surface-border bg-surface-1/50">
                  <span className="text-xs text-text-muted uppercase tracking-wider">Bench</span>
                </div>
                {awayBench.map((slot, i) => <PlayerRow key={i} slot={slot} showScore={false} />)}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
