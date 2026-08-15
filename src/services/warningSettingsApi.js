export const DEFAULT_WARNING_SETTINGS = {
  warningsEnabled: true,
  guilds: {
    ShaLom: { enabled: true, cutScore: 40000 },
    ShaLom2: { enabled: true, cutScore: 15000 },
    ShaLom3: { enabled: true, cutScore: 7000 },
    ShaLom4: { enabled: true, cutScore: 3000 },
  },
  updatedAt: null,
}

export async function fetchWarningSettings() {
  const response = await fetch('/.netlify/functions/warning-settings', { cache: 'no-store' })
  if (!response.ok) throw new Error(`Warning settings ${response.status}`)
  const payload = await response.json()
  return {
    guilds: { ...DEFAULT_WARNING_SETTINGS.guilds, ...(payload.guilds || {}) },
    updatedAt: payload.updatedAt || null,
    warningsEnabled: payload.warningsEnabled !== false,
  }
}
