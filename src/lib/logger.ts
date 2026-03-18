/**
 * Structured logger for DINGERS league-state transitions.
 *
 * Outputs newline-delimited JSON (NDJSON) so log aggregators (Datadog, Logtail,
 * Railway logs, etc.) can parse fields directly.
 *
 * Usage:
 *   import { log } from '@/lib/logger'
 *   log('info', 'finalize_week_start', { leagueId, weekNumber })
 *   log('error', 'waiver_run_failed', { leagueId, error: String(err) })
 */

export type LogLevel = 'info' | 'warn' | 'error'

export function log(
  level: LogLevel,
  event: string,
  context: Record<string, unknown> = {}
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...context,
  }

  const line = JSON.stringify(entry)

  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}
