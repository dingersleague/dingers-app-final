import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { ArrowLeft, TrendingUp } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { id: string } }) {
  const player = await prisma.player.findUnique({
    where: { id: params.id },
    select: { fullName: true },
  })
  return { title: player?.fullName ?? 'Player' }
}

export default async function PlayerPage({ params }: { params: { id: string } }) {
  const user = await requireAuth()
  const season = new Date().getFullYear()

  const player = await prisma.player.findUnique({
    where: { id: params.id },
    include: {
      seasonStats: { where: { season }, take: 1 },
      gameStats: {
        where: {
          gameDate: { gte: new Date(`${season}-01-01`) },
          homeRuns: { gt: 0 },
        },
        orderBy: { gameDate: 'desc' },
        take: 30,
      },
      rosterSlots: {
        include: {
          team: { select: { id: true, name: true } },
        },
        take: 1,
      },
    },
  })

  if (!player) notFound()

  const seasonHR = player.seasonStats[0]?.homeRuns ?? 0
  const gamesPlayed = player.seasonStats[0]?.gamesPlayed ?? 0
  const ownerSlot = player.rosterSlots[0]
  const isOnMyTeam = ownerSlot?.team && user.teamId
    ? await prisma.rosterSlot.findFirst({ where: { playerId: player.id, teamId: user.teamId } }).then(Boolean)
    : false

  // HR pace over season (project full 162 games)
  const hrPer162 = gamesPlayed > 0 ? Math.round((seasonHR / gamesPlayed) * 162) : 0

  const STATUS_LABEL: Record<string, string> = {
    ACTIVE: 'Active',
    INJURED_10_DAY: 'IL-10',
    INJURED_60_DAY: 'IL-60',
    SUSPENDED: 'Suspended',
    MINORS: 'MiLB',
    INACTIVE: 'Inactive',
  }
  const STATUS_COLOR: Record<string, string> = {
    ACTIVE: 'text-brand',
    INJURED_10_DAY: 'text-accent-red',
    INJURED_60_DAY: 'text-accent-red',
    SUSPENDED: 'text-accent-amber',
    MINORS: 'text-accent-purple',
    INACTIVE: 'text-text-muted',
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <Link href="/players/search" className="inline-flex items-center gap-1 text-text-muted text-sm hover:text-text-primary mb-4">
          <ArrowLeft size={14} /> Back to players
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display font-black text-4xl tracking-tight leading-tight">
              {player.fullName}
            </h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className="badge-secondary font-mono">{player.positions.join(' / ')}</span>
              <span className="text-text-muted text-sm">{player.mlbTeamName ?? player.mlbTeamAbbr ?? 'Free Agent'}</span>
              <span className={`font-semibold text-sm ${STATUS_COLOR[player.status] ?? 'text-text-muted'}`}>
                {STATUS_LABEL[player.status] ?? player.status}
              </span>
            </div>
          </div>

          {/* HR stat */}
          <div className="text-right flex-shrink-0">
            <div className="font-display font-black text-6xl text-brand leading-none">{seasonHR}</div>
            <div className="stat-label mt-1">{season} HR</div>
          </div>
        </div>
      </div>

      {/* Ownership / Add-Drop */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="stat-label mb-1">Ownership</div>
            {ownerSlot ? (
              <div className="font-medium text-sm">
                {ownerSlot.team.name}
                {ownerSlot.team.id === user.teamId && (
                  <span className="ml-2 badge-brand">Your team</span>
                )}
              </div>
            ) : (
              <span className="badge-brand">Free Agent</span>
            )}
          </div>
          <div className="flex gap-2">
            {!ownerSlot && (
              <Link href={`/players/search?q=${encodeURIComponent(player.fullName)}`} className="btn-brand text-sm">
                Add Player
              </Link>
            )}
            {isOnMyTeam && (
              <Link href="/roster" className="btn-secondary text-sm">
                Manage Lineup
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Season stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Home Runs', value: seasonHR, highlight: true },
          { label: 'Games Played', value: gamesPlayed },
          { label: 'HR Pace / 162', value: hrPer162 },
          { label: 'HR/Game', value: gamesPlayed > 0 ? (seasonHR / gamesPlayed).toFixed(2) : '—' },
        ].map(stat => (
          <div key={stat.label} className="card p-4 text-center">
            <div className={`font-display font-black text-3xl ${stat.highlight ? 'text-brand' : 'text-text-primary'}`}>
              {stat.value}
            </div>
            <div className="stat-label mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* HR Game Log */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-border">
          <TrendingUp size={16} className="text-brand" />
          <h2 className="font-display font-bold text-xl">HR Game Log ({season})</h2>
        </div>

        {player.gameStats.length === 0 ? (
          <div className="px-5 py-10 text-center text-text-muted text-sm">
            No home run games recorded this season
          </div>
        ) : (
          <div className="divide-y divide-surface-border/50">
            {player.gameStats.map(game => (
              <div key={game.id} className="flex items-center gap-4 px-5 py-3">
                <span className="font-mono text-sm text-text-muted w-24">
                  {format(new Date(game.gameDate), 'MMM d, yyyy')}
                </span>
                <div className="flex-1" />
                <div className="flex items-center gap-2">
                  {Array.from({ length: game.homeRuns }).map((_, i) => (
                    <span key={i} className="w-6 h-6 rounded-full bg-brand/20 border border-brand/40 flex items-center justify-center">
                      <span className="text-brand font-display font-bold text-xs">HR</span>
                    </span>
                  ))}
                  <span className="font-display font-black text-xl text-brand ml-2">
                    {game.homeRuns}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
