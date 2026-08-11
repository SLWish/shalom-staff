import { getDefeatAppUrl, nicknameKey, sha256 } from './_shared/defeatAlerts.js'
import { deleteRows, insertRows, selectRows, updateRows, upsertRows } from './_shared/supabaseRest.js'

function redirect(location) {
  return { body: '', headers: { 'Cache-Control': 'no-store', Location: location }, statusCode: 302 }
}

export async function handler(event) {
  const appUrl = getDefeatAppUrl(event)
  const token = event.queryStringParameters?.token || ''
  const manageToken = event.queryStringParameters?.manage || ''
  if (!token || !manageToken) return redirect(`${appUrl}/?verification=invalid`)

  try {
    const now = new Date().toISOString()
    const [pending] = await selectRows(
      `defeat_pending_registrations?select=*&verification_token_hash=eq.${sha256(token)}&manage_token_hash=eq.${sha256(manageToken)}&expires_at=gt.${encodeURIComponent(now)}&limit=1`,
    )
    if (!pending) return redirect(`${appUrl}/?verification=invalid`)

    const [existing] = await selectRows(
      `defeat_subscribers?select=id&email_hash=eq.${pending.email_hash}&limit=1`,
    )

    let subscriber
    if (existing) {
      const [updated] = await updateRows(`defeat_subscribers?id=eq.${existing.id}`, {
        email: pending.email,
        manage_token_hash: pending.manage_token_hash,
        updated_at: now,
        verified_at: now,
      })
      subscriber = updated
    } else {
      ;[subscriber] = await insertRows('defeat_subscribers', [{
        email: pending.email,
        email_hash: pending.email_hash,
        manage_token_hash: pending.manage_token_hash,
        verified_at: now,
      }])
    }

    await upsertRows('defeat_characters', [{
      alerts_enabled: true,
      guild_name: pending.guild_name,
      nickname: pending.nickname,
      nickname_key: nicknameKey(pending.nickname),
      subscriber_id: subscriber.id,
      updated_at: now,
    }], 'subscriber_id,nickname_key')

    await deleteRows(`defeat_pending_registrations?id=eq.${pending.id}`)
    return redirect(`${appUrl}/manage?token=${encodeURIComponent(manageToken)}&verified=1`)
  } catch (error) {
    console.error('[defeat-verify]', error)
    return redirect(`${appUrl}/?verification=error`)
  }
}
