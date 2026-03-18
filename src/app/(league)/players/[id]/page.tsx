import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { format, differenceInYears } from 'date-fns'
import { ArrowLeft, TrendingUp, User, Activity, Calendar, Award } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { id: string } }) {
  const player = await prisma.player.findUnique({
    where: { id: params.id },
    select: { fullName: true },
  })
  return { title: player?.fullName ?? 'Player' }
}

// Fetch bio data from MLB API on demand
async function fetchPlayerBio(mlbId: number) {
  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${mlbId}?hydrate=stats(group=[hitting],type=[season,career],season=${new Date().getFullYear()})`,
      { next: { revalidate: 3600 } } // cache 1 hour
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.people?.[0] ?? null
  } catch {
    return null
  }
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

  // Fetch live bio + career stats from MLB API
  const bio = await fetchPlayerBio(player.mlbId)

  const seasonHR = player.seasonStats[0]?.homeRuns ?? 0
  const gamesPlayed = player.seasonStats[0]?.gamesPlayed ?? 0
  const atBats = player.seasonStats[0]?.atBats ?? 0
  const hits = player.seasonStats[0]?.hits ?? 0
  const ownerSlot = player.rosterSlots[0]

  // MLB API stats
  const mlbSeasonStats = bio?.stats?.find((s: any) => s.type?.displayName === 'season')?.splits?.[0]?.stat
  const mlbCareerStats = bio?.stats?.find((s: any) => s.type?.displayName === 'career')?.splits?.[0]?.stat

  // Headshot URL
  const headshotUrl = `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${player.mlbId}/headshot/67/current`

  // Age calculation
  const age = player.birthDate
    ? differenceInYears(new Date(), new Date(player.birthDate))
    : bio?.currentAge ?? null

  // HR pace
  const hrPer162 = gamesPlayed > 0 ? Math.round((seasonHR / gamesPlayed) * 162) : 0
  const avg = atBats > 0 ? (hits / atBats).toFixed(3).replace('0.', '.') : '.000'
  const abPerHR = seasonHR > 0 ? (atBats / seasonHR).toFixed(1) : '—'

  const STATUS_LABEL: Record<string, string> = {
    ACTIVE: 'Active', INJURED_10_DAY: '10-Day IL', INJURED_60_DAY: '60-Day IL',
    SUSPENDED: 'Suspended', MINORS: 'MiLB', INACTIVE: 'Inactive',
  }
  const STATUS_COLOR: Record<string, string> = {
    ACTIVE: 'badge-brand', INJURED_10_DAY: 'badge-red', INJURED_60_DAY: 'badge-red',
    SUSPENDED: 'badge-amber', MINORS: 'badge-secondary', INACTIVE: 'badge-secondary',
  }

  // Games with HR for the log
  const hrGames = player.gameStats.filter(g => g.homeRuns > 0)

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <Link href="/players/search" className="inline-flex items-center gap-1 text-text-muted text-sm hover:text-text-primary">
        <ArrowLeft size={14} /> Players
      </Link>

      {/* Player header with headshot */}
      <div className="card overflow-hidden">
        <div className="bg-hero-gradient p-6">
          <div className="flex items-start gap-5">
            {/* Headshot */}
            <div className="w-24 h-24 rounded-xl overflow-hidden bg-surface-3 flex-shrink-0 border border-surface-border">
              <img
                src={headshotUrl}
                alt={player.fullName}
                className="w-full h-full object-cover"
                onError={(e: any) => { e.target.style.display = 'none' }}
              />
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="font-display font-black text-4xl tracking-tight leading-tight">
                {player.fullName}
                {bio?.nickName && <span className="text-text-muted text-xl ml-2">&ldquo;{bio.nickName}&rdquo;</span>}
              </h1>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="badge-secondary font-mono">{player.positions.join(' / ')}</span>
                <span className="text-text-muted text-sm">{player.mlbTeamName ?? player.mlbTeamAbbr ?? 'Free Agent'}</span>
                <span className={STATUS_COLOR[player.status] ?? 'badge-secondary'}>
                  {STATUS_LABEL[player.status] ?? player.status}
                </span>
              </div>

              {/* Bio line */}
              <div className="flex items-center gap-4 mt-3 text-sm text-text-muted flex-wrap">
                {age && <span>{age} years old</span>}
                {bio?.height && <span>{bio.height}</span>}
                {bio?.weight && <span>{bio.weight} lbs</span>}
                {player.bats && <span>Bats: {player.bats === 'R' ? 'Right' : player.bats === 'L' ? 'Left' : 'Switch'}</span>}
                {player.throws && <span>Throws: {player.throws === 'R' ? 'Right' : 'Left'}</span>}
              </div>
              <div className="flex items-center gap-4 mt-1 text-xs text-text-muted flex-wrap">
                {bio?.birthCity && <span>Born: {bio.birthCity}{bio.birthStateProvince ? `, ${bio.birthStateProvince}` : ''}{bio.birthCountry && bio.birthCountry !== 'USA' ? `, ${bio.birthCountry}` : ''}</span>}
                {bio?.draftYear && <span>Drafted: {bio.draftYear}</span>}
                {bio?.mlbDebutDate && <span>MLB Debut: {format(new Date(bio.mlbDebutDate), 'MMM d, yyyy')}</span>}
              </div>
            </div>

            {/* Big HR number */}
            <div className="text-right flex-shrink-0">
              <div className="font-display font-black text-7xl text-brand leading-none">{seasonHR}</div>
              <div className="stat-label mt-1">{season} HR</div>
            </div>
          </div>
        </div>
      </div>

      {/* Ownership */}
      <div className="card p-5">
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
          <div className="flex gap-2">
            {!ownerSlot && (
              <Link href={`/players/search?q=${encodeURIComponent(player.fullName)}`} className="btn-brand text-sm">
                Add Player
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Season Stats Grid */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Activity size={16} className="text-brand" />
          <h2 className="font-display font-bold text-xl">{season} Season</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {[
            { label: 'HR', value: seasonHR, highlight: true },
            { label: 'Games', value: gamesPlayed },
            { label: 'AB', value: atBats },
            { label: 'AVG', value: avg },
            { label: 'HR Pace', value: hrPer162, highlight: true },
            { label: 'AB/HR', value: abPerHR },
            ...(mlbSeasonStats ? [
              { label: 'RBI', value: mlbSeasonStats.rbi ?? '—' },
              { label: 'R', value: mlbSeasonStats.runs ?? '—' },
              { label: 'OBP', value: mlbSeasonStats.obp ? Number(mlbSeasonStats.obp).toFixed(3).replace('0.', '.') : '—' },
              { label: 'SLG', value: mlbSeasonStats.slg ? Number(mlbSeasonStats.slg).toFixed(3).replace('0.', '.') : '—' },
              { label: 'OPS', value: mlbSeasonStats.ops ? Number(mlbSeasonStats.ops).toFixed(3).replace('0.', '.') : '—' },
              { label: 'SB', value: mlbSeasonStats.stolenBases ?? '—' },
            ] : []),
          ].map(stat => (
            <div key={stat.label} className="card p-3 text-center">
              <div className={`font-display font-black text-2xl ${stat.highlight ? 'text-brand' : 'text-text-primary'}`}>
                {stat.value}
              </div>
              <div className="stat-label mt-0.5 text-[10px]">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Career Stats (if available) */}
      {mlbCareerStats && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Award size={16} className="text-accent-amber" />
            <h2 className="font-display font-bold text-xl">Career</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              { label: 'HR', value: mlbCareerStats.homeRuns ?? '—', highlight: true },
              { label: 'Games', value: mlbCareerStats.gamesPlayed ?? '—' },
              { label: 'AVG', value: mlbCareerStats.avg ? Number(mlbCareerStats.avg).toFixed(3).replace('0.', '.') : '—' },
              { label: 'RBI', value: mlbCareerStats.rbi ?? '—' },
              { label: 'OPS', value: mlbCareerStats.ops ? Number(mlbCareerStats.ops).toFixed(3).replace('0.', '.') : '—' },
              { label: 'SB', value: mlbCareerStats.stolenBases ?? '—' },
            ].map(stat => (
              <div key={stat.label} className="card p-3 text-center">
                <div className={`font-display font-black text-2xl ${stat.highlight ? 'text-accent-amber' : 'text-text-primary'}`}>
                  {stat.value}
                </div>
                <div className="stat-label mt-0.5 text-[10px]">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* HR Game Log */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-border">
          <TrendingUp size={16} className="text-brand" />
          <h2 className="font-display font-bold text-xl">HR Game Log</h2>
          <span className="text-text-muted text-sm ml-1">({hrGames.length} games)</span>
        </div>

        {hrGames.length === 0 ? (
          <div className="px-5 py-10 text-center text-text-muted text-sm">
            No home run games recorded this season
          </div>
        ) : (
          <div className="divide-y divide-surface-border/50">
            {hrGames.map(game => (
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
