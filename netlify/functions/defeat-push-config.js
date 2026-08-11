import { assertVapidConfigured } from './_shared/defeatPush.js'
import { json } from './_shared/defeatAlerts.js'

export async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET 요청만 지원합니다.' })

  try {
    return json(200, { publicKey: assertVapidConfigured() })
  } catch (error) {
    console.error('[defeat-push-config]', error)
    return json(503, { error: '푸시 알림 설정이 아직 완료되지 않았습니다.' })
  }
}
