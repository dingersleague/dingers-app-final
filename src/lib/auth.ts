/**
 * Authentication utilities — iron-session only.
 *
 * Session storage: encrypted cookie via iron-session.
 * There is NO server-side session table. The `Session` model in schema.prisma
 * is unused and exists only for a historical token-based approach that was
 * replaced. It should be removed in a future migration.
 *
 * Auth flow:
 *   POST /api/auth/login  → sets iron-session cookie
 *   POST /api/auth/logout → destroys cookie
 *   All protected routes  → call requireAuth() or requireCommissioner()
 *   Middleware            → checks for cookie presence only (edge-compatible)
 */

import { getIronSession, SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { SessionUser } from '@/types'

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: process.env.SESSION_COOKIE_NAME ?? 'fantasy_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
}

declare module 'iron-session' {
  interface IronSessionData {
    user?: SessionUser
  }
}

// For use in Server Components and Route Handlers
export async function getSession() {
  const session = await getIronSession<{ user?: SessionUser }>(
    cookies(),
    sessionOptions
  )
  return session
}

// Get current authenticated user — throws 'UNAUTHENTICATED' if no session
export async function requireAuth(): Promise<SessionUser> {
  const session = await getSession()
  if (!session.user) {
    throw new Error('UNAUTHENTICATED')
  }
  return session.user
}

// Get current commissioner — throws 'UNAUTHENTICATED' or 'UNAUTHORIZED'
export async function requireCommissioner(): Promise<SessionUser> {
  const user = await requireAuth()
  if (user.role !== 'COMMISSIONER') {
    throw new Error('UNAUTHORIZED')
  }
  return user
}

// Standard error response helper
export function authError(type: 'UNAUTHENTICATED' | 'UNAUTHORIZED') {
  return NextResponse.json(
    { success: false, error: type === 'UNAUTHENTICATED' ? 'Login required' : 'Permission denied' },
    { status: type === 'UNAUTHENTICATED' ? 401 : 403 }
  )
}
