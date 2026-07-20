/* global process */

import { deleteRows, insertRows } from './_shared/supabaseRest.js'

const STORAGE_GUILD_NAME = '__local_wph__'
const ALLOWED_GUILDS = new Set(['ShaLom', 'ShaLom2', 'ShaLom3', 'ShaLom4'])
const MAX_MEMBER_COUNT = 100

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

function toIso(value) {
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function normalizeMember(member) {
  const guildName = String(member?.guildName || '').trim()
  const nickname = String(member?.nickname || '').trim()
  const detail = String(member?.detail || '').trim()
  const hourlySkips = Number(member?.hourlySkips)
  const seasonSkips = Number(member?.seasonSkips)
  const wph = Number(member?.wph)
  if (!ALLOWED_GUILDS.has(guildName) || !nickname || nickname.length > 80) return null
  if (!Number.isInteger(wph) || wph < 0 || wph > 10000) return null
  if (!Number.isInteger(hourlySkips) || hourlySkips < 0 || hourlySkips > 1000) return null
  if (!Number.isInteger(seasonSkips) || seasonSkips < hourlySkips || seasonSkips > 100000) return null
  if (!detail || detail.length > 120) return null
  return { detail, guildName, hourlySkips, nickname, seasonSkips, wph }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  if (!isAuthorized(event)) return json(401, { error: 'Unauthorized' })

  try {
    const payload = JSON.parse(event.body || '{}')
    const slotAt = toIso(payload.slotAt)
    const windowStartAt = toIso(payload.windowStartAt)
    const seasonKey = String(payload.seasonKey || '').trim()
    const members = Array.isArray(payload.members) ? payload.members.map(normalizeMember).filter(Boolean) : []

    if (!slotAt || !windowStartAt || !seasonKey || members.length === 0 || members.length > MAX_MEMBER_COUNT) {
      return json(400, { error: 'Invalid WPH report' })
    }

    const slotTime = new Date(slotAt).getTime()
    if (Math.abs(Date.now() - slotTime) > 2 * 60 * 60 * 1000) {
      return json(400, { error: 'WPH report time is outside the allowed window' })
    }

    await deleteRows(
      `member_snapshots?guild_name=eq.${encodeURIComponent(STORAGE_GUILD_NAME)}&captured_at=eq.${encodeURIComponent(slotAt)}`,
    )
    await insertRows(
      'member_snapshots',
      members.map((member) => ({
        captured_at: slotAt,
        guild_name: STORAGE_GUILD_NAME,
        nickname: `${member.guildName}:${member.nickname}`,
        raw_json: {
          detail: member.detail,
          guildName: member.guildName,
          hourlySkips: member.hourlySkips,
          nickname: member.nickname,
          seasonSkips: member.seasonSkips,
          source: 'local-wph-10s',
          windowStartAt,
          wph: member.wph,
        },
        score: member.wph,
        season_key: seasonKey,
      })),
    )

    return json(200, { memberCount: members.length, savedAt: new Date().toISOString(), slotAt })
  } catch (error) {
    return json(500, { error: error.message || 'Local WPH upload failed' })
  }
}
