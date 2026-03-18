'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

export default function RefreshScoresButton() {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/matchups/refresh', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        toast.success(`Scores updated (${data.data.synced} games, ${(data.data.duration / 1000).toFixed(1)}s)`)
        router.refresh()
      } else {
        toast.error(data.error || 'Refresh failed')
      }
    } catch {
      toast.error('Refresh failed')
    }
    setRefreshing(false)
  }

  return (
    <button
      onClick={handleRefresh}
      disabled={refreshing}
      className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-brand transition-colors disabled:opacity-50"
      title="Fetch latest HR data from MLB"
    >
      <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
      {refreshing ? 'Updating...' : 'Refresh Scores'}
    </button>
  )
}
