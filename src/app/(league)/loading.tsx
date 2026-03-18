export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Page header skeleton */}
      <div>
        <div className="h-3 w-32 bg-surface-3 rounded mb-2" />
        <div className="h-9 w-64 bg-surface-3 rounded" />
      </div>

      {/* Cards skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-surface-2 border border-surface-border rounded-2xl h-48" />
        <div className="space-y-3">
          <div className="bg-surface-2 border border-surface-border rounded-2xl h-20" />
          <div className="bg-surface-2 border border-surface-border rounded-2xl h-20" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface-2 border border-surface-border rounded-2xl h-64" />
        <div className="bg-surface-2 border border-surface-border rounded-2xl h-64" />
      </div>
    </div>
  )
}
