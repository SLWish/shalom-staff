import assert from 'node:assert/strict'
import test from 'node:test'

import { getSeasonList, selectRowsPaged } from '../netlify/functions/season-summary.js'

test('season list excludes temporary unknown season keys', () => {
  const seasons = getSeasonList([
    { season_key: 'unknown-st_unknown-en' },
    {
      raw_json: {
        seasonEndAt: '2026-07-24T14:54:59.000Z',
        seasonStartAt: '2026-07-19T15:00:00.000Z',
      },
      season_key: '2026-07-19_2026-07-24',
    },
  ])

  assert.equal(seasons.length, 1)
  assert.equal(seasons[0].seasonKey, '2026-07-19_2026-07-24')
})

test('season member rows are loaded past the Supabase 1000-row response cap', async () => {
  const sourceRows = Array.from({ length: 23114 }, (_, id) => ({ id }))
  const selectPage = async (path) => {
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1))
    const offset = Number(query.get('offset'))
    const limit = Number(query.get('limit'))
    return sourceRows.slice(offset, offset + limit)
  }

  const rows = await selectRowsPaged('member_snapshots?select=id', selectPage)

  assert.equal(rows.length, sourceRows.length)
  assert.equal(rows.at(-1).id, 23113)
})
