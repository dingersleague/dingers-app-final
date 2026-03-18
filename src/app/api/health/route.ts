import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const start = Date.now()
  const checks: Record<string, { ok: boolean; ms?: number; error?: string }> = {}

  // Database check
  try {
    const dbStart = Date.now()
    await prisma.$queryRaw`SELECT 1`
    checks.database = { ok: true, ms: Date.now() - dbStart }
  } catch (err) {
    checks.database = { ok: false, error: String(err) }
  }

  // Last stat sync check
  try {
    const lastSync = await prisma.syncLog.findFirst({
      where: { type: 'stats', status: 'success' },
      orderBy: { createdAt: 'desc' },
    })
    const ageMs = lastSync ? Date.now() - lastSync.createdAt.getTime() : null
    const staleness = ageMs ? Math.floor(ageMs / 60000) : null
    checks.statSync = {
      ok: !lastSync || ageMs! < 60 * 60 * 1000, // warn if last sync > 1 hour ago
      ms: ageMs ?? undefined,
      error: staleness && staleness > 60 ? `Last sync ${staleness}m ago` : undefined,
    }
  } catch {
    checks.statSync = { ok: false, error: 'Could not query sync logs' }
  }

  const allOk = Object.values(checks).every(c => c.ok)
  const duration = Date.now() - start

  return NextResponse.json(
    {
      status: allOk ? 'ok' : 'degraded',
      checks,
      duration,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? 'unknown',
    },
    { status: allOk ? 200 : 503 }
  )
}
