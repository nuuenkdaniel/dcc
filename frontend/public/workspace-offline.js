const SHELL = 'dcc-workspace-shell-v1'

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('message', event => {
  if (event.data !== 'retain-workspace-shell') return
  // Fetch the public asset graph as a unit before replacing the cached shell.
  // API responses and authenticated records never enter the service-worker cache.
  event.waitUntil((async () => {
    const root = new URL('/', self.location.origin)
    const response = await fetch(root, { cache: 'no-cache', credentials: 'omit' })
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return
    const html = await response.clone().text()
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[\w.-]+)"/g)].map(match => match[1])
    if (!assets.some(asset => asset.endsWith('.js'))) return
    const cache = await caches.open(SHELL)
    await cache.addAll([...new Set(assets)])
    await cache.put(root.href, response)
  })().catch(() => {}))
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return
  if (event.request.mode === 'navigate' && ['/', '/today', '/projects', '/inbox', '/pomodoro', '/settings', '/prices', '/login'].includes(url.pathname)) {
    event.respondWith(fetch(event.request).catch(async error => {
      const cache = await caches.open(SHELL)
      const response = await cache.match(new URL('/', self.location.origin).href)
      if (response) return response
      throw error
    }))
  } else if (/^\/assets\/[\w.-]+$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL)
      // These paths identify public, content-hashed assets. The module request
      // can carry a different Origin header from the service worker's preload.
      return await cache.match(url.href, { ignoreVary: true }) ?? fetch(event.request)
    })())
  }
})
