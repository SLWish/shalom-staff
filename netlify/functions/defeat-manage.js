import {
  findGuildCharacter,
  getBearerToken,
  json,
  nicknameKey,
  normalizeNickname,
  sha256,
} from './_shared/defeatAlerts.js'
import { deleteRows, insertRows, selectRows, updateRows } from './_shared/supabaseRest.js'

async function getSubscriber(event) {
  const token = getBearerToken(event)
  if (!token) return null
  const [subscriber] = await selectRows(
    `defeat_subscribers?select=id,alerts_enabled,verified_at,created_at&manage_token_hash=eq.${sha256(token)}&limit=1`,
  )
  return subscriber || null
}

async function getManageState(subscriber) {
  const characters = await selectRows(
    `defeat_characters?select=id,guild_name,nickname,alerts_enabled,last_wave,last_api_date,last_checked_at,is_defeated,defeated_at,last_notified_at,created_at&subscriber_id=eq.${subscriber.id}&order=created_at.asc`,
  )
  return {
    accountAlertsEnabled: subscriber.alerts_enabled,
    characters: characters.map((character) => ({
      alertsEnabled: character.alerts_enabled,
      createdAt: character.created_at,
      defeatedAt: character.defeated_at,
      guildName: character.guild_name,
      id: character.id,
      isDefeated: character.is_defeated,
      lastApiDate: character.last_api_date,
      lastCheckedAt: character.last_checked_at,
      lastNotifiedAt: character.last_notified_at,
      lastWave: character.last_wave,
      nickname: character.nickname,
    })),
  }
}

export async function handler(event) {
  try {
    const subscriber = await getSubscriber(event)
    if (!subscriber) return json(401, { error: '관리 링크가 유효하지 않습니다.' })

    if (event.httpMethod === 'GET') return json(200, await getManageState(subscriber))
    if (event.httpMethod !== 'POST') return json(405, { error: '지원하지 않는 요청입니다.' })

    let payload
    try {
      payload = JSON.parse(event.body || '{}')
    } catch {
      return json(400, { error: '요청 형식이 올바르지 않습니다.' })
    }

    const now = new Date().toISOString()
    if (payload.action === 'toggle-account') {
      await updateRows(`defeat_subscribers?id=eq.${subscriber.id}`, {
        alerts_enabled: Boolean(payload.enabled),
        updated_at: now,
      })
      subscriber.alerts_enabled = Boolean(payload.enabled)
    } else if (payload.action === 'add-character') {
      const nickname = normalizeNickname(payload.nickname)
      if (!nickname || nickname.length > 40) return json(400, { error: '올바른 닉네임을 입력해주세요.' })

      const { failedGuilds, matches } = await findGuildCharacter(nickname)
      if (matches.length === 0 && failedGuilds.length > 0) {
        return json(503, { error: '게임 API가 불안정해 닉네임을 확인하지 못했습니다.' })
      }
      if (matches.length === 0) return json(404, { error: 'ShaLom 1~4군에서 해당 닉네임을 찾지 못했습니다.' })
      if (matches.length > 1) return json(409, { error: '같은 닉네임이 여러 군에 있어 자동으로 확인할 수 없습니다.' })

      const [existing] = await selectRows(
        `defeat_characters?select=id&subscriber_id=eq.${subscriber.id}&nickname_key=eq.${encodeURIComponent(nicknameKey(matches[0].nickname))}&limit=1`,
      )
      if (existing) return json(409, { error: '이미 등록된 캐릭터입니다.' })

      await insertRows('defeat_characters', [{
        guild_name: matches[0].guildName,
        nickname: matches[0].nickname,
        nickname_key: nicknameKey(matches[0].nickname),
        subscriber_id: subscriber.id,
      }])
    } else if (payload.action === 'toggle-character') {
      if (!payload.characterId) return json(400, { error: '캐릭터 정보가 없습니다.' })
      await updateRows(
        `defeat_characters?id=eq.${encodeURIComponent(payload.characterId)}&subscriber_id=eq.${subscriber.id}`,
        { alerts_enabled: Boolean(payload.enabled), updated_at: now },
      )
    } else if (payload.action === 'delete-character') {
      if (!payload.characterId) return json(400, { error: '캐릭터 정보가 없습니다.' })
      await deleteRows(
        `defeat_characters?id=eq.${encodeURIComponent(payload.characterId)}&subscriber_id=eq.${subscriber.id}`,
      )
    } else if (payload.action === 'delete-account') {
      await deleteRows(`defeat_subscribers?id=eq.${subscriber.id}`)
      return json(200, { deleted: true })
    } else {
      return json(400, { error: '알 수 없는 작업입니다.' })
    }

    return json(200, await getManageState(subscriber))
  } catch (error) {
    console.error('[defeat-manage]', error)
    return json(500, { error: '알림 설정을 처리하지 못했습니다.' })
  }
}
