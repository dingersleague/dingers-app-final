import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

export const dynamic = 'force-dynamic' // prevent static build-time evaluation

export async function POST(req: NextRequest) {
  const session = await getSession()
  session.destroy()
  return NextResponse.redirect(new URL('/login', req.url))
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  session.destroy()
  return NextResponse.redirect(new URL('/login', req.url))
}
