import {
  createToken,
  getDefeatAppUrl,
  isValidAccessSignature,
  sha256,
} from './_shared/defeatAlerts.js'
import { selectRows, updateRows } from './_shared/supabaseRest.js'

function redirect(location) {
  return { body: '', headers: { 'Cache-Control': 'no-store', Location: location }, statusCode: 302 }
}

export async function handler(event) {
  const appUrl = getDefeatAppUrl(event)
  const subscriberId = event.queryStringParameters?.subscriber || ''
  const expiresAt = event.queryStringParameters?.expires || ''
  const signature = event.queryStringParameters?.signature || ''
  if (!isValidAccessSignature(subscriberId, expiresAt, signature)) {
    return redirect(`${appUrl}/?access=invalid`)
  }

  try {
    const [subscriber] = await selectRows(`defeat_subscribers?select=id&id=eq.${encodeURIComponent(subscriberId)}&limit=1`)
    if (!subscriber) return redirect(`${appUrl}/?access=invalid`)

    const manageToken = createToken()
    await updateRows(`defeat_subscribers?id=eq.${subscriber.id}`, {
      manage_token_hash: sha256(manageToken),
      updated_at: new Date().toISOString(),
    })
    return redirect(`${appUrl}/manage?token=${encodeURIComponent(manageToken)}`)
  } catch (error) {
    console.error('[defeat-access]', error)
    return redirect(`${appUrl}/?access=error`)
  }
}
