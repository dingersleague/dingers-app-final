import { requireCommissioner, authError } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import AdminClient from './AdminClient'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Admin Panel' }

export default async function AdminPage() {
  try {
    await requireCommissioner()
  } catch {
    redirect('/dashboard')
  }

  const league = await prisma.league.findFirst({
    include: {
      teams: {
        include: { user: { select: { name: true, email: true } } },
        orderBy: { waiverPriority: 'asc' },
      },
      draftSettings: { include: { _count: { select: { picks: true } } } },
      weeks: { orderBy: { weekNumber: 'asc' } },
    },
  })

  const syncLogs = await prisma.syncLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  return <AdminClient league={league} syncLogs={syncLogs} />
}
