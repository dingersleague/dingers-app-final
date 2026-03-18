import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { format, differenceInYears } from 'date-fns'
import { ArrowLeft, TrendingUp, Activity, Award, BarChart3 } from 'lucide-react'
import Link from 'next/link'
import PlayerHeadshot from '@/components/PlayerHeadshot'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { id: string } }) {
  const player = await prisma.player.findUnique({ where: { id: params.id }, select: { fullName: true } })
  return { title: player?.fullName ?? 'Player' }
}

async function fetchPlayerBio(mlbId: number) {
  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${mlbId}`,
      { next: { revalidate: 3600 } }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.people?.[0] ?? null
  } catch { return null }
}

async function fetchYearByYear(mlbId: number) {
  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${mlbId}/stats?stats=yearByYear,career&group=hitting`,
      { next: { revalidate: 3600 } }
    )
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

export default async function PlayerPage({ params }: { params: { id: string } }) {
  const user = await requireAuth()
  const season = new Date().getFullYear()

  const player = await prisma.player.findUnique({
    where: { id: params.id },
    include: {
      seasonStats: { where: { season }, take: 1 },
      gameStats: {
        where: { gameDate: { gte: new Date(`${season}-01-01`) } },
        orderBy: { gameDate: 'desc' },
        take: 30,
      },
      rosterSlots: {
        include: { team: { select: { id: true, name: true, abbreviation: true } } },
        take: 1,
      },
    },
  })

  if (!player) notFound()

  let bio: any = null
  let statsData: any = null
  try { [bio, statsData] = await Promise.all([fetchPlayerBio(player.mlbId), fetchYearByYear(player.mlbId)]) }
  catch { /* API down */ }

  const projectedHR = player.seasonStats[0]?.homeRuns ?? 0
  const ownerSlot = player.rosterSlots[0]

  // Year-by-year stats
  let yearByYear: Array<{ season: string; hr: number; games: number; avg: string; ops: string; rbi: number; team: string }> = []
  let careerStats: any = null
  try {
    const yby = statsData?.stats?.find((s: any) => s.type?.displayName === 'yearByYear')
    if (yby?.splits) {
      yearByYear = yby.splits
        .filter((s: any) => s.sport?.id === 1) // MLB only
        .map((s: any) => ({
          season: s.season,
          hr: s.stat?.homeRuns ?? 0,
          games: s.stat?.gamesPlayed ?? 0,
          avg: s.stat?.avg ?? '—',
          ops: s.stat?.ops ?? '—',
          rbi: s.stat?.rbi ?? 0,
          team: s.team?.abbreviation ?? s.team?.name ?? '',
        }))
        .reverse() // most recent first
    }
    const career = statsData?.stats?.find((s: any) => s.type?.displayName === 'career')
    careerStats = career?.splits?.[0]?.stat ?? null
  } catch { /* malformed */ }

  // Projected weekly HR (season projection / 25 weeks)
  const weeklyProjectedHR = projectedHR > 0 ? (projectedHR / 25).toFixed(1) : '0.0'

  let age: number | null = null
  try { age = player.birthDate ? differenceInYears(new Date(), new Date(player.birthDate)) : bio?.currentAge ?? null } catch {}

  const STATUS_LABEL: Record<string, string> = {
    ACTIVE: 'Active', INJURED_10_DAY: '10-Day IL', INJURED_60_DAY: '60-Day IL',
    SUSPENDED: 'Suspended', MINORS: 'MiLB', INACTIVE: 'Inactive',
  }
  const STATUS_COLOR: Record<string, string> = {
    ACTIVE: 'badge-brand', INJURED_10_DAY: 'badge-red', INJURED_60_DAY: 'badge-red',
    SUSPENDED: 'badge-amber', MINORS: 'badge-secondary', INACTIVE: 'badge-secondary',
  }

  const hrGames = player.gameStats.filter(g => g.homeRuns > 0)

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl">
      <Link href="/players/search" className="inline-flex items-center gap-1 text-text-muted text-sm hover:text-text-primary">
        <ArrowLeft size={14} /> Players
      </Link>

      {/* Header */}
      <div className="card overflow-hidden">
        <div className="bg-hero-gradient p-4 sm:p-6">
          <div className="flex items-start gap-3 sm:gap-5">
            <PlayerHeadshot mlbId={player.mlbId} name={player.fullName} size="lg" />
            <div className="flex-1 min-w-0">
              <h1 className="font-display font-black text-2xl sm:text-4xl tracking-tight leading-tight">
                {player.fullName}
              </h1>
              {bio?.nickName && <div className="text-text-muted text-sm">&ldquo;{bio.nickName}&rdquo;</div>}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="badge-secondary font-mono text-xs">{player.positions.join(' / ')}</span>
                <span className="text-text-muted text-xs sm:text-sm">{player.mlbTeamName ?? player.mlbTeamAbbr ?? 'Free Agent'}</span>
                <span className={`text-xs ${STATUS_COLOR[player.status] ?? 'badge-secondary'}`}>
                  {STATUS_LABEL[player.status] ?? player.status}
                </span>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="font-display font-black text-5xl sm:text-7xl text-brand leading-none">{projectedHR}</div>
              <div className="stat-label mt-1">Proj. HR</div>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 mt-4 text-xs sm:text-sm text-text-muted flex-wrap">
            {age != null && age > 0 && <span>{age} yrs</span>}
            {bio?.height ? <span>{bio.height}</span> : null}
            {bio?.weight ? <span>{bio.weight} lbs</span> : null}
            {player.bats ? <span>B: {player.bats}</span> : null}
            {player.throws ? <span>T: {player.throws}</span> : null}
            {bio?.draftYear ? <span>Draft: {bio.draftYear}</span> : null}
            {bio?.mlbDebutDate ? <span>Debut: {(() => { try { return format(new Date(bio.mlbDebutDate), 'MMM yyyy') } catch { return null } })()}</span> : null}
          </div>
        </div>
      </div>

      {/* Ownership */}
      <div className="card p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="stat-label mb-1">Ownership</div>
            {ownerSlot ? (
              <div className="font-medium text-sm">
                <Link href={`/teams/${ownerSlot.team.id}`} className="hover:underline">{ownerSlot.team.name}</Link>
                {ownerSlot.team.id === user.teamId && <span className="ml-2 badge-brand">Your team</span>}
              </div>
            ) : (
              <span className="badge-brand">Free Agent</span>
            )}
          </div>
          {!ownerSlot && (
            <Link href={`/players/search?q=${encodeURIComponent(player.fullName)}`} className="btn-brand text-sm">Add Player</Link>
          )}
        </div>
      </div>

      {/* Projection Stats */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={16} className="text-brand" />
          <h2 className="font-display font-bold text-xl">{season} Projections</h2>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {[
            { label: 'Proj. HR', value: projectedHR, highlight: true },
            { label: 'HR/Week', value: weeklyProjectedHR, highlight: true },
            { label: 'Proj. Games', value: player.seasonStats[0]?.gamesPlayed ?? '—' },
            { label: 'Proj. AB', value: player.seasonStats[0]?.atBats ?? '—' },
          ].map(stat => (
            <div key={stat.label} className="card p-3 text-center">
              <div className={`font-display font-black text-2xl ${stat.highlight ? 'text-brand' : 'text-text-primary'}`}>{stat.value}</div>
              <div className="stat-label mt-0.5 text-[10px]">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Career Year-by-Year */}
      {yearByYear.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 px-4 sm:px-5 py-4 border-b border-surface-border">
            <BarChart3 size={16} className="text-accent-blue" />
            <h2 className="font-display font-bold text-xl">Season History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border text-[11px] uppercase tracking-wider text-text-muted">
                  <th className="px-3 sm:px-4 py-2 text-left">Year</th>
                  <th className="px-2 py-2 text-left">Team</th>
                  <th className="px-2 py-2 text-center">G</th>
                  <th className="px-2 py-2 text-center font-bold text-brand">HR</th>
                  <th className="px-2 py-2 text-center">RBI</th>
                  <th className="px-2 py-2 text-center">AVG</th>
                  <th className="px-2 py-2 text-center">OPS</th>
                </tr>
              </thead>
              <tbody>
                {yearByYear.map((yr, i) => (
                  <tr key={`${yr.season}-${i}`} className="border-b border-surface-border/30 table-row">
                    <td className="px-3 sm:px-4 py-2 font-mono text-text-muted">{yr.season}</td>
                    <td className="px-2 py-2 text-text-muted font-mono text-xs">{yr.team}</td>
                    <td className="px-2 py-2 text-center text-text-secondary">{yr.games}</td>
                    <td className="px-2 py-2 text-center font-display font-bold text-brand">{yr.hr}</td>
                    <td className="px-2 py-2 text-center text-text-secondary">{yr.rbi}</td>
                    <td className="px-2 py-2 text-center font-mono text-text-secondary">{yr.avg}</td>
                    <td className="px-2 py-2 text-center font-mono text-text-secondary">{yr.ops}</td>
                  </tr>
                ))}
                {careerStats && (
                  <tr className="bg-surface-1/50 font-semibold">
                    <td className="px-3 sm:px-4 py-2 text-text-primary" colSpan={2}>Career</td>
                    <td className="px-2 py-2 text-center text-text-primary">{careerStats.gamesPlayed}</td>
                    <td className="px-2 py-2 text-center font-display font-bold text-brand">{careerStats.homeRuns}</td>
                    <td className="px-2 py-2 text-center text-text-primary">{careerStats.rbi}</td>
                    <td className="px-2 py-2 text-center font-mono text-text-primary">{careerStats.avg}</td>
                    <td className="px-2 py-2 text-center font-mono text-text-primary">{careerStats.ops}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* HR Game Log */}
      {hrGames.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 px-4 sm:px-5 py-4 border-b border-surface-border">
            <Award size={16} className="text-brand" />
            <h2 className="font-display font-bold text-xl">HR Game Log</h2>
            <span className="text-text-muted text-sm ml-1">({hrGames.length})</span>
          </div>
          <div className="divide-y divide-surface-border/50">
            {hrGames.map(game => (
              <div key={game.id} className="flex items-center gap-4 px-4 sm:px-5 py-3">
                <span className="font-mono text-xs sm:text-sm text-text-muted w-20 sm:w-24">
                  {(() => { try { return format(new Date(game.gameDate), 'MMM d, yyyy') } catch { return '—' } })()}
                </span>
                <div className="flex-1" />
                <div className="flex items-center gap-2">
                  {Array.from({ length: game.homeRuns }).map((_, i) => (
                    <span key={i} className="w-6 h-6 rounded-full bg-brand/20 border border-brand/40 flex items-center justify-center">
                      <span className="text-brand font-display font-bold text-xs">HR</span>
                    </span>
                  ))}
                  <span className="font-display font-black text-xl text-brand ml-2">{game.homeRuns}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
