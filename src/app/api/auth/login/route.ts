import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export const dynamic = 'force-dynamic' // prevent static build-time evaluation

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

// In-memory rate limiter. For multi-instance deploy, move to Redis with ioredis.
const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes

function checkRateLimit(key: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now()
  const entry = loginAttempts.get(key)
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return { allowed: true, retryAfterMs: 0 }
  }
  if (entry.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterMs: entry.resetAt - now }
  }
  entry.count++
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
    const { allowed, retryAfterMs } = checkRateLimit(`${ip}:${email.toLowerCase()}`)

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
    console.error('[login]', err)
    return NextResponse.json({ success: false, error: 'Login failed' }, { status: 500 })
  }
}
