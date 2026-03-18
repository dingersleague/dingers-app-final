// ─── Shared application types ────────────────────────────────────────────────

export type UserRole = 'COMMISSIONER' | 'OWNER'
export type LeagueStatus = 'SETUP' | 'PREDRAFT' | 'DRAFT' | 'REGULAR_SEASON' | 'PLAYOFFS' | 'OFFSEASON'
export type MatchupStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETE'
export type PlayerStatus = 'ACTIVE' | 'INJURED_10_DAY' | 'INJURED_60_DAY' | 'SUSPENDED' | 'MINORS' | 'INACTIVE'
export type AcquisitionType = 'DRAFT' | 'WAIVER' | 'FREE_AGENT' | 'TRADE'
export type TransactionType = 'ADD' | 'DROP' | 'TRADE_ADD' | 'TRADE_DROP' | 'WAIVER_ADD' | 'WAIVER_DROP'
export type TransactionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PROCESSED'
export type DraftStatus = 'PENDING' | 'ACTIVE' | 'COMPLETE' | 'PAUSED'
export type WaiverType = 'PRIORITY' | 'FAAB' | 'FREE_AGENCY'

// All valid lineup positions
export const LINEUP_POSITIONS = ['C', '1B', '2B', 'SS', '3B', 'OF', 'OF', 'OF', 'UTIL', 'BN', 'BN', 'BN', 'BN', 'IL'] as const
export const STARTER_POSITIONS = ['C', '1B', '2B', 'SS', '3B', 'OF', 'OF', 'OF', 'UTIL'] as const
export const BENCH_POSITIONS = ['BN', 'BN', 'BN', 'BN'] as const

// Injured players eligible for IL slot
export const IL_STATUSES = ['INJURED_10_DAY', 'INJURED_60_DAY'] as const

// Position eligibility map: position slot -> which player positions can fill it
export const POSITION_ELIGIBILITY: Record<string, string[]> = {
  C:    ['C'],
  '1B': ['1B', '3B'],
  '2B': ['2B', 'SS'],
  SS:   ['SS', '2B'],
  '3B': ['3B', '1B'],
  OF:   ['OF', 'LF', 'CF', 'RF'],
  UTIL: ['C', '1B', '2B', 'SS', '3B', 'OF', 'LF', 'CF', 'RF', 'DH'],
  BN:   ['C', '1B', '2B', 'SS', '3B', 'OF', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP', 'P'],
  IL:   ['C', '1B', '2B', 'SS', '3B', 'OF', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP', 'P'], // any position, but player must be on IL
}

export interface SessionUser {
  id: string
  email: string
  name: string
  role: UserRole
  teamId: string | null
  leagueId: string | null
}

export interface PlayerSearchResult {
  id: string
  mlbId: number
  fullName: string
  positions: string[]
  mlbTeamAbbr: string | null
  status: PlayerStatus
  seasonHR: number
  isOnRoster: boolean
  ownedByTeamId: string | null
  ownedByTeamName: string | null
}

export interface RosterPlayer {
  rosterSlotId: string
  player: {
    id: string
    mlbId: number
    fullName: string
    positions: string[]
    mlbTeamAbbr: string | null
    status: PlayerStatus
    seasonHR: number
  }
  position: string
  isStarter: boolean
  acquiredVia: AcquisitionType
  acquiredAt: Date
  weeklyHR?: number  // HR this matchup week
}

export interface MatchupView {
  id: string
  weekNumber: number
  status: MatchupStatus
  home: {
    team: { id: string; name: string; abbreviation: string }
    score: number
    hr: number
    lineup: RosterPlayer[]
  }
  away: {
    team: { id: string; name: string; abbreviation: string }
    score: number
    hr: number
    lineup: RosterPlayer[]
  }
  winner: string | null
  startDate: Date
  endDate: Date
}

export interface StandingsRow {
  rank: number
  team: { id: string; name: string; abbreviation: string; logoUrl: string | null }
  wins: number
  losses: number
  ties: number
  pct: number
  pointsFor: number
  pointsAgainst: number
  streak: string
  last5: string
}

export interface DraftBoardState {
  currentPick: number
  currentRound: number
  currentTeamId: string
  status: DraftStatus
  picks: DraftPickView[]
  availablePlayers: PlayerSearchResult[]
  timerEndsAt: Date | null
}

export interface DraftPickView {
  pickNumber: number
  round: number
  pickInRound: number
  teamId: string
  teamName: string
  player: {
    id: string
    fullName: string
    positions: string[]
    mlbTeamAbbr: string | null
    seasonHR: number
  } | null
  isAutoPick: boolean
}

export interface TransactionView {
  id: string
  type: TransactionType
  status: TransactionStatus
  team: { id: string; name: string }
  player: { id: string; fullName: string; positions: string[]; mlbTeamAbbr: string | null }
  relatedPlayer?: { id: string; fullName: string }
  relatedTeam?: { id: string; name: string }
  faabBid: number | null
  createdAt: Date
  processedAt: Date | null
}

export interface ApiResponse<T = void> {
  success: boolean
  data?: T
  error?: string
  message?: string
}
