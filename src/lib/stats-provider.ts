/**
 * Stats Provider Abstraction
 *
 * All business logic (scoring.ts, workers/index.ts) calls this interface.
 * The concrete implementation is selected by STATS_PROVIDER env var.
 *
 * To swap in Sportradar:
 *   1. Create src/lib/providers/sportradar.ts implementing StatsProvider
 *   2. Set STATS_PROVIDER=sportradar in .env
 *   3. Zero changes to scoring.ts or workers/index.ts required
 */

export interface PlayerRecord {
  mlbId: number
  fullName: string
  firstName: string
  lastName: string
  positions: string[]          // normalized: LF/CF/RF -> OF
  mlbTeamId: number | null
  mlbTeamAbbr: string | null
  mlbTeamName: string | null
  active: boolean
}

export interface GameHRRecord {
  mlbPlayerId: number
  mlbGameId: number
  gameDate: string             // YYYY-MM-DD
  homeRuns: number
}

export interface PlayerSeasonStatsRecord {
  mlbPlayerId: number
  homeRuns: number
  gamesPlayed: number
  atBats: number
  hits: number
}

export interface StatsProvider {
  /**
   * Fetch all active MLB players for a season.
   */
  fetchAllPlayers(season: number): Promise<PlayerRecord[]>

  /**
   * Fetch HR data for all completed games in a date range.
   * This is the hot path — called every 15 minutes during the season.
   */
  fetchHRsForDateRange(startDate: string, endDate: string): Promise<GameHRRecord[]>

  /**
   * Fetch season stats for a list of player MLB IDs.
   * Used for player search rankings and stat display.
   */
  fetchPlayersSeasonStats(
    mlbIds: number[],
    season: number
  ): Promise<Record<number, PlayerSeasonStatsRecord>>
}

// ─── MLB Stats API Implementation ────────────────────────────────────────────

import {
  fetchAllPlayers as mlbFetchAllPlayers,
  fetchHRsForDateRange as mlbFetchHRs,
  fetchPlayersSeasonStats as mlbFetchStats,
} from './mlb-api'

class MLBStatsProvider implements StatsProvider {
  async fetchAllPlayers(season: number): Promise<PlayerRecord[]> {
    const players = await mlbFetchAllPlayers(season)
    return players.map(p => ({
      mlbId: p.id,
      fullName: p.fullName,
      firstName: p.firstName,
      lastName: p.lastName,
      positions: normalizePositions([p.primaryPosition.abbreviation]),
      mlbTeamId: p.currentTeam?.id ?? null,
      mlbTeamAbbr: p.currentTeam?.abbreviation ?? null,
      mlbTeamName: p.currentTeam?.name ?? null,
      active: p.active,
    }))
  }

  async fetchHRsForDateRange(startDate: string, endDate: string): Promise<GameHRRecord[]> {
    return mlbFetchHRs(startDate, endDate)
  }

  async fetchPlayersSeasonStats(
    mlbIds: number[],
    season: number
  ): Promise<Record<number, PlayerSeasonStatsRecord>> {
    const raw = await mlbFetchStats(mlbIds, season)
    const result: Record<number, PlayerSeasonStatsRecord> = {}
    for (const [idStr, stats] of Object.entries(raw)) {
      result[Number(idStr)] = {
        mlbPlayerId: Number(idStr),
        homeRuns: stats.homeRuns,
        gamesPlayed: stats.gamesPlayed,
        atBats: stats.atBats,
        hits: stats.hits,
      }
    }
    return result
  }
}

// ─── Provider registry ────────────────────────────────────────────────────────

function normalizePositions(positions: string[]): string[] {
  return positions.map(p => (['LF', 'CF', 'RF'].includes(p) ? 'OF' : p))
}

function createProvider(): StatsProvider {
  const providerName = process.env.STATS_PROVIDER ?? 'mlb'

  switch (providerName) {
    case 'mlb':
      return new MLBStatsProvider()
    // case 'sportradar':
    //   return new SportradarProvider()  // implement when needed
    default:
      console.warn(`Unknown STATS_PROVIDER "${providerName}", falling back to mlb`)
      return new MLBStatsProvider()
  }
}

// Singleton — instantiated once per process
export const statsProvider: StatsProvider = createProvider()
