import assert from 'node:assert/strict'
import test from 'node:test'

import { buildDepartureEventRows } from '../netlify/functions/collect-on-roster-change.js'
import { dedupeDepartures, getCurrentSeasonKeys, normalizeDepartureEvents } from '../netlify/functions/history.js'

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

test('departure history is limited to the current season keys', () => {
  assert.deepEqual(
    getCurrentSeasonKeys([
      { season_key: '2026-09-01_2026-09-06' },
      { season_key: '2026-09-01_2026-09-06' },
      { season_key: 'unknown-start_unknown-end' },
    ]),
    ['2026-09-01_2026-09-06'],
  )
})

test('a member moving between guilds 1 through 6 is not a departure', () => {
  const departures = [{
    departedAt: '2026-09-02T03:04:05.000Z',
    guildName: 'ShaLom2',
    nickname: 'SL_Move',
    score: 12345,
  }]

  assert.deepEqual(dedupeDepartures(departures, {
    ShaLom: new Set(),
    ShaLom2: new Set(),
    ShaLom3: new Set(['SL_Move']),
    ShaLom4: new Set(),
    ShaLom5: new Set(),
    ShaLom6: new Set(),
  }), [])
})

test('only the latest final guild is shown after leaving all six guilds', () => {
  const departures = [
    { departedAt: '2026-09-02T03:00:00.000Z', guildName: 'ShaLom2', nickname: 'SL_Leave', score: 10000 },
    { departedAt: '2026-09-02T04:00:00.000Z', guildName: 'ShaLom3', nickname: 'SL_Leave', score: 15000 },
  ]

  assert.deepEqual(dedupeDepartures(departures, {
    ShaLom: new Set(),
    ShaLom2: new Set(),
    ShaLom3: new Set(),
    ShaLom4: new Set(),
    ShaLom5: new Set(),
    ShaLom6: new Set(),
  }), [departures[1]])
})
