/* global process */

import { getBearerToken, json, safeSecretEqual } from './_shared/defeatAlerts.js'
import { selectRows } from './_shared/supabaseRest.js'

export async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET 요청만 지원합니다.' })
  const configuredToken = process.env.DEFEAT_ADMIN_TOKEN
  if (!configuredToken) return json(503, { error: '관리자 인증 설정이 필요합니다.' })
  if (!safeSecretEqual(getBearerToken(event), configuredToken)) return json(401, { error: '관리자 인증에 실패했습니다.' })

  try {
    const [characters, subscriptions] = await Promise.all([
      selectRows('defeat_push_characters?select=id,subscription_id,guild_name,nickname,alerts_enabled,is_defeated,last_checked_at,last_notified_at,created_at&order=created_at.desc'),
      selectRows('defeat_push_subscriptions?select=id,alerts_enabled'),
    ])
    const subscriptionState = new Map(subscriptions.map((subscription) => [subscription.id, subscription.alerts_enabled]))

    return json(200, {
      characters: characters.map((character) => ({
        accountAlertsEnabled: subscriptionState.get(character.subscription_id) !== false,
        alertsEnabled: character.alerts_enabled,
        createdAt: character.created_at,
        guildName: character.guild_name,
        id: character.id,
        isDefeated: character.is_defeated,
        lastCheckedAt: character.last_checked_at,
        lastNotifiedAt: character.last_notified_at,
        nickname: character.nickname,
      })),
    })
  } catch (error) {
    console.error('[defeat-admin]', error)
    return json(500, { error: '등록 현황을 불러오지 못했습니다.' })
  }
}
