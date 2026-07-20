import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeLocalWph } from './wph-report.js'

test('local 10-second report replaces the matching server hour and detail', () => {
  const slotAt = '2026-07-20T20:55:00.000Z'
  const report = {
    guildName: 'ShaLom',
    members: [
      {
        averageWph: 1000,
        detailHourly: ['1000'],
        hourly: [1000],
        hourlySlots: [slotAt],
        nickname: 'SL_Wish',
      },
    ],
  }
  const localRows = [
    {
      captured_at: slotAt,
      raw_json: {
        detail: '172x6+264+102',
        guildName: 'ShaLom',
        nickname: 'SL_Wish',
        wph: 1398,
      },
      score: 1398,
    },
  ]

  const merged = mergeLocalWph(report, localRows)
  assert.deepEqual(merged.members[0].hourly, [1398])
  assert.deepEqual(merged.members[0].detailHourly, ['172x6+264+102'])
  assert.equal(merged.members[0].averageWph, 1398)
})
