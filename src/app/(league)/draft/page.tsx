import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import DraftClient from './DraftClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Draft Board' }

export default async function DraftPage() {
  const user = await requireAuth()
  const userWithTeam = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { team: { include: { league: { include: { draftSettings: true } } } } },
  })

  if (!userWithTeam.team) redirect('/dashboard')

  const league = userWithTeam.team.league
  const draftSettings = league.draftSettings

  // If no draft or draft hasn't started yet
  if (!draftSettings) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="font-display font-black text-3xl text-text-muted mb-2">No Draft Configured</div>
          <p className="text-text-muted text-sm">The commissioner needs to set up the draft first.</p>
        </div>
      </div>
    )
  }

  if (draftSettings.status === 'PENDING') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="font-display font-black text-3xl text-text-primary mb-2">Draft Room</div>
          <p className="text-text-muted text-sm">Waiting for the commissioner to start the draft...</p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent-amber animate-pulse" />
            <span className="text-accent-amber text-sm font-medium">Standing by</span>
          </div>
        </div>
      </div>
    )
  }

  if (draftSettings.status === 'COMPLETE' && league.status !== 'DRAFT') {
    redirect('/dashboard')
  }

  return <DraftClient myTeamId={userWithTeam.team.id} />
}
