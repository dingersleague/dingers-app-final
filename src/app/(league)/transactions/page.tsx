import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Transactions' }

const TX_LABELS: Record<string, string> = {
  ADD: 'Added',
  DROP: 'Dropped',
  WAIVER_ADD: 'Waiver Add',
  WAIVER_DROP: 'Waiver Drop',
  TRADE_ADD: 'Trade (Received)',
  TRADE_DROP: 'Trade (Sent)',
}

export default async function TransactionsPage() {
  const user = await requireAuth()
  const userWithTeam = await prisma.user.findUnique({
    where: { id: user.id },
    include: { team: true },
  })
  if (!userWithTeam?.team) return null

  const leagueId = userWithTeam.team.leagueId

  const league = await prisma.league.findFirst({
    select: { waiverType: true, faabBudget: true },
  })

  // Show FAAB budget leaderboard when league uses FAAB waivers
  const faabTeams = league?.waiverType === 'FAAB'
    ? await prisma.team.findMany({
        where: { leagueId: userWithTeam.team.leagueId },
        select: { id: true, name: true, abbreviation: true, faabBalance: true },
        orderBy: { faabBalance: 'desc' },
      })
    : []

  const transactions = await prisma.transaction.findMany({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      team: { select: { id: true, name: true, abbreviation: true } },
      player: { select: { id: true, fullName: true, positions: true, mlbTeamAbbr: true } },
    },
  })

  const pending = transactions.filter(t => t.status === 'PENDING')
  const processed = transactions.filter(t => t.status !== 'PENDING')

  const myTeamId = userWithTeam.team.id

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="font-display font-black text-4xl tracking-tight">Transactions</h1>
        <p className="text-text-muted text-sm mt-1">All league activity</p>
      </div>

      {/* FAAB Budget Leaderboard — only in FAAB mode */}
      {faabTeams.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-border flex items-center justify-between">
            <h2 className="font-display font-bold text-lg">FAAB Budgets</h2>
            <span className="badge-brand text-xs">${league?.faabBudget} starting</span>
          </div>
          <div className="divide-y divide-surface-border/50">
            {faabTeams.map((team, i) => {
              const pct = league?.faabBudget
                ? Math.round((team.faabBalance / league.faabBudget) * 100)
                : 0
              const isMe = team.id === myTeamId
              return (
                <div
                  key={team.id}
                  className={`flex items-center gap-4 px-5 py-3 ${isMe ? 'bg-brand/3' : ''}`}
                >
                  <span className="font-mono text-sm text-text-muted w-5">{i + 1}</span>
                  <Link href={`/teams/${team.id}`} className={`font-medium text-sm flex-1 hover:underline ${isMe ? 'text-brand' : 'text-text-primary'}`}>
                    {team.name}
                    {isMe && <span className="ml-2 text-xs text-text-muted font-normal">(You)</span>}
                  </Link>
                  {/* Budget bar */}
                  <div className="flex-1 max-w-32">
                    <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="font-mono text-sm font-bold w-16 text-right">
                    ${team.faabBalance}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-border bg-accent-amber/5">
            <h2 className="font-display font-bold text-lg text-accent-amber">Pending Waivers</h2>
          </div>
          <div className="divide-y divide-surface-border/50">
            {pending.map(tx => (
              <TransactionRow key={tx.id} tx={tx} myTeamId={userWithTeam.team!.id} />
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-surface-border">
          <h2 className="font-display font-bold text-lg">Activity Log</h2>
        </div>
        {processed.length === 0 ? (
          <div className="px-5 py-10 text-center text-text-muted text-sm">No transactions yet</div>
        ) : (
          <div className="divide-y divide-surface-border/50">
            {processed.map(tx => (
              <TransactionRow key={tx.id} tx={tx} myTeamId={myTeamId} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TransactionRow({ tx, myTeamId }: { tx: any; myTeamId: string }) {
  const isAdd = tx.type.includes('ADD')
  const isMe = tx.teamId === myTeamId

  return (
    <div className={`flex items-center gap-3 px-5 py-3 ${isMe ? 'bg-brand/3' : ''}`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
        isAdd ? 'bg-brand/15 text-brand' : 'bg-red-500/15 text-red-400'
      }`}>
        {isAdd ? '+' : '−'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/teams/${tx.team.id}`} className={`font-medium text-sm hover:underline ${isMe ? 'text-brand' : 'text-text-primary'}`}>
            {tx.team.name}
          </Link>
          <span className="text-text-muted text-sm">{TX_LABELS[tx.type] ?? tx.type}</span>
          <Link href={`/players/${tx.player.id}`} className="font-medium text-sm text-text-primary hover:underline">{tx.player.fullName}</Link>
        </div>
        <div className="text-xs text-text-muted">
          {tx.player.positions.join('/')} · {tx.player.mlbTeamAbbr ?? 'FA'}
          {tx.faabBid != null && <span className="ml-2">· ${tx.faabBid} FAAB</span>}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-xs text-text-muted font-mono">
          {format(new Date(tx.createdAt), 'MMM d, h:mm a')}
        </div>
        <div className={`text-xs mt-0.5 ${
          tx.status === 'PROCESSED' ? 'text-brand' :
          tx.status === 'PENDING' ? 'text-accent-amber' :
          tx.status === 'REJECTED' ? 'text-accent-red' : 'text-text-muted'
        }`}>
          {tx.status}
        </div>
      </div>
    </div>
  )
}
