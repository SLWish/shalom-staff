import { sendVerificationEmail } from './_shared/defeatEmail.js'
import {
  createToken,
  findGuildCharacter,
  getDefeatServiceUrl,
  isValidEmail,
  json,
  nicknameKey,
  normalizeEmail,
  normalizeNickname,
  sha256,
} from './_shared/defeatAlerts.js'
import { deleteRows, insertRows, selectRows } from './_shared/supabaseRest.js'

const VERIFICATION_MINUTES = 30
const RESEND_COOLDOWN_MINUTES = 2

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST 요청만 지원합니다.' })

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: '요청 형식이 올바르지 않습니다.' })
  }

  const email = normalizeEmail(payload.email)
  const nickname = normalizeNickname(payload.nickname)
  if (!isValidEmail(email)) return json(400, { error: '올바른 이메일 주소를 입력해주세요.' })
  if (!nickname || nickname.length > 40) return json(400, { error: '올바른 인게임 닉네임을 입력해주세요.' })

  try {
    const emailHash = sha256(email)
    const cooldownSince = new Date(Date.now() - RESEND_COOLDOWN_MINUTES * 60000).toISOString()
    const recent = await selectRows(
      `defeat_pending_registrations?select=id&email_hash=eq.${emailHash}&created_at=gte.${encodeURIComponent(cooldownSince)}&limit=1`,
    )
    if (recent.length > 0) {
      return json(429, { error: '확인 메일을 이미 보냈습니다. 잠시 후 다시 시도해주세요.' })
    }

    const { failedGuilds, matches } = await findGuildCharacter(nickname)
    if (matches.length === 0 && failedGuilds.length > 0) {
      return json(503, { error: '게임 API가 불안정해 닉네임을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' })
    }
    if (matches.length === 0) return json(404, { error: 'ShaLom 1~4군에서 해당 닉네임을 찾지 못했습니다.' })
    if (matches.length > 1) return json(409, { error: '같은 닉네임이 여러 군에 있어 자동으로 확인할 수 없습니다.' })

    const verificationToken = createToken()
    const manageToken = createToken()
    const [match] = matches
    const [pending] = await insertRows('defeat_pending_registrations', [{
      email,
      email_hash: emailHash,
      expires_at: new Date(Date.now() + VERIFICATION_MINUTES * 60000).toISOString(),
      guild_name: match.guildName,
      manage_token_hash: sha256(manageToken),
      nickname: match.nickname,
      nickname_key: nicknameKey(match.nickname),
      verification_token_hash: sha256(verificationToken),
    }])

    const serviceUrl = getDefeatServiceUrl(event)
    const verificationUrl = `${serviceUrl}/.netlify/functions/defeat-verify?token=${encodeURIComponent(verificationToken)}&manage=${encodeURIComponent(manageToken)}`

    try {
      await sendVerificationEmail({
        email,
        guildName: match.guildName,
        nickname: match.nickname,
        verificationUrl,
      })
    } catch (error) {
      if (pending?.id) await deleteRows(`defeat_pending_registrations?id=eq.${pending.id}`)
      throw error
    }

    return json(202, { message: '이메일로 등록 확인 링크를 보냈습니다.' })
  } catch (error) {
    console.error('[defeat-subscribe]', error)
    const isMailConfigError = String(error.message || '').startsWith('Missing GMAIL_')
    return json(isMailConfigError ? 503 : 500, {
      error: isMailConfigError ? '메일 발송 설정이 아직 완료되지 않았습니다.' : '등록 처리 중 오류가 발생했습니다.',
    })
  }
}
