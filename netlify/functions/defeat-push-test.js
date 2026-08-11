import { getBearerToken, json, sha256 } from './_shared/defeatAlerts.js'
import { isExpiredPushError, sendDefeatPush } from './_shared/defeatPush.js'
import { deleteRows, selectRows } from './_shared/supabaseRest.js'

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST 요청만 지원합니다.' })

  const token = getBearerToken(event)
  if (!token) return json(401, { error: '이 기기의 알림 관리 정보가 없습니다.' })

  try {
    const [subscription] = await selectRows(
      `defeat_push_subscriptions?select=id,endpoint,p256dh_key,auth_key,expiration_time&manage_token_hash=eq.${sha256(token)}&limit=1`,
    )
    if (!subscription) return json(401, { error: '이 기기의 알림 관리 정보가 유효하지 않습니다.' })

    await sendDefeatPush(subscription, {
      body: '이 기기의 웹 푸시 연결이 정상입니다.',
      data: { url: 'https://shalom-defeat.netlify.app' },
      icon: '/favicon.svg',
      tag: `defeat-test-${Date.now()}`,
      title: 'ShaLom 테스트 알림',
    })
    return json(200, { message: '테스트 알림을 보냈습니다.' })
  } catch (error) {
    if (isExpiredPushError(error)) {
      const tokenHash = sha256(token)
      await deleteRows(`defeat_push_subscriptions?manage_token_hash=eq.${tokenHash}`)
      return json(410, { error: '브라우저의 푸시 구독이 만료되었습니다. 다시 등록해주세요.' })
    }
    console.error('[defeat-push-test]', error)
    return json(500, { error: '테스트 알림을 보내지 못했습니다.' })
  }
}
