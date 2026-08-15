/* global process */

import { json } from './_shared/defeatAlerts.js'
import { selectRows, upsertRows } from './_shared/supabaseRest.js'

const DEFAULT_GUILDS = {
  ShaLom: { enabled: true, cutScore: 40000 },
  ShaLom2: { enabled: true, cutScore: 15000 },
  ShaLom3: { enabled: true, cutScore: 7000 },
  ShaLom4: { enabled: true, cutScore: 3000 },
}

function normalizeSettings(row = {}) {
  const source = row.guild_settings && typeof row.guild_settings === 'object' ? row.guild_settings : {}
  const guilds = Object.fromEntries(Object.entries(DEFAULT_GUILDS).map(([guildName, defaults]) => {
    const candidate = source[guildName] || {}
    const cutScore = Number(candidate.cutScore)
    return [guildName, {
      cutScore: Number.isFinite(cutScore) && cutScore >= 0 && cutScore <= 1000000000 ? Math.round(cutScore) : defaults.cutScore,
      enabled: candidate.enabled !== false,
    }]
  }))

  return {
    guilds,
    updatedAt: row.updated_at || null,
    warningsEnabled: row.warnings_enabled !== false,
  }
}

function isAuthorized(event) {
  const configured = String(process.env.WARNING_ADMIN_TOKEN || '')
  const supplied = String(event.headers?.authorization || '').replace(/^Bearer\s+/i, '')
  return Boolean(configured && supplied && configured === supplied)
}

export async function handler(event) {
  try {
    if (event.httpMethod === 'GET') {
      const rows = await selectRows('guild_warning_settings?select=warnings_enabled,guild_settings,updated_at&id=eq.global&limit=1')
      return json(200, normalizeSettings(rows[0]))
    }
    if (event.httpMethod !== 'POST') return json(405, { error: '지원하지 않는 요청입니다.' })
    if (!isAuthorized(event)) return json(401, { error: '관리자 권한이 없습니다.' })

    let payload
    try {
      payload = JSON.parse(event.body || '{}')
    } catch {
      return json(400, { error: '요청 형식이 올바르지 않습니다.' })
    }

    const normalized = normalizeSettings({ guild_settings: payload.guilds, warnings_enabled: payload.warningsEnabled })
    const updatedAt = new Date().toISOString()
    const [saved] = await upsertRows('guild_warning_settings', [{
      guild_settings: normalized.guilds,
      id: 'global',
      updated_at: updatedAt,
      warnings_enabled: normalized.warningsEnabled,
    }], 'id')
    return json(200, normalizeSettings(saved))
  } catch (error) {
    console.error('[warning-settings]', error)
    return json(500, { error: '경고 설정을 처리하지 못했습니다.' })
  }
}
