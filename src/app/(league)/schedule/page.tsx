import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'

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

  const weeks = await prisma.leagueWeek.findMany({
    where: { leagueId: team.leagueId },
    orderBy: { weekNumber: 'asc' },
    include: {
      matchups: {
        include: {
          homeTeam: { select: { id: true, name: true, abbreviation: true } },
          awayTeam: { select: { id: true, name: true, abbreviation: true } },
        },
      },
    },
  })

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
              {myMatchup && (
                <div className="px-4 py-3 bg-brand/3 border-b border-surface-border/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`font-medium text-sm ${myMatchup.homeTeamId === team.id ? 'text-brand' : 'text-text-primary'}`}>
                        {myMatchup.homeTeam.name}
                      </span>
                      <span className="font-display font-bold text-lg text-text-primary">
                        {myMatchup.status === 'SCHEDULED' ? '—' : myMatchup.homeScore}
                      </span>
                    </div>
                    <span className="text-text-muted text-xs font-mono px-3">VS</span>
                    <div className="flex items-center gap-3 flex-row-reverse">
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
                </div>
              )}

              {/* All matchups this week */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-surface-border/30">
                {week.matchups
                  .filter(m => !(m.homeTeamId === team.id || m.awayTeamId === team.id))
                  .map(m => (
                  <div key={m.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                    <span className="flex-1 text-text-secondary truncate">{m.homeTeam.abbreviation}</span>
                    <span className="font-mono text-text-muted text-xs">
                      {m.status === 'SCHEDULED' ? 'vs' :
                       `${m.homeScore}–${m.awayScore}`}
                    </span>
                    <span className="flex-1 text-right text-text-secondary truncate">{m.awayTeam.abbreviation}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
