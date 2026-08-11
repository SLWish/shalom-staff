import {
  createToken,
  findGuildCharacter,
  json,
  nicknameKey,
  normalizeNickname,
  sha256,
} from './_shared/defeatAlerts.js'
import { normalizePushSubscription } from './_shared/defeatPush.js'
import { insertRows, selectRows, updateRows } from './_shared/supabaseRest.js'

const MAX_CHARACTERS_PER_DEVICE = 10

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST 요청만 지원합니다.' })

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: '요청 형식이 올바르지 않습니다.' })
  }

  const nickname = normalizeNickname(payload.nickname)
  const pushSubscription = normalizePushSubscription(payload.subscription)
  if (!nickname || nickname.length > 40) return json(400, { error: '올바른 닉네임을 입력해주세요.' })
  if (!pushSubscription) return json(400, { error: '이 기기의 푸시 구독 정보가 올바르지 않습니다.' })

  try {
    const { failedGuilds, matches } = await findGuildCharacter(nickname)
    if (matches.length === 0 && failedGuilds.length > 0) {
      return json(503, { error: '게임 API가 불안정해 닉네임을 확인하지 못했습니다.' })
    }
    if (matches.length === 0) return json(404, { error: 'ShaLom 1~4군에서 해당 닉네임을 찾지 못했습니다.' })
    if (matches.length > 1) return json(409, { error: '같은 닉네임이 여러 군에 있어 자동으로 확인할 수 없습니다.' })

    const now = new Date().toISOString()
    const endpointHash = sha256(pushSubscription.endpoint)
    const [existingDevice] = await selectRows(
      `defeat_push_subscriptions?select=id,manage_token_hash&endpoint_hash=eq.${endpointHash}&limit=1`,
    )
    const suppliedToken = String(payload.manageToken || '')
    const canReuseToken = existingDevice && suppliedToken && sha256(suppliedToken) === existingDevice.manage_token_hash
    const manageToken = canReuseToken ? suppliedToken : createToken()
    let deviceId = existingDevice?.id

    const deviceValues = {
      alerts_enabled: true,
      auth_key: pushSubscription.auth,
      endpoint: pushSubscription.endpoint,
      endpoint_hash: endpointHash,
      expiration_time: pushSubscription.expirationTime,
      manage_token_hash: sha256(manageToken),
      p256dh_key: pushSubscription.p256dh,
      updated_at: now,
    }

    if (deviceId) {
      await updateRows(`defeat_push_subscriptions?id=eq.${deviceId}`, deviceValues)
    } else {
      const [createdDevice] = await insertRows('defeat_push_subscriptions', [deviceValues])
      deviceId = createdDevice.id
    }

    const characters = await selectRows(
      `defeat_push_characters?select=id,nickname_key&subscription_id=eq.${deviceId}`,
    )
    const [match] = matches
    const matchedKey = nicknameKey(match.nickname)
    if (!characters.some((character) => character.nickname_key === matchedKey)) {
      if (characters.length >= MAX_CHARACTERS_PER_DEVICE) {
        return json(409, { error: `한 기기에는 캐릭터를 ${MAX_CHARACTERS_PER_DEVICE}개까지 등록할 수 있습니다.` })
      }
      await insertRows('defeat_push_characters', [{
        guild_name: match.guildName,
        nickname: match.nickname,
        nickname_key: matchedKey,
        subscription_id: deviceId,
      }])
    }

    return json(200, {
      manageToken,
      message: `${match.nickname} 푸시 알림을 등록했습니다.`,
    })
  } catch (error) {
    console.error('[defeat-push-subscribe]', error)
    return json(500, { error: '푸시 알림을 등록하지 못했습니다.' })
  }
}
