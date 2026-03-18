import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import AppNav from '@/components/layout/AppNav'

export default async function LeagueLayout({ children }: { children: React.ReactNode }) {
  let user
  try {
    user = await requireAuth()
  } catch {
    redirect('/login')
  }

  // If user has no team yet and isn't commissioner, send to setup
  if (!user.teamId && user.role !== 'COMMISSIONER') {
    redirect('/setup')
  }

  return (
    <div className="min-h-screen flex">
      <AppNav user={user} />
      <main className="flex-1 lg:ml-56 min-h-screen">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 lg:py-8 pt-20 lg:pt-8">
          {children}
        </div>
      </main>
    </div>
  )
}
