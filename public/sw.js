// Service worker for DINGERS PWA
// Caches static assets for fast loading. Network-first for API calls.

const CACHE_NAME = 'dingers-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  // Skip non-GET and API requests
  if (request.method !== 'GET' || request.url.includes('/api/')) return

  e.respondWith(
    fetch(request)
      .then(res => {
        // Cache successful responses
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
        }
        return res
      })
      .catch(() => caches.match(request)) // Offline fallback
  )
})
