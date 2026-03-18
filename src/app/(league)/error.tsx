'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log to your observability platform here
    console.error('[page error]', error)
  }, [error])

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={28} className="text-accent-red" />
        </div>
        <h2 className="font-display font-black text-2xl mb-2">Something broke</h2>
        <p className="text-text-muted text-sm mb-6">
          {error.message || 'An unexpected error occurred. Our bad.'}
        </p>
        <div className="flex gap-3 justify-center">
          <button onClick={reset} className="btn-brand flex items-center gap-2">
            <RefreshCw size={14} />
            Try again
          </button>
          <a href="/dashboard" className="btn-secondary">Go home</a>
        </div>
        {error.digest && (
          <p className="text-text-muted text-xs mt-4 font-mono">Error ID: {error.digest}</p>
        )}
      </div>
    </div>
  )
}
