self.addEventListener('push', (event) => {
  let payload
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data?.text() || '디핏이 감지됐어요.' }
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'ShaLom 디핏 알림', {
    body: payload.body || '등록한 캐릭터의 웨이브 진행이 멈췄어요.',
    data: payload.data || { url: '/' },
    icon: payload.icon || '/favicon.svg',
    badge: '/favicon.svg',
    tag: payload.tag || 'shalom-defeat',
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href

  event.waitUntil(self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
    const existing = clients.find((client) => client.url.startsWith(self.location.origin))
    if (existing) {
      existing.navigate(targetUrl)
      return existing.focus()
    }
    return self.clients.openWindow(targetUrl)
  }))
})
