const EMPTY_HISTORY = {
  archives: [],
  departures: [],
  joinedMembers: [],
  previousSeasonScores: [],
}

export async function fetchSharedHistory() {
  try {
    const response = await fetch('/.netlify/functions/history', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) return EMPTY_HISTORY

    const payload = await response.json()

    return {
      archives: Array.isArray(payload.archives) ? payload.archives : [],
      departures: Array.isArray(payload.departures) ? payload.departures : [],
      joinedMembers: Array.isArray(payload.joinedMembers) ? payload.joinedMembers : [],
      previousSeasonScores: Array.isArray(payload.previousSeasonScores) ? payload.previousSeasonScores : [],
    }
  } catch {
    return EMPTY_HISTORY
  }
}
