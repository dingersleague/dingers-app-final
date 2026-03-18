/**
 * Global test setup.
 *
 * Mocks Prisma so tests run without a real database.
 * Each test file imports { prisma } from '@/lib/prisma' and gets the mock.
 * Override specific methods per-test with vi.mocked(prisma.xxx).mockResolvedValue(...)
 */

import { vi, beforeEach } from 'vitest'

// ── Environment ────────────────────────────────────────────────────────────────
process.env.DATABASE_URL = 'postgresql://test:test@localhost/test_db'
process.env.SESSION_SECRET = 'test-secret-minimum-32-characters-long-padding'
process.env.REDIS_URL = 'redis://localhost:6379'

// ── Prisma mock ────────────────────────────────────────────────────────────────
vi.mock('@/lib/prisma', () => {
  const mockClient = () => ({
    league: {
      findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
      delete: vi.fn(), count: vi.fn(),
    },
    team: {
      findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(),
    },
    leagueWeek: {
      findFirst: vi.fn(), findFirstOrThrow: vi.fn(), findMany: vi.fn(),
      create: vi.fn(), update: vi.fn(), createMany: vi.fn(), upsert: vi.fn(),
    },
    matchup: {
      findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(),
      update: vi.fn(), updateMany: vi.fn(), createMany: vi.fn(), count: vi.fn(),
    },
    transaction: {
      findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(),
      createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
      deleteMany: vi.fn(), count: vi.fn(),
    },
    rosterSlot: {
      findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(),
      createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
      delete: vi.fn(), deleteMany: vi.fn(), count: vi.fn(),
    },
    lineupSlot: {
      findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(),
      createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
      deleteMany: vi.fn(), count: vi.fn(), upsert: vi.fn(),
    },
    player: {
      findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(),
      create: vi.fn(), update: vi.fn(), upsert: vi.fn(), count: vi.fn(),
    },
    playerGameStats: {
      findMany: vi.fn(), createMany: vi.fn(), upsert: vi.fn(),
    },
    playerSeasonStats: {
      findMany: vi.fn(), upsert: vi.fn(), findFirst: vi.fn(),
    },
    draftSettings: {
      findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn(),
    },
    draftPick: {
      findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(),
      createMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), count: vi.fn(),
    },
    syncLog: { create: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn === 'function') return fn(mockClient())
      return Promise.all(fn as Promise<unknown>[])
    }),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $disconnect: vi.fn(),
  })

  return { prisma: mockClient() }
})

// Reset all mocks between tests to prevent state bleed
beforeEach(() => {
  vi.clearAllMocks()
})
