import { PrismaClient } from '@prisma/client'
import { PHASE_PRODUCTION_BUILD } from 'next/constants'

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

/**
 * Prisma singleton.
 *
 * During `next build` (NEXT_PHASE === 'phase-production-build') the process
 * should never reach database code because all routes are marked
 * `force-dynamic`. We still create the client object so imports resolve, but
 * it will throw at query time if there is no DATABASE_URL — which is correct.
 *
 * In development we reuse a global instance so hot-reload doesn't exhaust the
 * connection pool.
 */
export const prisma = globalThis.__prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
})

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma
}
