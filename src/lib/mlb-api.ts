/**
 * MLB Stats API Client
 * Uses the free, public MLB Stats API (statsapi.mlb.com)
 * Docs: https://statsapi.mlb.com/api/v1
 *
 * Key endpoints:
 *   /sports/1/players     - all MLB players
 *   /schedule             - game schedule
 *   /game/{gamePk}/boxscore - box score with stats
 *   /people/{id}/stats    - individual player stats
 */

const BASE = process.env.MLB_STATS_API_BASE || 'https://statsapi.mlb.com/api/v1'

async function mlbFetch<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))

  const res = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' },
    next: { revalidate: 300 }, // 5-min cache for Next.js
  })

  if (!res.ok) {
    throw new Error(`MLB API error: ${res.status} ${res.statusText} for ${url}`)
  }

  return res.json() as T
}

// ─── Types returned by MLB API ────────────────────────────────────────────────

export interface MLBPlayer {
  id: number
  fullName: string
  firstName: string
  lastName: string
  primaryNumber: string
  birthDate: string
  currentTeam?: { id: number; name: string; abbreviation: string }
  primaryPosition: { code: string; abbreviation: string; type: string }
  batSide?: { code: string }
  pitchHand?: { code: string }
  active: boolean
  mlbDebutDate?: string
}

export interface MLBScheduleGame {
  gamePk: number
  gameDate: string       // ISO datetime
  status: { detailedState: string; codedGameState: string }
  teams: {
    home: { team: { id: number; name: string }; score?: number }
    away: { team: { id: number; name: string }; score?: number }
  }
}

export interface MLBBoxScoreBatter {
  personId: number
  stats: {
    batting: {
      homeRuns: number
      atBats: number
      hits: number
      runs: number
      rbi: number
    }
  }
}

// ─── Player functions ─────────────────────────────────────────────────────────

/**
 * Fetch all active MLB players for a given season.
 * The API paginates but returns large lists; we fetch once.
 */
export async function fetchAllPlayers(season: number): Promise<MLBPlayer[]> {
  const data = await mlbFetch<{ people: MLBPlayer[] }>('/sports/1/players', {
    season,
    sportId: 1,
  })
  return data.people ?? []
}

/**
 * Fetch a single player's hitting stats for a season.
 */
export async function fetchPlayerSeasonStats(mlbId: number, season: number) {
  const data = await mlbFetch<{
    stats: Array<{
      splits: Array<{
        stat: {
          homeRuns: number
          gamesPlayed: number
          atBats: number
          hits: number
        }
      }>
    }>
  }>(`/people/${mlbId}/stats`, {
    stats: 'season',
    season,
    sportId: 1,
    group: 'hitting',
  })

  const split = data.stats?.[0]?.splits?.[0]
  return split?.stat ?? { homeRuns: 0, gamesPlayed: 0, atBats: 0, hits: 0 }
}

/**
 * Fetch multiple players' stats in one call using the bulk endpoint.
 * The MLB API supports comma-separated player IDs.
 */
export async function fetchPlayersSeasonStats(mlbIds: number[], season: number) {
  if (mlbIds.length === 0) return {}

  // MLB API limits bulk queries; batch at 100
  const batches: number[][] = []
  for (let i = 0; i < mlbIds.length; i += 100) {
    batches.push(mlbIds.slice(i, i + 100))
  }

  const results: Record<number, { homeRuns: number; gamesPlayed: number; atBats: number; hits: number }> = {}

  for (const batch of batches) {
    const data = await mlbFetch<{
      stats: Array<{
        splits: Array<{
          player: { id: number }
          stat: { homeRuns: number; gamesPlayed: number; atBats: number; hits: number }
        }>
      }>
    }>('/people', {
      personIds: batch.join(','),
      hydrate: `stats(group=[hitting],type=[season],season=${season})`,
    })

    data.stats?.[0]?.splits?.forEach(split => {
      results[split.player.id] = split.stat
    })
  }

  return results
}

