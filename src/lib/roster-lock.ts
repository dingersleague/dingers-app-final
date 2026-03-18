/**
 * Roster & Waiver Lock Logic
 *
 * Weekly timeline (all times UTC):
 *   Tuesday (after rollover) → Sunday: Games play, waiver claims open
 *   Monday 1:00 AM:  Waiver claims lock + process (FAAB bids resolved)
 *   Monday 1:00 AM → noon: Free agency window (unclaimed players instant-add)
 *   Monday 12:00 PM: All roster moves lock (no adds, drops, or lineup changes)
 *   Tuesday 5:00 AM: Weekly rollover finalizes scores, advances week
 *   Tuesday 5:01 AM: New week begins, everything reopens
 */

const WAIVER_LOCK_DAY = 1   // Monday
const WAIVER_LOCK_HOUR = 1  // 1 AM UTC
const ROSTER_LOCK_DAY = 1   // Monday
const ROSTER_LOCK_HOUR = 12  // Noon UTC

/**
 * Are waiver claim submissions currently locked?
 * Claims lock Monday 1 AM and stay locked until Tuesday after rollover.
 */
export function isWaiverWindowClosed(): boolean {
  const now = new Date()
  const day = now.getUTCDay() // 0=Sun, 1=Mon, 2=Tue
  const hour = now.getUTCHours()

  // Monday after 1 AM → locked
  if (day === WAIVER_LOCK_DAY && hour >= WAIVER_LOCK_HOUR) return true
  // Tuesday before 6 AM (give rollover buffer) → still locked
  if (day === 2 && hour < 6) return true

  return false
}

/**
 * Are all roster moves (adds, drops, lineup changes) locked?
 * Locked Monday noon through Tuesday 6 AM (after rollover).
 */
export function isRosterLocked(): boolean {
  const now = new Date()
  const day = now.getUTCDay()
  const hour = now.getUTCHours()

  // Monday noon or later → locked
  if (day === ROSTER_LOCK_DAY && hour >= ROSTER_LOCK_HOUR) return true
  // Tuesday before 6 AM → still locked
  if (day === 2 && hour < 6) return true

  return false
}

/**
 * Is the free agency window open?
 * Open Monday 1 AM → Monday noon (after waivers process, before roster lock).
 */
export function isFreeAgencyWindowOpen(): boolean {
  const now = new Date()
  const day = now.getUTCDay()
  const hour = now.getUTCHours()

  return day === ROSTER_LOCK_DAY && hour >= WAIVER_LOCK_HOUR && hour < ROSTER_LOCK_HOUR
}

/**
 * Get human-readable status of the current transaction window.
 */
export function getTransactionWindowStatus(): {
  waiversClosed: boolean
  rosterLocked: boolean
  freeAgencyOpen: boolean
  nextWaiverProcess: string
  nextRosterLock: string
} {
  const now = new Date()
  const waiversClosed = isWaiverWindowClosed()
  const rosterLocked = isRosterLocked()
  const freeAgencyOpen = isFreeAgencyWindowOpen()

  // Next Monday 1 AM
  const nextMonday1AM = new Date(now)
  nextMonday1AM.setUTCDate(now.getUTCDate() + ((WAIVER_LOCK_DAY - now.getUTCDay() + 7) % 7 || 7))
  nextMonday1AM.setUTCHours(WAIVER_LOCK_HOUR, 0, 0, 0)
  if (nextMonday1AM <= now) nextMonday1AM.setUTCDate(nextMonday1AM.getUTCDate() + 7)

  // Next Monday noon
  const nextMondayNoon = new Date(now)
  nextMondayNoon.setUTCDate(now.getUTCDate() + ((ROSTER_LOCK_DAY - now.getUTCDay() + 7) % 7 || 7))
  nextMondayNoon.setUTCHours(ROSTER_LOCK_HOUR, 0, 0, 0)
  if (nextMondayNoon <= now) nextMondayNoon.setUTCDate(nextMondayNoon.getUTCDate() + 7)

  return {
    waiversClosed,
    rosterLocked,
    freeAgencyOpen,
    nextWaiverProcess: nextMonday1AM.toISOString(),
    nextRosterLock: nextMondayNoon.toISOString(),
  }
}
