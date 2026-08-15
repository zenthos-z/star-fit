// Service Worker for Starfit
// Only cache static assets in production, skip in development

const CACHE_NAME = 'starfit-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/admin.html'
];

// API endpoints to skip (never cache these)
const SKIP_PATTERNS = [
  /\/api\//,
  /\/ws\//,
  /\/healthz/,
  /:\d{4,5}\//,  // Skip requests with explicit port numbers (like :43112, :43111)
];

// Check if request should be skipped
function shouldSkipRequest(request) {
  const url = new URL(request.url);

  // Skip API requests
  if (SKIP_PATTERNS.some(pattern => pattern.test(url.pathname))) {
    return true;
  }

  // Skip requests with explicit port numbers (dev server)
  if (url.port && url.port !== '80' && url.port !== '443') {
    return true;
  }

  // Skip WebSocket connections
  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    return true;
  }

  return false;
}

self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets:', STATIC_ASSETS);
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  // Clean up old caches
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName.startsWith('starfit-')) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip specific patterns
  if (shouldSkipRequest(request)) {
    console.log('[SW] Skipping request:', request.url);
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((response) => {
        // Only cache successful responses
        if (response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Caching:', request.url);
            cache.put(request, copy);
          });
        }
        return response;
      }).catch((error) => {
        console.log('[SW] Fetch failed, using cache if available:', error);
        return cached;
      });

      return cached || fetchPromise;
    })
  );
});

// Message handler for manual cache updates
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName))
      );
    });
  }
});
