/* global process */

import { fetchGuildSeason } from './_shared/growCastle.js'
import { isExpiredPushError, sendDefeatPush } from './_shared/defeatPush.js'
import {
  ACTIVE_GUILDS,
  getInactiveMinutes,
  isDefeated,
  json,
  nicknameKey,
} from './_shared/defeatAlerts.js'
import { deleteRows, selectRows, updateRows, upsertRows } from './_shared/supabaseRest.js'

function isAuthorized(event) {
  const isScheduled = event.headers?.['x-netlify-event'] === 'schedule'
  const configuredSecret = process.env.COLLECT_SECRET
  const suppliedSecret = String(event.headers?.authorization || '').replace(/^Bearer\s+/i, '')
  return isScheduled || (configuredSecret && suppliedSecret === configuredSecret)
}

function sameInstant(left, right) {
  if (!left || !right) return false
  return new Date(left).getTime() === new Date(right).getTime()
}

async function saveMonitorState({ errorMessage, lastSuccessAt, sourceStatus }, checkedAt) {
  const existing = await selectRows('defeat_monitor_state?select=last_success_at&id=eq.global&limit=1')
  await upsertRows('defeat_monitor_state', [{
    error_message: errorMessage || null,
    id: 'global',
    last_checked_at: checkedAt,
    last_success_at: lastSuccessAt || existing[0]?.last_success_at || null,
    source_status: sourceStatus,
    updated_at: checkedAt,
  }], 'id')
}

async function updatePushSubscriptions(statusRows, event, checkedAt) {
  const [characters, subscriptions] = await Promise.all([
    selectRows('defeat_push_characters?select=*'),
    selectRows('defeat_push_subscriptions?select=id,endpoint,p256dh_key,auth_key,expiration_time,alerts_enabled'),
  ])
  const subscriptionMap = new Map(subscriptions.map((subscription) => [subscription.id, subscription]))
  const statusMap = new Map(statusRows.map((status) => [`${status.guild_name}:${status.nickname_key}`, status]))
  const appUrl = String(process.env.DEFEAT_SITE_URL || 'https://shalom-defeat.netlify.app').replace(/\/$/, '')
  const notifications = []

  for (const character of characters) {
    const status = statusMap.get(`${character.guild_name}:${character.nickname_key}`)
    if (!status || !status.api_date) continue

    const becameDefeated = status.is_defeated && !character.is_defeated
    const values = {
      defeated_at: status.is_defeated ? (becameDefeated ? checkedAt : character.defeated_at) : null,
      guild_name: status.guild_name,
      is_defeated: status.is_defeated,
      last_api_date: status.api_date,
      last_checked_at: checkedAt,
      last_wave: status.wave,
      nickname: status.nickname,
      updated_at: checkedAt,
    }

    const subscription = subscriptionMap.get(character.subscription_id)
    const shouldNotify = Boolean(
      status.is_defeated &&
      character.alerts_enabled &&
      subscription?.alerts_enabled &&
      !sameInstant(character.notified_for_api_date, status.api_date),
    )

    if (shouldNotify) {
      try {
        await sendDefeatPush(subscription, {
          body: `${status.guild_name} · 웨이브 진행이 ${status.inactive_minutes}분 이상 멈췄어요.`,
          data: {
            characterId: character.id,
            url: appUrl,
          },
          icon: '/favicon.svg',
          tag: `defeat-${character.id}-${new Date(status.api_date).getTime()}`,
          title: `디핏 감지 · ${status.nickname}`,
        })
        values.last_notified_at = checkedAt
        values.notified_for_api_date = status.api_date
        notifications.push({ guildName: status.guild_name, nickname: status.nickname })
      } catch (error) {
        if (isExpiredPushError(error) && subscription?.id) {
          await deleteRows(`defeat_push_subscriptions?id=eq.${subscription.id}`)
          continue
        }
        console.error(`[monitor-defeats] push failed for ${character.id}`, error)
      }
    }

    await updateRows(`defeat_push_characters?id=eq.${character.id}`, values)
  }

  return notifications
}

export async function handler(event) {
  if (!isAuthorized(event)) return json(401, { error: 'Unauthorized' })
  if (String(process.env.DEFEAT_MONITOR_ENABLED || '').toLowerCase() === 'false') {
    return json(200, { disabled: true })
  }
  const checkedAt = new Date().toISOString()

  try {
    await deleteRows(`defeat_pending_registrations?expires_at=lt.${encodeURIComponent(checkedAt)}`)
    const settled = await Promise.allSettled(ACTIVE_GUILDS.map((config) => fetchGuildSeason(config)))
    const statusRows = []
    const failedGuilds = []
    let missingPlayerDetails = 0

    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index]
      const config = ACTIVE_GUILDS[index]
      if (result.status === 'rejected') {
        failedGuilds.push(config.guildName)
        continue
      }

      await deleteRows(`defeat_member_status?guild_name=eq.${encodeURIComponent(config.guildName)}`)
      result.value.members.forEach((member) => {
        const inactiveMinutes = getInactiveMinutes(member.apiDate, Date.now())
        if (!member.apiDate) missingPlayerDetails += 1
        statusRows.push({
          api_date: member.apiDate,
          checked_at: checkedAt,
          guild_name: config.guildName,
          inactive_minutes: inactiveMinutes,
          is_defeated: isDefeated(member.apiDate, Date.now()),
          nickname: member.nickname,
          nickname_key: nicknameKey(member.nickname),
          updated_at: checkedAt,
          wave: member.wave,
        })
      })
    }

    if (statusRows.length > 0) {
      await upsertRows('defeat_member_status', statusRows, 'guild_name,nickname_key')
    }

    const sourceStatus = statusRows.length === 0 ? 'down' : failedGuilds.length > 0 || missingPlayerDetails > 0 ? 'partial' : 'ok'
    const errorParts = []
    if (failedGuilds.length > 0) errorParts.push(`길드 조회 실패: ${failedGuilds.join(', ')}`)
    if (missingPlayerDetails > 0) errorParts.push(`플레이어 상세 조회 실패: ${missingPlayerDetails}명`)

    await saveMonitorState({
      errorMessage: errorParts.join(' / '),
      lastSuccessAt: sourceStatus === 'ok' ? checkedAt : null,
      sourceStatus,
    }, checkedAt)

    let notifications = []
    try {
      notifications = await updatePushSubscriptions(statusRows, event, checkedAt)
    } catch (pushError) {
      console.error('[monitor-defeats] push subscriptions unavailable', pushError)
    }
    return json(200, {
      checkedAt,
      failedGuilds,
      monitoredMembers: statusRows.length,
      notifications,
      sourceStatus,
    })
  } catch (error) {
    console.error('[monitor-defeats]', error)
    try {
      await saveMonitorState({ errorMessage: error.message || 'Monitor failed', sourceStatus: 'down' }, checkedAt)
    } catch (stateError) {
      console.error('[monitor-defeats] state update failed', stateError)
    }
    return json(500, { error: '디핏 모니터링에 실패했습니다.' })
  }
}
