import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** Public endpoint: returns team list for the quick-login picker. */
export async function GET() {
  try {
    const teams = await prisma.team.findMany({
      include: { user: { select: { email: true, name: true } } },
      orderBy: { waiverPriority: 'asc' },
    })

    const data = teams.map(t => ({
      email: t.user.email,
      name: t.user.name,
      teamName: t.name,
      abbreviation: t.abbreviation,
      role: t.userId === teams[0]?.userId ? 'commissioner' : 'owner',
    }))

    return NextResponse.json({ success: true, data })
  } catch {
    return NextResponse.json({ success: true, data: [] })
  }
}
