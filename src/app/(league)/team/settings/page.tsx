import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import TeamSettingsClient from './TeamSettingsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Team Settings' }

export default async function TeamSettingsPage() {
  const user = await requireAuth()
  if (!user.teamId) redirect('/dashboard')

  const team = await prisma.team.findUniqueOrThrow({
    where: { id: user.teamId },
    select: {
      id: true, name: true, abbreviation: true,
      logoUrl: true, primaryColor: true, secondaryColor: true,
    },
  })

  return <TeamSettingsClient team={team} />
}
