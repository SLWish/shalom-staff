import assert from 'node:assert/strict'
import test from 'node:test'

import { getNewMemberCandidates } from '../netlify/functions/history.js'
import { isNewMemberForDisplay, mergeMembersWithHistory } from '../src/services/scoreHistory.js'

test('members absent from the season baseline are new member candidates', () => {
  const current = [{ nickname: 'SL_Wish' }, { nickname: 'SL_Kelly' }]
  const baseline = [{ nickname: 'SL_Wish' }]

  assert.deepEqual(getNewMemberCandidates(current, baseline), [{ nickname: 'SL_Kelly' }])
})

test('server join records mark members as new across browsers', () => {
  const [member] = mergeMembersWithHistory(
    [{ nickname: 'SL_Kelly', score: 48 }],
    {},
    40000,
    [{ nickname: 'SL_Kelly', joinedAt: '2026-07-20T10:06:21.886Z' }],
  )

  assert.equal(member.history.isNewDuringSeason, true)
  assert.equal(member.history.firstSeenAt, '2026-07-20T10:06:21.886Z')
})

test('a first-day join is displayed even before its cut score is prorated', () => {
  const [member] = mergeMembersWithHistory(
    [{ nickname: 'SL_Kelly', score: 48 }],
    {},
    40000,
    [{ nickname: 'SL_Kelly', joinedAt: '2026-07-20T10:06:21.886Z' }],
  )

  assert.equal(isNewMemberForDisplay({ ...member, isProratedCut: false }), true)
})
