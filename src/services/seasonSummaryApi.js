export async function fetchSeasonSummary(seasonKey) {
  const query = seasonKey ? `?seasonKey=${encodeURIComponent(seasonKey)}` : ''
  const response = await fetch(`/.netlify/functions/season-summary${query}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error('Season summary fetch failed')
  }

  return response.json()
}
