/* global process */

import { insertRows } from './_shared/supabaseRest.js'

const STORAGE_GUILD_NAME = '__local_roster__'
const ALLOWED_GUILDS = new Set(['ShaLom', 'ShaLom2', 'ShaLom3', 'ShaLom4', 'ShaLom5', 'ShaLom6'])
const MAX_EVENT_COUNT = 120

function json(statusCode, body) {
  return {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    statusCode,
  }
}

function isAuthorized(event) {
  const secret = process.env.COLLECT_SECRET
  const headerSecret = event.headers.authorization?.replace(/^Bearer\s+/i, '')
  return Boolean(secret) && headerSecret === secret
}

function normalizeEvent(event, seasonKey) {
  const guildName = String(event?.guildName || '').trim()
  const nickname = String(event?.nickname || '').trim()
  const observedTime = new Date(event?.observedAt).getTime()
  const score = Number(event?.score)
  if (!ALLOWED_GUILDS.has(guildName) || !nickname || nickname.length > 80) return null
  if (!Number.isFinite(observedTime) || Math.abs(Date.now() - observedTime) > 24 * 60 * 60 * 1000) return null
  if (!Number.isInteger(score) || score < 0 || score > 1000000000) return null
  return {
    guildName,
    nickname,
    observedAt: new Date(observedTime).toISOString(),
    score,
    seasonKey,
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  if (!isAuthorized(event)) return json(401, { error: 'Unauthorized' })

  try {
    const payload = JSON.parse(event.body || '{}')
    const seasonKey = String(payload.seasonKey || '').trim()
    const events = Array.isArray(payload.events)
      ? payload.events.map((item) => normalizeEvent(item, seasonKey)).filter(Boolean)
      : []

    if (!seasonKey || events.length === 0 || events.length > MAX_EVENT_COUNT) {
      return json(400, { error: 'Invalid roster event report' })
    }

    await insertRows(
      'member_snapshots',
      events.map((item) => ({
        captured_at: item.observedAt,
        guild_name: STORAGE_GUILD_NAME,
        nickname: `${item.guildName}:${item.nickname}`,
        raw_json: {
          event: 'joined',
          guildName: item.guildName,
          nickname: item.nickname,
          observedAt: item.observedAt,
          score: item.score,
          source: 'local-roster-10s',
        },
        score: item.score,
        season_key: seasonKey,
      })),
    )

    return json(200, { eventCount: events.length, savedAt: new Date().toISOString() })
  } catch (error) {
    return json(500, { error: error.message || 'Roster event upload failed' })
  }
}
