// src/worker/index.js
// Ce fichier est injecté dans le service worker généré par next-pwa
// Il ajoute le support des notifications push Web Push

self.addEventListener('push', function(event) {
  if (!event.data) return

  let data
  try {
    data = event.data.json()
  } catch {
    data = { title: 'Verviers Dépannage', body: event.data.text() }
  }

  const options = {
    body:    data.body    || '',
    icon:    data.icon    || '/icons/apple-touch-icon.png',
    badge:   data.badge   || '/icons/apple-touch-icon.png',
    tag:     data.tag     || 'vd-notification',
    data:    { url: data.url || '/' },
    vibrate: [200, 100, 200],
    requireInteraction: false,
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Verviers Dépannage', options)
  )
})

self.addEventListener('notificationclick', function(event) {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus()
          client.navigate(url)
          return
        }
      }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})
