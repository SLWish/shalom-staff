import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAccessSignature,
  getInactiveMinutes,
  isDefeated,
  isValidAccessSignature,
  isValidEmail,
  nicknameKey,
  normalizeEmail,
} from '../netlify/functions/_shared/defeatAlerts.js'

test('normalizes subscriber identifiers', () => {
  assert.equal(normalizeEmail('  USER@Gmail.com '), 'user@gmail.com')
  assert.equal(nicknameKey('  SL_Wish '), 'sl_wish')
})

test('validates email addresses conservatively', () => {
  assert.equal(isValidEmail('member@gmail.com'), true)
  assert.equal(isValidEmail('not-an-email'), false)
})

test('marks a player defeated after five stopped minutes', () => {
  const now = Date.parse('2026-08-12T00:10:00.000Z')
  assert.equal(getInactiveMinutes('2026-08-12T00:05:01.000Z', now), 4)
  assert.equal(isDefeated('2026-08-12T00:05:01.000Z', now), false)
  assert.equal(getInactiveMinutes('2026-08-12T00:05:00.000Z', now), 5)
  assert.equal(isDefeated('2026-08-12T00:05:00.000Z', now), true)
})

test('signs email management access without exposing the manage token', () => {
  process.env.DEFEAT_LINK_SECRET = 'test-only-secret'
  const expiresAt = Date.now() + 60000
  const signature = createAccessSignature('subscriber-id', expiresAt)
  assert.equal(isValidAccessSignature('subscriber-id', expiresAt, signature), true)
  assert.equal(isValidAccessSignature('another-id', expiresAt, signature), false)
  assert.equal(isValidAccessSignature('subscriber-id', Date.now() - 1, signature), false)
})
