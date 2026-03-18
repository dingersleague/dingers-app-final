import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { log } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes

async function checkRateLimit(key: string): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const windowStart = new Date(Date.now() - WINDOW_MS)

  const count = await prisma.loginAttempt.count({
    where: { key, createdAt: { gte: windowStart } },
  })

  if (count >= MAX_ATTEMPTS) {
    // Find the oldest attempt in the window to calculate retry-after
    const oldest = await prisma.loginAttempt.findFirst({
      where: { key, createdAt: { gte: windowStart } },
      orderBy: { createdAt: 'asc' },
    })
    const retryAfterMs = oldest
      ? oldest.createdAt.getTime() + WINDOW_MS - Date.now()
      : WINDOW_MS
    return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 0) }
  }

  await prisma.loginAttempt.create({ data: { key } })
  return { allowed: true, retryAfterMs: 0 }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

  try {
    const body = await req.json()
    const parsed = LoginSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 })
    }

    const { email, password } = parsed.data
    const { allowed, retryAfterMs } = await checkRateLimit(`${ip}:${email.toLowerCase()}`)

    if (!allowed) {
      return NextResponse.json(
        { success: false, error: `Too many attempts. Try again in ${Math.ceil(retryAfterMs / 60000)} min.` },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { team: { select: { id: true, leagueId: true } } },
    })

    // Always hash-compare to prevent timing attacks revealing valid emails
    const passwordValid = user
      ? await bcrypt.compare(password, user.passwordHash)
      : await bcrypt.compare(password, '$2a$12$fakehashfortimingnormalization00').then(() => false)

    if (!user || !passwordValid) {
      return NextResponse.json({ success: false, error: 'Invalid email or password' }, { status: 401 })
    }

    const session = await getSession()
    session.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as 'COMMISSIONER' | 'OWNER',
      teamId: user.team?.id ?? null,
      leagueId: user.team?.leagueId ?? null,
    }
    await session.save()

    return NextResponse.json({ success: true, data: { userId: user.id } })

  } catch (err) {
    log('error', 'login_failed', { error: String(err) })
    return NextResponse.json({ success: false, error: 'Login failed' }, { status: 500 })
  }
}
