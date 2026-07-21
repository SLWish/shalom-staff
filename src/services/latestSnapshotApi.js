export async function fetchLatestGuildSnapshots() {
  const response = await fetch('/.netlify/functions/latest-snapshot', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) return []

  const payload = await response.json()
  return Array.isArray(payload.guilds)
    ? payload.guilds.filter((snapshot) => snapshot?.guildName && Array.isArray(snapshot?.data?.members))
    : []
}
