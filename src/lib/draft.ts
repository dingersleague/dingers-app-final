import { prisma } from './prisma'

/**
 * After draft completes, assign starting positions to each team's roster.
 *
 * Two-pass approach to maximize starters:
 *   Pass 1: Assign players to natural position slots (skip UTIL).
 *   Pass 2: Fill remaining empty starter slots with bench players via UTIL.
 *
 * This prevents UTIL from being consumed early by a player who could have
 * filled a natural position slot, which would leave other slots empty.
 */
export async function assignStartingPositions(leagueId: string) {
  const teams = await prisma.team.findMany({
    where: { leagueId },
    include: {
      rosterSlots: {
        where: { acquiredVia: 'DRAFT' },
        include: { player: true },
        orderBy: { acquiredAt: 'asc' },
      },
    },
  })

  // Positional starter slots (UTIL handled separately in pass 2)
  const POSITION_SLOTS = ['C', '1B', '2B', 'SS', '3B', 'OF', 'OF', 'OF']

  function isEligible(playerPositions: string[], targetPos: string): boolean {
    if (targetPos === 'UTIL') return true
    return playerPositions.some(p => {
      if (targetPos === 'OF') return ['OF', 'LF', 'CF', 'RF'].includes(p)
      return p === targetPos
    })
  }

  for (const team of teams) {
    const slotUsed = new Array(POSITION_SLOTS.length).fill(false)
    const assigned = new Set<string>() // roster slot IDs that got a starter slot

    // Pass 1: Assign natural positions (no UTIL)
    for (const slot of team.rosterSlots) {
      const playerPos = slot.player.positions

      for (let i = 0; i < POSITION_SLOTS.length; i++) {
        if (slotUsed[i]) continue
        if (isEligible(playerPos, POSITION_SLOTS[i])) {
          await prisma.rosterSlot.update({
            where: { id: slot.id },
            data: { position: POSITION_SLOTS[i], slotType: 'STARTER' },
          })
          slotUsed[i] = true
          assigned.add(slot.id)
          break
        }
      }
    }

    // Pass 2: Fill UTIL with the first unassigned player
    let utilFilled = false
    for (const slot of team.rosterSlots) {
      if (utilFilled) break
      if (assigned.has(slot.id)) continue

      await prisma.rosterSlot.update({
        where: { id: slot.id },
        data: { position: 'UTIL', slotType: 'STARTER' },
      })
      assigned.add(slot.id)
      utilFilled = true
    }

    // Pass 3: Everything else goes to bench
    for (const slot of team.rosterSlots) {
      if (assigned.has(slot.id)) continue
      await prisma.rosterSlot.update({
        where: { id: slot.id },
        data: { position: 'BN', slotType: 'BENCH' },
      })
    }
  }
}
