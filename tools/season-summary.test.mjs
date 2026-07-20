import assert from 'node:assert/strict'
import test from 'node:test'

import { buildMemberSummary, getSeasonList, selectRowsPaged } from '../netlify/functions/season-summary.js'

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

test('partial activity does not lower the passive WPH baseline', () => {
  const deltas = [0, 150, 1140, 1146, 1152, 1140, 1200]
  let wave = 10000
  const rows = [{ slotAt: '2026-07-14T15:55:00.000Z', slotTime: 0, wave }]
  deltas.forEach((delta, index) => {
    wave += delta
    rows.push({
      slotAt: new Date(Date.parse('2026-07-14T15:55:00.000Z') + (index + 1) * 36e5).toISOString(),
      slotTime: (index + 1) * 36e5,
      wave,
    })
  })

  const summary = buildMemberSummary('SL_Wish', rows, ['2026-07-15'])

  assert.equal(summary.averageWph, 1145)
  assert.equal(summary.passiveHours, 4)
  assert.equal(summary.skipHours, 1)
  assert.equal(summary.downHours, 1)
  assert.equal(summary.belowPassiveHours, 1)
})
