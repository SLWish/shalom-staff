import { json, nicknameKey, normalizeNickname } from './_shared/defeatAlerts.js'
import { selectRows } from './_shared/supabaseRest.js'

const GUILD_ORDER = new Map([
  ['ShaLom', 1],
  ['ShaLom2', 2],
  ['ShaLom3', 3],
  ['ShaLom4', 4],
])

export async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET 요청만 지원합니다.' })

  const query = normalizeNickname(event.queryStringParameters?.q)
  if (query.length < 2) return json(200, { suggestions: [] })
  if (query.length > 40) return json(400, { error: '검색어가 너무 깁니다.' })

  try {
    const searchKey = nicknameKey(query)
    const rows = await selectRows(
      `defeat_member_status?select=guild_name,nickname&nickname_key=like.${encodeURIComponent(`*${searchKey}*`)}&limit=20`,
    )
    const seen = new Set()
    const suggestions = rows
      .filter((row) => {
        const key = nicknameKey(row.nickname)
        if (!key.includes(searchKey) || seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((left, right) => {
        const leftStarts = nicknameKey(left.nickname).startsWith(searchKey) ? 0 : 1
        const rightStarts = nicknameKey(right.nickname).startsWith(searchKey) ? 0 : 1
        return leftStarts - rightStarts ||
          (GUILD_ORDER.get(left.guild_name) || 99) - (GUILD_ORDER.get(right.guild_name) || 99) ||
          left.nickname.localeCompare(right.nickname)
      })
      .slice(0, 10)
      .map((row) => ({ guildName: row.guild_name, nickname: row.nickname }))

    return json(200, { suggestions })
  } catch (error) {
    console.error('[defeat-nickname-search]', error)
    return json(500, { error: '닉네임을 검색하지 못했습니다.' })
  }
}
