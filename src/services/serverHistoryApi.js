export async function fetchSharedSeasonArchives() {
  try {
    const response = await fetch('/.netlify/functions/history', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) return []

    const payload = await response.json()
    return Array.isArray(payload.archives) ? payload.archives : []
  } catch {
    return []
  }
}
