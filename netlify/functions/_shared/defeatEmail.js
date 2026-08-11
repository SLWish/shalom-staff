/* global process */

import nodemailer from 'nodemailer'

let transporter

function getTransporter() {
  const user = String(process.env.GMAIL_USER || '').trim()
  const pass = String(process.env.GMAIL_APP_PASSWORD || '').replaceAll(/\s/g, '')
  if (!user || !pass) throw new Error('Missing GMAIL_USER or GMAIL_APP_PASSWORD')

  if (!transporter) {
    transporter = nodemailer.createTransport({
      auth: { pass, user },
      service: 'gmail',
    })
  }

  return { mailer: transporter, user }
}

async function sendWithGmail({ html, subject, text, to }) {
  const { mailer, user } = getTransporter()
  const displayName = String(process.env.DEFEAT_FROM_NAME || 'ShaLom Wave Ops').replaceAll(/[\r\n"]/g, '').trim()
  return mailer.sendMail({
    from: `"${displayName}" <${user}>`,
    html,
    subject,
    text,
    to,
  })
}

export function sendVerificationEmail({ email, guildName, nickname, verificationUrl }) {
  const subject = `[ShaLom] ${nickname} 디핏 알림 등록 확인`
  const text = `${nickname} (${guildName}) 디핏 알림을 등록하려면 다음 링크를 열어주세요.\n\n${verificationUrl}\n\n본인이 요청하지 않았다면 이 메일을 무시하세요.`
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.65;color:#171923"><h2 style="margin:0 0 12px">디핏 알림 등록 확인</h2><p><strong>${escapeHtml(nickname)}</strong> (${escapeHtml(guildName)}) 캐릭터의 알림을 등록합니다.</p><p><a href="${escapeHtml(verificationUrl)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:700">등록 확인하기</a></p><p style="color:#667085;font-size:13px">본인이 요청하지 않았다면 이 메일을 무시하세요. 링크는 30분 동안 유효합니다.</p></div>`
  return sendWithGmail({ html, subject, text, to: email })
}

export function sendDefeatEmail({ email, guildName, inactiveMinutes, manageUrl, nickname }) {
  const subject = `[ShaLom] ${nickname} 디핏 감지`
  const text = `${nickname} (${guildName})의 웨이브 진행이 ${inactiveMinutes}분 이상 멈췄습니다.\n\n알림 관리: ${manageUrl}`
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.65;color:#171923"><h2 style="margin:0 0 12px;color:#d92d20">디핏이 감지됐어요</h2><p><strong>${escapeHtml(nickname)}</strong> (${escapeHtml(guildName)})의 웨이브 진행이 <strong>${inactiveMinutes}분</strong> 이상 멈췄습니다.</p><p><a href="${escapeHtml(manageUrl)}" style="display:inline-block;padding:11px 16px;border-radius:10px;background:#111827;color:#fff;text-decoration:none">알림 설정 관리</a></p><p style="color:#667085;font-size:13px">같은 정지 상태에서는 이 알림을 한 번만 발송합니다.</p></div>`
  return sendWithGmail({ html, subject, text, to: email })
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
