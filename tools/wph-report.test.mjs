import assert from 'node:assert/strict'
import test from 'node:test'

import { estimateWaveDetail, mergeLocalWph } from '../netlify/functions/wph-report.js'

test('local 10-second report replaces the matching server hour and detail', () => {
  const slotAt = '2026-07-20T20:55:00.000Z'
  const report = {
    guildName: 'ShaLom',
    seasonEndAt: '2026-07-24T14:54:59.000Z',
    seasonStartAt: '2026-07-19T15:00:00.000Z',
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
        seasonDownMinutes: 37,
        seasonSkips: 11,
        wph: 1398,
      },
      score: 1398,
      season_key: '2026-07-19_2026-07-24',
    },
  ]

  const merged = mergeLocalWph(report, localRows)
  assert.deepEqual(merged.members[0].hourly, [1398])
  assert.deepEqual(merged.members[0].detailHourly, ['172x6+264+102'])
  assert.equal(merged.members[0].averageWph, 1398)
  assert.equal(merged.members[0].downMinutes, 37)
  assert.equal(merged.members[0].skips, 11)
})

test('an API recovery total uses the member previous base detail as an estimate', () => {
  assert.equal(estimateWaveDetail(837, ['166x5+33', '167x5+33']), '161x5+32 (추정)')
  assert.equal(estimateWaveDetail(1202, ['167x6+120+105', '174x6+104']), '172x6+170 (추정)')
  assert.equal(estimateWaveDetail(1038, ['175x6', '180x6']), '173x6 (추정)')
})

test('recent complete details take priority over older local history', () => {
  const slotAt = '2026-07-22T12:55:00.000Z'
  const report = {
    guildName: 'ShaLom',
    seasonEndAt: '2026-07-24T14:54:59.000Z',
    seasonStartAt: '2026-07-19T15:00:00.000Z',
    members: [{
      detailHourly: ['166x5+33', '167x5+33', '0', '837'],
      hourly: [863, 868, null, 837],
      hourlySlots: [
        '2026-07-22T04:55:00.000Z',
        '2026-07-22T05:55:00.000Z',
        '2026-07-22T06:55:00.000Z',
        slotAt,
      ],
      nickname: 'SL_Limit',
    }],
  }
  const localRows = [{
    captured_at: '2026-07-22T03:55:00.000Z',
    raw_json: { detail: '150x5+80', guildName: 'ShaLom', nickname: 'SL_Limit', wph: 830 },
    score: 830,
    season_key: '2026-07-19_2026-07-24',
  }]

  const merged = mergeLocalWph(report, localRows)
  assert.equal(merged.members[0].detailHourly.at(-1), '161x5+32 (추정)')
})
