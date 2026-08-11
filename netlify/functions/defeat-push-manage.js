import {
  findGuildCharacter,
  getBearerToken,
  json,
  nicknameKey,
  normalizeNickname,
  sha256,
} from './_shared/defeatAlerts.js'
import { deleteRows, insertRows, selectRows, updateRows } from './_shared/supabaseRest.js'

async function getDevice(event) {
  const token = getBearerToken(event)
  if (!token) return null
  const [device] = await selectRows(
    `defeat_push_subscriptions?select=id,alerts_enabled,created_at&manage_token_hash=eq.${sha256(token)}&limit=1`,
  )
  return device || null
}

async function getManageState(device) {
  const characters = await selectRows(
    `defeat_push_characters?select=id,guild_name,nickname,alerts_enabled,last_wave,last_api_date,last_checked_at,is_defeated,defeated_at,last_notified_at,created_at&subscription_id=eq.${device.id}&order=created_at.asc`,
  )
  return {
    alertsEnabled: device.alerts_enabled,
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
    const device = await getDevice(event)
    if (!device) return json(401, { error: '이 기기의 알림 관리 정보가 유효하지 않습니다.' })

    if (event.httpMethod === 'GET') return json(200, await getManageState(device))
    if (event.httpMethod !== 'POST') return json(405, { error: '지원하지 않는 요청입니다.' })

    let payload
    try {
      payload = JSON.parse(event.body || '{}')
    } catch {
      return json(400, { error: '요청 형식이 올바르지 않습니다.' })
    }

    const now = new Date().toISOString()
    if (payload.action === 'toggle-device') {
      await updateRows(`defeat_push_subscriptions?id=eq.${device.id}`, {
        alerts_enabled: Boolean(payload.enabled),
        updated_at: now,
      })
      device.alerts_enabled = Boolean(payload.enabled)
    } else if (payload.action === 'add-character') {
      const nickname = normalizeNickname(payload.nickname)
      if (!nickname || nickname.length > 40) return json(400, { error: '올바른 닉네임을 입력해주세요.' })
      const { failedGuilds, matches } = await findGuildCharacter(nickname)
      if (matches.length === 0 && failedGuilds.length > 0) {
        return json(503, { error: '게임 API가 불안정해 닉네임을 확인하지 못했습니다.' })
      }
      if (matches.length === 0) return json(404, { error: 'ShaLom 1~4군에서 해당 닉네임을 찾지 못했습니다.' })
      if (matches.length > 1) return json(409, { error: '같은 닉네임이 여러 군에 있어 자동으로 확인할 수 없습니다.' })

      const characters = await selectRows(
        `defeat_push_characters?select=id,nickname_key&subscription_id=eq.${device.id}`,
      )
      const matchedKey = nicknameKey(matches[0].nickname)
      if (characters.some((character) => character.nickname_key === matchedKey)) {
        return json(409, { error: '이미 등록된 캐릭터입니다.' })
      }
      if (characters.length >= 10) return json(409, { error: '한 기기에는 캐릭터를 10개까지 등록할 수 있습니다.' })

      await insertRows('defeat_push_characters', [{
        guild_name: matches[0].guildName,
        nickname: matches[0].nickname,
        nickname_key: matchedKey,
        subscription_id: device.id,
      }])
    } else if (payload.action === 'toggle-character') {
      if (!payload.characterId) return json(400, { error: '캐릭터 정보가 없습니다.' })
      await updateRows(
        `defeat_push_characters?id=eq.${encodeURIComponent(payload.characterId)}&subscription_id=eq.${device.id}`,
        { alerts_enabled: Boolean(payload.enabled), updated_at: now },
      )
    } else if (payload.action === 'delete-character') {
      if (!payload.characterId) return json(400, { error: '캐릭터 정보가 없습니다.' })
      await deleteRows(
        `defeat_push_characters?id=eq.${encodeURIComponent(payload.characterId)}&subscription_id=eq.${device.id}`,
      )
    } else if (payload.action === 'delete-device') {
      await deleteRows(`defeat_push_subscriptions?id=eq.${device.id}`)
      return json(200, { deleted: true })
    } else {
      return json(400, { error: '알 수 없는 작업입니다.' })
    }

    return json(200, await getManageState(device))
  } catch (error) {
    console.error('[defeat-push-manage]', error)
    return json(500, { error: '푸시 알림 설정을 처리하지 못했습니다.' })
  }
}
