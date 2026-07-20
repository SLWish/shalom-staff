import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildReport,
  formatScoreBreakdown,
  getNextCheckpointTime,
  getNextHourStartTime,
  getSeasonFileName,
  isCrystalSkipDelta,
  isSeasonScoreReset,
  parseRecorderText,
  predictNextSeason,
  summarizeScoreDeltas,
} from './wph-recorder.mjs'

test('score deltas are expressed as base jumps and two extra groups', () => {
  const deltas = [6, 7, 6, 30, 6, 20]
  const summary = summarizeScoreDeltas(deltas)

  assert.deepEqual(summary, {
    autoExtra: 1,
    baseCount: 6,
    baseJump: 6,
    crystalExtra: 38,
    total: 75,
  })
  assert.equal(formatScoreBreakdown(deltas), '6x6+38+1')
})

test('a noisy low delta does not replace the frequent base jump', () => {
  const deltas = [3, ...Array(20).fill(6), ...Array(25).fill(7)]
  assert.equal(summarizeScoreDeltas(deltas).baseJump, 6)
})

test('low horn jumps are supported', () => {
  assert.equal(formatScoreBreakdown([2, 2, 3, 2]), '4x2+1')
})

test('crystal jumps and simultaneous one or two bonus jumps are separated', () => {
  const summary = summarizeScoreDeltas([6, 30, 31, 32])

  assert.deepEqual(summary, {
    autoExtra: 3,
    baseCount: 4,
    baseJump: 6,
    crystalExtra: 72,
    total: 99,
  })
  assert.equal(formatScoreBreakdown([6, 30, 31, 32]), '4x6+72+3')
  assert.equal(isCrystalSkipDelta(30), true)
  assert.equal(isCrystalSkipDelta(32), true)
  assert.equal(isCrystalSkipDelta(8), false)
})

test('season skips and the active 55-minute window are restored from text', () => {
  const text = [
    '04:54:55 | ShaLom/SL_Wish +30 (1,000→1,030)',
    '[1시간 기준] 2026.07.21 04:55:05 | 55분 시작',
    '05:00:05 | ShaLom/SL_Wish +31 (1,030→1,061); ShaLom/SL_Rush +6 (900→906)',
    '05:00:15 | ShaLom/SL_Wish +6 (1,061→1,067)',
  ].join('\r\n')
  const history = parseRecorderText(text)

  assert.equal(history.seasonSkips.get('ShaLom\u0000SL_Wish'), 2)
  assert.deepEqual(history.windowDeltas.get('ShaLom\u0000SL_Wish'), [31, 6])
  assert.equal(new Date(history.windowStartedAt).toISOString(), '2026-07-20T19:55:05.000Z')
})

test('next season starts immediately after the five-day API period', () => {
  const current = {
    endAt: '2026-07-24T14:54:59.000Z',
    key: '2026-07-19_2026-07-24',
    rawEndAt: '2026-07-24T14:59:59.000Z',
    startAt: '2026-07-19T15:00:00.000Z',
    transitionAt: '2026-07-24T14:54:59.000Z',
  }
  const next = predictNextSeason(current)

  assert.equal(next.startAt, '2026-07-24T15:00:00.000Z')
  assert.equal(next.endAt, '2026-07-29T14:54:59.000Z')
  assert.equal(getSeasonFileName(next), '2026.07.25 - 2026.07.29.txt')
})

test('season reset is detected when a meaningful share of scores drops', () => {
  const previous = new Map([
    ['a', 1000],
    ['b', 2000],
    ['c', 3000],
  ])
  const current = new Map([
    ['a', 6],
    ['b', 0],
    ['c', 7],
  ])

  assert.equal(isSeasonScoreReset(previous, current), true)
})

test('hourly WPH checkpoints follow 55, 10, 25, 40, 55', () => {
  const atFivePast = Date.parse('2026-07-20T19:05:00.000Z')
  const justAfterFiftyFive = Date.parse('2026-07-20T19:55:07.000Z')

  assert.equal(new Date(getNextCheckpointTime(atFivePast)).toISOString(), '2026-07-20T19:10:00.000Z')
  assert.equal(new Date(getNextCheckpointTime(justAfterFiftyFive, true)).toISOString(), '2026-07-20T19:55:00.000Z')
  assert.equal(new Date(getNextHourStartTime(atFivePast)).toISOString(), '2026-07-20T19:55:00.000Z')
})

test('hourly report keeps the detailed jump expression for web upload', () => {
  const memberKey = 'ShaLom\u0000SL_Wish'
  const windowState = {
    deltas: new Map([[memberKey, [6, 6, 7, 30]]]),
    startedAt: Date.parse('2026-07-20T19:55:00.000Z'),
    startScores: new Map([[memberKey, 1000]]),
  }
  const report = buildReport(
    windowState,
    new Map([[memberKey, 1049]]),
    Date.parse('2026-07-20T20:55:00.000Z'),
  )

  assert.equal(report.members[0].detail, '4x6+24+1')
  assert.equal(report.members[0].wph, 49)
  assert.match(report.text, /4x6\+24\+1 = 49 WPH/)
})
