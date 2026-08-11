/* global Buffer, process */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { fetchGuildRoster, guildConfigs } from './growCastle.js'

export const ACTIVE_GUILDS = guildConfigs.filter((config) => config.type === 'active').slice(0, 4)
export const DEFEAT_AFTER_MINUTES = 5

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

export function normalizeNickname(value) {
  return String(value || '').trim().normalize('NFKC')
}

export function nicknameKey(value) {
  return normalizeNickname(value).toLocaleLowerCase('en-US')
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export function createToken() {
  return randomBytes(32).toString('base64url')
}

export function isValidEmail(value) {
  const email = normalizeEmail(value)
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function safeSecretEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

export function createAccessSignature(subscriberId, expiresAt) {
  const secret = process.env.DEFEAT_LINK_SECRET
  if (!secret) throw new Error('Missing DEFEAT_LINK_SECRET')
  return createHmac('sha256', secret).update(`${subscriberId}:${expiresAt}`).digest('base64url')
}

export function isValidAccessSignature(subscriberId, expiresAt, signature) {
  try {
    const expiresTime = Number(expiresAt)
    if (!Number.isFinite(expiresTime) || expiresTime <= Date.now()) return false
    return safeSecretEqual(createAccessSignature(subscriberId, expiresAt), signature)
  } catch {
    return false
  }
}

export function json(statusCode, body, headers = {}) {
  return {
    body: JSON.stringify(body),
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
    statusCode,
  }
}

export function getBearerToken(event) {
  return String(event.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim()
}

export function getSiteUrl(event) {
  const configured = process.env.DEFEAT_SITE_URL || process.env.URL
  if (configured) return configured.replace(/\/$/, '')
  const host = event.headers?.['x-forwarded-host'] || event.headers?.host
  const protocol = event.headers?.['x-forwarded-proto'] || 'https'
  return host ? `${protocol}://${host}` : 'http://localhost:8888'
}

export async function findGuildCharacter(nickname) {
  const targetKey = nicknameKey(nickname)
  if (!targetKey) return { matches: [] }

  const settled = await Promise.allSettled(ACTIVE_GUILDS.map((config) => fetchGuildRoster(config)))
  const matches = []
  const failedGuilds = []

  settled.forEach((result, index) => {
    const config = ACTIVE_GUILDS[index]
    if (result.status === 'rejected') {
      failedGuilds.push(config.guildName)
      return
    }

    result.value.members.forEach((member) => {
      if (nicknameKey(member.nickname) === targetKey) {
        matches.push({ guildName: config.guildName, nickname: member.nickname })
      }
    })
  })

  return { failedGuilds, matches }
}

export function getInactiveMinutes(apiDate, now = Date.now()) {
  if (!apiDate) return null
  const apiTime = new Date(apiDate).getTime()
  if (!Number.isFinite(apiTime)) return null
  return Math.max(0, Math.floor((now - apiTime) / 60000))
}

export function isDefeated(apiDate, now = Date.now()) {
  const minutes = getInactiveMinutes(apiDate, now)
  return minutes !== null && minutes >= DEFEAT_AFTER_MINUTES
}
