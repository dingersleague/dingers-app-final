import { prisma } from './prisma'

/**
 * After draft completes, assign starting positions to each team's roster.
 * Fills C, 1B, 2B, SS, 3B, OF, OF, OF, UTIL in draft order, rest go to BN.
 * Each slot index can only be used once — no double-assigning positions.
 */
export async function assignStartingPositions(leagueId: string) {
  const teams = await prisma.team.findMany({
    where: { leagueId },
    include: {
      rosterSlots: {
        where: { acquiredVia: 'DRAFT' },
        include: { player: true },
        orderBy: { acquiredAt: 'asc' }, // draft order
      },
    },
  })

  const STARTER_SLOTS = ['C', '1B', '2B', 'SS', '3B', 'OF', 'OF', 'OF', 'UTIL']

  for (const team of teams) {
    const slotUsed = new Array(STARTER_SLOTS.length).fill(false)

    for (const slot of team.rosterSlots) {
      const playerPos = slot.player.positions
      let assigned = false

      for (let i = 0; i < STARTER_SLOTS.length; i++) {
        if (slotUsed[i]) continue
        const targetPos = STARTER_SLOTS[i]

        const eligible = targetPos === 'UTIL'
          ? true
          : playerPos.some(p => {
              if (targetPos === 'OF') return ['OF', 'LF', 'CF', 'RF'].includes(p)
              return p === targetPos
            })

        if (eligible) {
          await prisma.rosterSlot.update({
            where: { id: slot.id },
            data: { position: targetPos, slotType: 'STARTER' },
          })
          slotUsed[i] = true
          assigned = true
          break
        }
      }

      if (!assigned) {
        await prisma.rosterSlot.update({
          where: { id: slot.id },
          data: { position: 'BN', slotType: 'BENCH' },
        })
      }
    }
  }
}
