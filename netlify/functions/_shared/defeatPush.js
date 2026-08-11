/* global process */

import webpush from 'web-push'

let configuredKey = ''

export function getVapidPublicKey() {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim()
  if (!publicKey) throw new Error('Missing VAPID_PUBLIC_KEY')
  return publicKey
}

export function assertVapidConfigured() {
  const publicKey = getVapidPublicKey()
  if (!String(process.env.VAPID_PRIVATE_KEY || '').trim()) throw new Error('Missing VAPID_PRIVATE_KEY')
  return publicKey
}

function configureWebPush() {
  const publicKey = assertVapidConfigured()
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim()
  const subject = String(process.env.VAPID_SUBJECT || 'mailto:shalomwaveops@gmail.com').trim()
  const keyPair = `${publicKey}:${privateKey}:${subject}`
  if (configuredKey !== keyPair) {
    webpush.setVapidDetails(subject, publicKey, privateKey)
    configuredKey = keyPair
  }
}

export function normalizePushSubscription(value) {
  const endpoint = String(value?.endpoint || '').trim()
  const auth = String(value?.keys?.auth || '').trim()
  const p256dh = String(value?.keys?.p256dh || '').trim()
  const expirationTime = value?.expirationTime == null ? null : Number(value.expirationTime)

  if (!endpoint.startsWith('https://') || endpoint.length > 4096 || !auth || !p256dh) return null
  if (auth.length > 512 || p256dh.length > 512) return null

  return {
    auth,
    endpoint,
    expirationTime: Number.isFinite(expirationTime) ? expirationTime : null,
    p256dh,
  }
}

export async function sendDefeatPush(subscription, payload) {
  configureWebPush()
  return webpush.sendNotification({
    endpoint: subscription.endpoint,
    expirationTime: subscription.expiration_time,
    keys: {
      auth: subscription.auth_key,
      p256dh: subscription.p256dh_key,
    },
  }, JSON.stringify(payload), {
    TTL: 60 * 60,
    urgency: 'high',
  })
}

export function isExpiredPushError(error) {
  return error?.statusCode === 404 || error?.statusCode === 410
}