// ─── Schedule functions ───────────────────────────────────────────────────────

/**
 * Fetch all MLB games in a date range.
 */
export async function fetchSchedule(startDate: string, endDate: string): Promise<MLBScheduleGame[]> {
  const data = await mlbFetch<{
    dates: Array<{
      date: string
      games: MLBScheduleGame[]
    }>
  }>('/schedule', {
    sportId: 1,
    startDate,
    endDate,
    hydrate: 'team',
    gameType: 'R',
  })

  return (data.dates ?? []).flatMap(d => d.games ?? [])
}

/**
 * Fetch today's games.
 */
export async function fetchTodayGames(): Promise<MLBScheduleGame[]> {
  const today = new Date().toISOString().split('T')[0]
  return fetchSchedule(today, today)
}

// ─── Box score functions ──────────────────────────────────────────────────────

interface BoxScoreResponse {
  teams: {
    home: { batters: number[]; players: Record<string, { person: { id: number }; stats: { batting: { homeRuns: number; atBats: number; hits: number } } }> }
    away: { batters: number[]; players: Record<string, { person: { id: number }; stats: { batting: { homeRuns: number; atBats: number; hits: number } } }> }
  }
}

/**
 * Get HR stats for all batters in a game.
 * Returns a map of mlbPlayerId -> homeRuns.
 */
export async function fetchGameHRs(gamePk: number): Promise<Record<number, number>> {
  const data = await mlbFetch<BoxScoreResponse>(`/game/${gamePk}/boxscore`)
  const hrMap: Record<number, number> = {}

  const processTeam = (team: BoxScoreResponse['teams']['home']) => {
    Object.values(team.players).forEach(p => {
      const hr = p.stats?.batting?.homeRuns ?? 0
      if (hr > 0) hrMap[p.person.id] = hr
    })
  }

  processTeam(data.teams.home)
  processTeam(data.teams.away)

  return hrMap
}

/**
 * Fetch all completed games in a date range and return HR totals per player.
 * This is the core stat sync function.
 */
export async function fetchHRsForDateRange(
  startDate: string,
  endDate: string
): Promise<Array<{ mlbPlayerId: number; mlbGameId: number; gameDate: string; homeRuns: number }>> {
  const games = await fetchSchedule(startDate, endDate)
  const completedGames = games.filter(g =>
    g.status.codedGameState === 'F' || g.status.detailedState === 'Final'
  )

  const results: Array<{ mlbPlayerId: number; mlbGameId: number; gameDate: string; homeRuns: number }> = []

  // Process in parallel, but cap concurrency to avoid rate limiting
  const CONCURRENCY = 5
  for (let i = 0; i < completedGames.length; i += CONCURRENCY) {
    const batch = completedGames.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.allSettled(
      batch.map(async game => {
        const hrMap = await fetchGameHRs(game.gamePk)
        return Object.entries(hrMap).map(([playerId, hr]) => ({
          mlbPlayerId: Number(playerId),
          mlbGameId: game.gamePk,
          gameDate: game.gameDate.split('T')[0],
          homeRuns: hr,
        }))
      })
    )

    batchResults.forEach(result => {
      if (result.status === 'fulfilled') {
        results.push(...result.value)
      }
    })
  }

  return results
}

/**
 * Fetch player positions from MLB API.
 * MLB sometimes returns multiple position codes per player.
 */
export async function fetchPlayerPositions(mlbId: number): Promise<string[]> {
  const data = await mlbFetch<{ people: MLBPlayer[] }>(`/people/${mlbId}`)
  const player = data.people?.[0]
  if (!player) return []

  const pos = player.primaryPosition.abbreviation
  // Normalize position abbreviations
  const normalized: Record<string, string> = {
    'LF': 'OF', 'CF': 'OF', 'RF': 'OF',
    'DH': 'DH',
  }
  return [normalized[pos] ?? pos]
}
