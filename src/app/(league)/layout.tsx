import { optionalAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import AppNav from '@/components/layout/AppNav'
import { SessionUser } from '@/types'

export default async function LeagueLayout({ children }: { children: React.ReactNode }) {
  const user = await optionalAuth()

  // Get league status for nav (draft link visibility)
  let leagueStatus: string | null = null
  if (user?.leagueId) {
    const league = await prisma.league.findUnique({
      where: { id: user.leagueId },
      select: { status: true },
    })
    leagueStatus = league?.status ?? null
  } else {
    const league = await prisma.league.findFirst({ select: { status: true } })
    leagueStatus = league?.status ?? null
  }

  // Guest user for nav when not logged in
  const navUser: SessionUser = user ?? {
    id: '', email: '', name: 'Guest', role: 'OWNER',
    teamId: null, leagueId: null,
  }

  return (
    <div className="min-h-screen flex">
      <AppNav user={navUser} leagueStatus={leagueStatus} />
      <main className="flex-1 lg:ml-56 min-h-screen">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 lg:py-8 pt-16 lg:pt-8 pb-20 lg:pb-8">
          {children}
        </div>
      </main>
    </div>
  )
}
