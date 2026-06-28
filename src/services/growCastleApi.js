const ARRAY_KEYS = ['members', 'guildMembers', 'users', 'ranking', 'rankings', 'list', 'data']
const NAME_KEYS = ['nickname', 'name', 'userName', 'username', 'playerName', 'player', 'nick']
const SCORE_KEYS = ['score', 'seasonScore', 'point', 'points', 'seasonPoint', 'seasonPoints']
const SEASON_KEYS = ['seasonPeriod', 'season', 'period', 'seasonName', 'name']
const WAVE_KEYS = ['wave', 'waves', 'seasonWave']
const DATE_KEYS = ['date', 'updatedAt', 'recordedAt', 'createdAt']
const SEASON_END_BUFFER_MS = 5 * 60 * 1000

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

  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      return source[key]
    }
  }

  return undefined
}

function normalizeNumber(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value.replaceAll(',', '').trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeApiDate(value) {
  if (!value) return null
  const text = String(value)
  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
  const normalized = text.includes('T') && !hasExplicitTimezone ? `${text}Z` : text
  const time = new Date(normalized).getTime()
  return Number.isFinite(time) ? new Date(time).toISOString() : text
}

function applySeasonEndBuffer(value) {
  const normalized = normalizeApiDate(value)
  if (!normalized) return null
  const time = new Date(normalized).getTime()
  return Number.isFinite(time) ? new Date(time - SEASON_END_BUFFER_MS).toISOString() : normalized
}

function findSeasonPeriod(response) {
  const direct = pickValue(response, SEASON_KEYS)
  if (direct && typeof direct !== 'object') return String(direct)

  if (response && typeof response === 'object') {
    const nested = pickValue(response.guild || response.data || response.result || response.season, SEASON_KEYS)
    if (nested && typeof nested !== 'object') return String(nested)
  }

  return '현재 시즌'
}

function findSeasonEnd(response) {
  const candidates = [
    response?.date?.end,
    response?.result?.date?.end,
    response?.data?.date?.end,
    response?.guild?.date?.end,
    response?.season?.date?.end,
    response?.end,
    response?.seasonEnd,
    response?.seasonEndAt,
  ]
  const found = candidates.find(Boolean)
  return applySeasonEndBuffer(found)
}

function findSeasonStart(response) {
  const candidates = [
    response?.date?.start,
    response?.result?.date?.start,
    response?.data?.date?.start,
    response?.guild?.date?.start,
    response?.season?.date?.start,
    response?.start,
    response?.seasonStart,
    response?.seasonStartAt,
  ]
  const found = candidates.find(Boolean)
  return normalizeApiDate(found)
}

function createApiError(message, code, originalError) {
  const error = new Error(message)
  error.code = code
  error.originalError = originalError
  return error
}

async function fetchJson(url, contextLabel) {
  let response

  try {
    response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    })
  } catch (error) {
    console.warn(`[Grow Castle API] ${contextLabel} request failed`, error)
    throw createApiError(
      '브라우저에서 API 호출이 차단되었습니다. 프록시 연결이 필요합니다.',
      'CORS_OR_NETWORK',
      error,
    )
  }

  if (!response.ok) {
    throw createApiError(`데이터 불러오기 실패 (${response.status})`, 'HTTP_ERROR')
  }

  try {
    return await response.json()
  } catch (error) {
    console.warn(`[Grow Castle API] ${contextLabel} invalid json`, error)
    throw createApiError('API 응답 이상', 'INVALID_JSON', error)
  }
}

export function normalizeGuildResponse(response, guildConfig, cutScore) {
  console.log(`[Grow Castle API] ${guildConfig.guildName} raw response`, response)

  const memberArray = findFirstArray(response)

  if (!memberArray) {
    console.warn(`[Grow Castle API] ${guildConfig.guildName} member array not found`, response)
    throw createApiError('API 응답 구조를 해석할 수 없습니다', 'API_SHAPE')
  }

  const members = memberArray
    .map((member, index) => {
      const nickname = pickValue(member, NAME_KEYS)
      const score = normalizeNumber(pickValue(member, SCORE_KEYS))

      if (!nickname || score === null) {
        console.warn(`[Grow Castle API] ${guildConfig.guildName} member parse skipped`, { index, member })
        return null
      }

      return {
        nickname: String(nickname),
        score,
      }
    })
    .filter(Boolean)

  if (members.length === 0 && memberArray.length > 0) {
    throw createApiError('API 응답 구조를 해석할 수 없습니다', 'API_SHAPE')
  }

  return {
    guildName: guildConfig.guildName,
    seasonEndAt: findSeasonEnd(response),
    seasonStartAt: findSeasonStart(response),
    seasonPeriod: findSeasonPeriod(response),
    cutScore,
    members,
  }
}

export async function fetchGuildSeason(guildConfig, cutScore) {
  const payload = await fetchJson(guildConfig.apiUrl, guildConfig.guildName)
  return normalizeGuildResponse(payload, guildConfig, cutScore)
}

export function normalizePlayerResponse(response, nickname) {
  console.log(`[Grow Castle API] player ${nickname} raw response`, response)

  const playerArray = findFirstArray(response)
  const playerRecord = playerArray?.[0] || response?.result || response

  if (!playerRecord || typeof playerRecord !== 'object') {
    throw createApiError('API 응답 구조를 해석할 수 없습니다', 'API_SHAPE')
  }

  const apiNickname = pickValue(playerRecord, NAME_KEYS) || nickname
  const score = normalizeNumber(pickValue(playerRecord, SCORE_KEYS))
  const wave = normalizeNumber(pickValue(playerRecord, WAVE_KEYS))
  const apiDate = pickValue(playerRecord, DATE_KEYS)

  if (wave === null && score === null) {
    console.warn(`[Grow Castle API] player ${nickname} parse failed`, response)
    throw createApiError('API 응답 구조를 해석할 수 없습니다', 'API_SHAPE')
  }

  return {
    nickname: String(apiNickname),
    personalScore: score,
    wave,
    apiDate: normalizeApiDate(apiDate),
  }
}

export async function fetchPlayerSeason(nickname) {
  const url = `https://raongames.com/growcastle/restapi/season/now/players/${encodeURIComponent(nickname)}`
  const payload = await fetchJson(url, `player ${nickname}`)
  return normalizePlayerResponse(payload, nickname)
}
