// public/sw-push.js
// Ce fichier est importé par le service worker principal (sw.js de next-pwa)
// Il gère la réception et l'affichage des notifications push

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
    actions: data.actions || [],
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
      // Si une fenêtre est déjà ouverte, la focus et naviguer
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus()
          client.navigate(url)
          return
        }
      }
      // Sinon ouvrir une nouvelle fenêtre
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})
