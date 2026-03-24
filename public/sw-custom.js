// public/sw-custom.js
// Service Worker minimaliste pour les push notifications iOS
// Pas de workbox — compatibilité maximale iOS Safari

const CACHE_NAME = 'vd-app-v1'

self.addEventListener('install', event => {
  console.log('[SW Custom] Install')
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  console.log('[SW Custom] Activate')
  event.waitUntil(clients.claim())
})

self.addEventListener('fetch', event => {
  // Laisser passer toutes les requêtes normalement
  // On ne gère pas le cache ici — c'est géré par next-pwa/sw.js
})

self.addEventListener('push', event => {
  console.log('[SW Custom] Push reçu')
  if (!event.data) return

  let data
  try { data = event.data.json() }
  catch { data = { title: 'Verviers Dépannage', body: event.data.text() } }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Verviers Dépannage', {
      body:    data.body    || '',
      icon:    data.icon    || '/icons/apple-touch-icon.png',
      badge:   data.badge   || '/icons/apple-touch-icon.png',
      tag:     data.tag     || 'vd-notification',
      data:    { url: data.url || '/' },
      vibrate: [200, 100, 200],
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) { client.focus(); return }
      }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})
