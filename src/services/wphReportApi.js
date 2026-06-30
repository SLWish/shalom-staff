export async function fetchWphReport() {
  const response = await fetch('/.netlify/functions/wph-report', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error('WPH report fetch failed')
  }

  return response.json()
}
