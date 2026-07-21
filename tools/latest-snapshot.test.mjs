import assert from 'node:assert/strict'
import test from 'node:test'

import { getLatestGuildRows } from '../netlify/functions/latest-snapshot.js'

test('latest snapshot keeps the newest row for each guild', () => {
  const rows = [
    { captured_at: '2026-07-22T01:00:00.000Z', guild_name: 'ShaLom' },
    { captured_at: '2026-07-22T00:00:00.000Z', guild_name: 'ShaLom' },
    { captured_at: '2026-07-22T01:00:00.000Z', guild_name: 'ShaLom2' },
  ]

  assert.deepEqual(getLatestGuildRows(rows), [rows[0], rows[2]])
})
