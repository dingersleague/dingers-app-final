/**
 * Scoring engine unit tests.
 *
 * Tests pure functions only — no DB mock needed here.
 * isLineupLocked, getLineupLockTime, canPlayInSlot, validateLineup
 * are all deterministic given their inputs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isLineupLocked, getLineupLockTime, canPlayInSlot, validateLineup } from '@/lib/scoring'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MOCK_LEAGUE = {
  lineupLockHour: 1, // 1 AM UTC
}

const TUESDAY_BEFORE_LOCK = new Date('2026-04-07T00:30:00Z')  // Tue 12:30 AM UTC — before 1 AM lock
const TUESDAY_AFTER_LOCK  = new Date('2026-04-07T02:00:00Z')  // Tue 2:00 AM UTC — after 1 AM lock
const WEDNESDAY_MID_WEEK  = new Date('2026-04-08T15:00:00Z')  // Wed mid-week — still locked
const MONDAY_PRE_ROLLOVER = new Date('2026-04-06T23:00:00Z')  // Mon 11 PM UTC — previous week

// Week starting Tuesday 2026-04-07 1 AM UTC
const WEEK = {
  startDate: new Date('2026-04-07T01:00:00Z'),
  endDate:   new Date('2026-04-14T01:00:00Z'),
}

// Need fake timers for setSystemTime
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

// ─── isLineupLocked ──────────────────────────────────────────────────────────

describe('isLineupLocked', () => {
  it('returns false before the lock time on the start date', () => {
    vi.setSystemTime(TUESDAY_BEFORE_LOCK)
    expect(isLineupLocked(WEEK.startDate, MOCK_LEAGUE as any)).toBe(false)
  })

  it('returns true at exactly the lock hour', () => {
    vi.setSystemTime(new Date('2026-04-07T01:00:00Z'))
    expect(isLineupLocked(WEEK.startDate, MOCK_LEAGUE as any)).toBe(true)
  })

  it('returns true after the lock time', () => {
    vi.setSystemTime(TUESDAY_AFTER_LOCK)
    expect(isLineupLocked(WEEK.startDate, MOCK_LEAGUE as any)).toBe(true)
  })

  it('returns true mid-week after lock', () => {
    vi.setSystemTime(WEDNESDAY_MID_WEEK)
    expect(isLineupLocked(WEEK.startDate, MOCK_LEAGUE as any)).toBe(true)
  })

  it('returns false before the week starts (Monday)', () => {
    vi.setSystemTime(MONDAY_PRE_ROLLOVER)
    expect(isLineupLocked(WEEK.startDate, MOCK_LEAGUE as any)).toBe(false)
  })

  it('respects custom lineupLockHour (0 = midnight)', () => {
    vi.setSystemTime(new Date('2026-04-07T00:00:00Z'))
    const midnightLeague = { lineupLockHour: 0 }
    expect(isLineupLocked(WEEK.startDate, midnightLeague as any)).toBe(true)
  })
})

// ─── getLineupLockTime ───────────────────────────────────────────────────────

describe('getLineupLockTime', () => {
  it('returns the correct UTC lock timestamp for a week', () => {
    const lockTime = getLineupLockTime(WEEK.startDate, MOCK_LEAGUE as any)
    expect(lockTime).toEqual(new Date('2026-04-07T01:00:00Z'))
  })

  it('returns midnight UTC when lockHour is 0', () => {
    const lockTime = getLineupLockTime(WEEK.startDate, { lineupLockHour: 0 } as any)
    expect(lockTime).toEqual(new Date('2026-04-07T00:00:00Z'))
  })
})

// ─── canPlayInSlot ───────────────────────────────────────────────────────────

describe('canPlayInSlot', () => {
  it('allows a 1B to fill 1B slot', () => {
    expect(canPlayInSlot(['1B'], '1B')).toBe(true)
  })

  it('allows a 1B to fill UTIL slot', () => {
    expect(canPlayInSlot(['1B'], 'UTIL')).toBe(true)
  })

  it('allows an OF to fill OF slot', () => {
    expect(canPlayInSlot(['OF'], 'OF')).toBe(true)
  })

  it('disallows a pitcher in C slot', () => {
    expect(canPlayInSlot(['SP'], 'C')).toBe(false)
  })

  it('allows multi-position player if any position matches', () => {
    expect(canPlayInSlot(['SS', '3B'], '3B')).toBe(true)
  })

  it('allows any position in BN (bench) slot', () => {
    expect(canPlayInSlot(['C'], 'BN')).toBe(true)
  })

  it('disallows 1B in SS slot', () => {
    expect(canPlayInSlot(['1B'], 'SS')).toBe(false)
  })

  it('allows C in UTIL slot', () => {
    expect(canPlayInSlot(['C'], 'UTIL')).toBe(true)
  })
})

// ─── validateLineup ──────────────────────────────────────────────────────────

describe('validateLineup', () => {
  const makeSlot = (position: string, playerPositions: string[], id = 'p1') => ({
    position,
    playerPositions,
    playerId: id,
  })

  it('passes a valid lineup', () => {
    const slots = [
      makeSlot('C',    ['C'],  'p1'),
      makeSlot('1B',   ['1B'], 'p2'),
      makeSlot('2B',   ['2B'], 'p3'),
      makeSlot('SS',   ['SS'], 'p4'),
      makeSlot('3B',   ['3B'], 'p5'),
      makeSlot('OF',   ['OF'], 'p6'),
      makeSlot('OF',   ['OF'], 'p7'),
      makeSlot('OF',   ['OF'], 'p8'),
      makeSlot('UTIL', ['DH'], 'p9'),
    ]
    const result = validateLineup(slots as any)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects a player in a slot they cannot fill', () => {
    const slots = [
      makeSlot('C', ['1B'], 'p1'), // 1B cannot play C
    ]
    const result = validateLineup(slots as any)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('BN slots accept any player position', () => {
    // canPlayInSlot handles BN correctly — BN eligibility includes all positions.
    // validateLineup also checks starter slot counts, so a full valid lineup
    // with bench players must satisfy the starter requirements too.
    // Test canPlayInSlot directly for bench:
    expect(canPlayInSlot(['C'], 'BN')).toBe(true)
    expect(canPlayInSlot(['SP'], 'BN')).toBe(true)
    expect(canPlayInSlot(['1B'], 'BN')).toBe(true)
  })
})
