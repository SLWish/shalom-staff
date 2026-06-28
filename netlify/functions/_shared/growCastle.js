const SEASON_END_BUFFER_MS = 5 * 60 * 1000

export const guildConfigs = [
  {
    guildName: 'ShaLom',
    apiUrl: 'https://raongames.com/growcastle/restapi/season/now/guilds/ShaLom',
    cutScore: 40000,
    order: 1,
    type: 'active',
  },
  {
    guildName: 'ShaLom2',
    apiUrl: 'https://raongames.com/growcastle/restapi/season/now/guilds/ShaLom2',
    cutScore: 15000,
    order: 2,
    type: 'active',
  },
  {
    guildName: 'ShaLom3',
    apiUrl: 'https://raongames.com/growcastle/restapi/season/now/guilds/ShaLom3',
    cutScore: 7000,
    order: 3,
    type: 'active',
  },
  {
    guildName: 'ShaLom4',
    apiUrl: 'https://raongames.com/growcastle/restapi/season/now/guilds/ShaLom4',
    cutScore: 3000,
    order: 4,
    type: 'active',
  },
  {
    guildName: 'ShaLom5',
    apiUrl: 'https://raongames.com/growcastle/restapi/season/now/guilds/ShaLom5',
    cutScore: 0,
    order: 5,
    type: 'rest',
  },
  {
    guildName: 'ShaLom6',
    apiUrl: 'https://raongames.com/growcastle/restapi/season/now/guilds/ShaLom6',
    cutScore: 0,
    order: 6,
    type: 'rest',
  },
]

const ARRAY_KEYS = ['members', 'guildMembers', 'users', 'ranking', 'rankings', 'list', 'data']
const NAME_KEYS = ['nickname', 'name', 'userName', 'username', 'playerName', 'player', 'nick']
const SCORE_KEYS = ['score', 'seasonScore', 'point', 'points', 'seasonPoint', 'seasonPoints']
const ROLE_KEYS = ['role', 'memo', 'grade', 'position', 'rank', 'memberRole', 'guildRole', 'title']
const WAVE_KEYS = ['wave', 'waves', 'seasonWave']

function findFirstArray(value, depth = 0) {
  if (!value || depth > 4) return null
  if (Array.isArray(value)) return value
  if (typeof value !== 'object') return null

  for (const key of ARRAY_KEYS) {
    if (Array.isArray(value[key])) return value[key]
  }

  for (const key of Object.keys(value)) {
    const found = findFirstArray(value[key], depth + 1)
    if (found) return found
  }

  return null
}

function pickValue(source, keys) {
  if (!source || typeof source !== 'object') return undefined
  return keys.map((key) => source[key]).find((value) => value !== undefined && value !== null && value !== '')
}

function normalizeNumber(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value.replaceAll(',', '').trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeRole(value) {
  return value === undefined || value === null ? '' : String(value).trim()
}

function isGuildLeaderRole(value) {
  const text = normalizeRole(value)
  if (!text) return false

  const lowerText = text.toLowerCase().replaceAll(/[\s_-]/g, '')
  return (
    lowerText.includes('guildmaster') ||
    lowerText.includes('guildleader') ||
    lowerText === 'master' ||
    lowerText === 'leader' ||
    lowerText === 'owner' ||
    text.includes('길드장') ||
    text.includes('마스터')
  )
}

function normalizeApiDate(value) {
  if (!value) return null
  const text = String(value)
  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
  const normalized = text.includes('T') && !hasExplicitTimezone ? `${text}Z` : text
  const time = new Date(normalized).getTime()
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function getSeasonDate(payload, key) {
  const candidates = [
    payload?.date?.[key],
    payload?.result?.date?.[key],
    payload?.data?.date?.[key],
    payload?.guild?.date?.[key],
    payload?.season?.date?.[key],
    payload?.[key],
    payload?.[`season${key[0].toUpperCase()}${key.slice(1)}`],
    payload?.[`season${key[0].toUpperCase()}${key.slice(1)}At`],
  ]
  const normalized = normalizeApiDate(candidates.find(Boolean))
  if (key !== 'end' || !normalized) return normalized
  return new Date(new Date(normalized).getTime() - SEASON_END_BUFFER_MS).toISOString()
}

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Grow Castle API failed: ${response.status}`)
  return response.json()
}

export async function fetchPlayerSeason(nickname) {
  const payload = await fetchJson(`https://raongames.com/growcastle/restapi/season/now/players/${encodeURIComponent(nickname)}`)
  const playerArray = findFirstArray(payload)
  const playerRecord = playerArray?.[0] || payload?.result || payload
  const score = normalizeNumber(pickValue(playerRecord, SCORE_KEYS))
  const wave = normalizeNumber(pickValue(playerRecord, WAVE_KEYS))
  const apiDate = normalizeApiDate(pickValue(playerRecord, ['date', 'updatedAt', 'recordedAt', 'createdAt']))

  return {
    apiDate,
    nickname,
    personalScore: score,
    wave,
  }
}

export async function fetchGuildSeason(config) {
  const payload = await fetchJson(config.apiUrl)
  const memberArray = findFirstArray(payload)
  if (!memberArray) throw new Error(`Member array not found for ${config.guildName}`)

  const members = memberArray
    .map((member) => {
      const nickname = pickValue(member, NAME_KEYS)
      const score = normalizeNumber(pickValue(member, SCORE_KEYS))
      const role = normalizeRole(pickValue(member, ROLE_KEYS))
      if (!nickname || score === null) return null
      return { isGuildLeader: isGuildLeaderRole(role), nickname: String(nickname), role, score }
    })
    .filter(Boolean)

  const settled = await Promise.allSettled(members.map((member) => fetchPlayerSeason(member.nickname)))

  return {
    cutScore: config.cutScore,
    guildName: config.guildName,
    members: members.map((member, index) => {
      const detail = settled[index].status === 'fulfilled' ? settled[index].value : null
      return {
        ...member,
        apiDate: detail?.apiDate || null,
        personalScore: typeof detail?.personalScore === 'number' ? detail.personalScore : null,
        wave: typeof detail?.wave === 'number' ? detail.wave : null,
      }
    }),
    seasonEndAt: getSeasonDate(payload, 'end'),
    seasonStartAt: getSeasonDate(payload, 'start'),
    type: config.type,
  }
}
