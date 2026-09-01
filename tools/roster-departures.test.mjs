import assert from 'node:assert/strict'
import test from 'node:test'

import { buildDepartureEventRows } from '../netlify/functions/collect-on-roster-change.js'
import { normalizeDepartureEvents } from '../netlify/functions/history.js'

test('departure events preserve guild, score, and timestamps', () => {
  const capturedAt = '2026-09-02T03:04:05.000Z'
  const rows = buildDepartureEventRows(
    [{
      departedMembers: [{ lastSeenAt: '2026-09-02T03:00:00.000Z', nickname: 'SL_Test', score: 12345 }],
      guildName: 'ShaLom2',
    }],
    capturedAt,
    '2026-09-01_2026-09-06',
  )

  assert.equal(rows.length, 1)
  assert.equal(rows[0].guild_name, '__departure__')
  assert.deepEqual(normalizeDepartureEvents(rows), [{
    departedAt: capturedAt,
    guildName: 'ShaLom2',
    lastSeenAt: '2026-09-02T03:00:00.000Z',
    nickname: 'SL_Test',
    score: 12345,
  }])
})

test('invalid pseudo events are ignored', () => {
  assert.deepEqual(normalizeDepartureEvents([{ nickname: 'SL_Test', raw_json: { event: 'joined' } }]), [])
})
