import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
import Link from 'next/link'
import TeamLogo from '@/components/TeamLogo'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Schedule' }

export default async function SchedulePage() {
  const user = await requireAuth()
  const userWithTeam = await prisma.user.findUnique({
    where: { id: user.id },
    include: { team: true },
  })
  if (!userWithTeam?.team) return null

  const { team } = userWithTeam

  const season = new Date().getFullYear()
  const weeks = await prisma.leagueWeek.findMany({
    where: { leagueId: team.leagueId },
    orderBy: { weekNumber: 'asc' },
    include: {
      matchups: {
        include: {
          homeTeam: {
            select: {
              id: true, name: true, abbreviation: true,
              logoUrl: true, primaryColor: true, secondaryColor: true,
              rosterSlots: {
                where: { slotType: 'STARTER' },
                include: { player: { include: { seasonStats: { where: { season }, take: 1 } } } },
              },
            },
          },
          awayTeam: {
            select: {
              id: true, name: true, abbreviation: true,
              logoUrl: true, primaryColor: true, secondaryColor: true,
              rosterSlots: {
                where: { slotType: 'STARTER' },
                include: { player: { include: { seasonStats: { where: { season }, take: 1 } } } },
              },
            },
          },
        },
      },
    },
  })

  // Helper: calculate weekly projection from starters
  function projHR(teamData: any) {
    return (teamData.rosterSlots ?? []).reduce((sum: number, s: any) =>
      sum + ((s.player?.seasonStats?.[0]?.homeRuns ?? 0) / 25), 0
    )
  }

  const league = await prisma.league.findUnique({ where: { id: team.leagueId } })

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="font-display font-black text-4xl tracking-tight">Schedule</h1>
        <p className="text-text-muted text-sm mt-1">Full season · {league?.season}</p>
      </div>

      <div className="space-y-3">
        {weeks.map(week => {
          const myMatchup = week.matchups.find(
            m => m.homeTeamId === team.id || m.awayTeamId === team.id
          )
          const isCurrent = week.weekNumber === league?.currentWeek

          return (
            <div key={week.id} className={`card overflow-hidden ${isCurrent ? 'border-brand/40 shadow-brand-sm' : ''}`}>
              <div className={`flex items-center justify-between px-4 py-2.5 border-b border-surface-border ${
                isCurrent ? 'bg-brand/5' : 'bg-surface-1/50'
              }`}>
                <div className="flex items-center gap-3">
                  <span className="font-display font-bold text-lg text-text-primary">
                    Week {week.weekNumber}
                  </span>
                  {week.isPlayoff && <span className="badge-amber text-xs">Playoffs</span>}
                  {isCurrent && <span className="badge-brand text-xs">Current</span>}
                  {week.isComplete && <span className="badge-secondary text-xs">Final</span>}
                </div>
                <span className="font-mono text-xs text-text-muted">
                  {format(new Date(week.startDate), 'MMM d')} – {format(new Date(week.endDate), 'MMM d')}
                </span>
              </div>

              {/* My matchup highlight */}
              {myMatchup && (() => {
                const hProj = projHR(myMatchup.homeTeam)
                const aProj = projHR(myMatchup.awayTeam)
                return (
                  <Link href={`/matchup/${myMatchup.id}`} className="block px-4 py-3 bg-brand/3 border-b border-surface-border/50 hover:bg-brand/8 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1">
                        <TeamLogo logoUrl={myMatchup.homeTeam.logoUrl} abbreviation={myMatchup.homeTeam.abbreviation} primaryColor={myMatchup.homeTeam.primaryColor} secondaryColor={myMatchup.homeTeam.secondaryColor} size="sm" />
                        <span className={`font-medium text-sm ${myMatchup.homeTeamId === team.id ? 'text-brand' : 'text-text-primary'}`}>
                          {myMatchup.homeTeam.name}
                        </span>
                        <span className="font-display font-bold text-lg text-text-primary">
                          {myMatchup.status === 'SCHEDULED' ? '—' : myMatchup.homeScore}
                        </span>
                      </div>
                      <div className="px-3 text-center">
                        <span className="text-text-muted text-xs font-mono">VS</span>
                        {myMatchup.status === 'SCHEDULED' && (
                          <div className="text-[10px] text-text-muted">{hProj.toFixed(1)}–{aProj.toFixed(1)}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-1 flex-row-reverse">
                        <TeamLogo logoUrl={myMatchup.awayTeam.logoUrl} abbreviation={myMatchup.awayTeam.abbreviation} primaryColor={myMatchup.awayTeam.primaryColor} secondaryColor={myMatchup.awayTeam.secondaryColor} size="sm" />
                        <span className={`font-medium text-sm ${myMatchup.awayTeamId === team.id ? 'text-brand' : 'text-text-primary'}`}>
                          {myMatchup.awayTeam.name}
                        </span>
                        <span className="font-display font-bold text-lg text-text-primary">
                          {myMatchup.status === 'SCHEDULED' ? '—' : myMatchup.awayScore}
                        </span>
                      </div>
                      <div className="ml-4">
                        {myMatchup.status === 'COMPLETE' && myMatchup.winner && (
                          <span className={`badge text-xs ${
                            myMatchup.winner === team.id ? 'badge-brand' :
                            myMatchup.winner === 'TIE' ? 'badge-secondary' : 'badge-red'
                          }`}>
                            {myMatchup.winner === team.id ? 'W' :
                             myMatchup.winner === 'TIE' ? 'T' : 'L'}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                )
              })()}

              {/* All matchups this week */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-surface-border/30">
                {week.matchups
                  .filter(m => !(m.homeTeamId === team.id || m.awayTeamId === team.id))
                  .map(m => {
                    const hP = projHR(m.homeTeam)
                    const aP = projHR(m.awayTeam)
                    return (
                      <Link key={m.id} href={`/matchup/${m.id}`} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-surface-1/80 transition-colors">
                        <TeamLogo logoUrl={m.homeTeam.logoUrl} abbreviation={m.homeTeam.abbreviation} primaryColor={m.homeTeam.primaryColor} secondaryColor={m.homeTeam.secondaryColor} size="sm" />
                        <span className="flex-1 text-text-secondary truncate">{m.homeTeam.abbreviation}</span>
                        <div className="text-center">
                          <span className="font-mono text-text-muted text-xs">
                            {m.status === 'SCHEDULED' ? 'vs' : `${m.homeScore}–${m.awayScore}`}
                          </span>
                          {m.status === 'SCHEDULED' && (
                            <div className="text-[9px] text-text-muted">{hP.toFixed(1)}–{aP.toFixed(1)}</div>
                          )}
                        </div>
                        <span className="flex-1 text-right text-text-secondary truncate">{m.awayTeam.abbreviation}</span>
                        <TeamLogo logoUrl={m.awayTeam.logoUrl} abbreviation={m.awayTeam.abbreviation} primaryColor={m.awayTeam.primaryColor} secondaryColor={m.awayTeam.secondaryColor} size="sm" />
                      </Link>
                    )
                  })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
