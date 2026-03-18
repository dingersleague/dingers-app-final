import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { sessionOptions } from '@/lib/auth'

// Routes that require authentication
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/matchup',
  '/standings',
  '/roster',
  '/players',
  '/schedule',
  '/transactions',
  '/draft',
  '/admin',
]

// Routes only for unauthenticated users
const AUTH_ONLY = ['/login', '/register']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Skip static files, API routes (those self-authenticate), and Next internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.') // static assets
  ) {
    return NextResponse.next()
  }

  // Read iron-session cookie
  // iron-session works with cookies directly — we inspect the cookie presence
  // for edge routing. Full session validation happens in route handlers.
  const sessionCookie = req.cookies.get(
    process.env.SESSION_COOKIE_NAME ?? 'fantasy_session'
  )
  const isLoggedIn = !!sessionCookie?.value

  const isProtected = PROTECTED_PREFIXES.some(p => pathname.startsWith(p))
  const isAuthOnly = AUTH_ONLY.some(p => pathname.startsWith(p))

  if (isProtected && !isLoggedIn) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('from', pathname)
    return NextResponse.redirect(url)
  }

  if (isAuthOnly && isLoggedIn) {
    const url = req.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all paths except static files and _next internals.
     * API routes do their own auth — middleware only handles page navigation.
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
