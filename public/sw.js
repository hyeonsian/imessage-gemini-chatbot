// Service Worker for offline caching
const CACHE_NAME = 'ai-chat-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Skip non-GET requests and API calls
    if (event.request.method !== 'GET' || event.request.url.includes('googleapis.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cached) => {
            const fetchPromise = fetch(event.request).then((response) => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => cached);

            return cached || fetchPromise;
        })
    );
});

// Push Event: Handle incoming push notifications
self.addEventListener('push', (event) => {
    if (!event.data) return;

    const data = event.data.json();
    const options = {
        body: data.body,
        icon: '/icon.svg',
        badge: '/icon.svg',
        tag: 'imessage-ai-notif',
        renotify: true,
        data: {
            url: self.location.origin,
        },
    };

    // Broadcast to all open windows and show notification
    event.waitUntil(
        Promise.all([
            self.registration.showNotification(data.title || 'AI Assistant', options),
            self.clients.matchAll({ type: 'window' }).then(clients => {
                clients.forEach(client => {
                    client.postMessage({
                        type: 'PUSH_MESSAGE',
                        text: data.body,
                        time: new Intl.DateTimeFormat('ko-KR', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                        }).format(new Date())
                    });
                });
            })
        ])
    );
});

// Notification Click: Open the app when notification is clicked
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((clientList) => {
            for (const client of clientList) {
                if (client.url === event.notification.data.url && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data.url);
            }
        })
    );
});
