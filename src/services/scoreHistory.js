const KEY_PREFIX = 'shalomInfo_scoreHistory_'
const MAX_RECORD_AGE_MS = 2 * 60 * 60 * 1000

function getHistoryKey(guildName) {
  return `${KEY_PREFIX}${guildName}`
}

function nowIso() {
  return new Date().toISOString()
}

function toTime(value) {
  const text = String(value || '')
  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
  const normalized = text.includes('T') && !hasExplicitTimezone ? `${text}Z` : value
  const time = new Date(normalized).getTime()
  return Number.isFinite(time) ? time : null
}

function isValidScoreRecord(record) {
  if (!record) return false
  const score = Number(record.score)
  const checkedTime = toTime(record.checkedAt)
  return Number.isFinite(score) && checkedTime !== null
}

function normalizeRecords(record) {
  if (Array.isArray(record?.records)) return record.records.filter(isValidScoreRecord)
  if (typeof record?.currentScore === 'number' && record?.lastCheckedAt) {
    return [
      {
        checkedAt: record.lastCheckedAt,
        score: record.currentScore,
      },
    ].filter(isValidScoreRecord)
  }
  return []
}

function getValidRecords(records) {
  return records
    .map((record) => ({
      ...record,
      score: Number(record.score),
      time: toTime(record.checkedAt),
    }))
    .filter((record) => Number.isFinite(record.score) && record.time !== null)
    .sort((a, b) => a.time - b.time)
}

function calculateRate(records, windowMs, minimumSpanMs) {
  const now = Date.now()
  const validRecords = getValidRecords(records).filter((record) => now - record.time <= windowMs)

  if (validRecords.length < 2) return null

  const first = validRecords[0]
  const last = validRecords[validRecords.length - 1]
  const timeDeltaHours = (last.time - first.time) / 36e5
  const scoreDelta = last.score - first.score

  if (timeDeltaHours <= 0 || timeDeltaHours * 36e5 < minimumSpanMs || scoreDelta < 0) return null

  return {
    basis: windowMs >= 60 * 60 * 1000 ? '최근 1시간 평균 기준' : '최근 15분 기준',
    previousScore: first.score,
    scoreDelta,
    scorePerHour: scoreDelta / timeDeltaHours,
    timeDeltaHours,
  }
}

function calculateRecentPairRate(records) {
  const validRecords = getValidRecords(records)

  if (validRecords.length < 2) return null

  const previous = validRecords[validRecords.length - 2]
  const current = validRecords[validRecords.length - 1]
  const timeDeltaHours = (current.time - previous.time) / 36e5
  const scoreDelta = current.score - previous.score

  if (timeDeltaHours <= 0 || scoreDelta < 0) return null

  return {
    basis: scoreDelta === 0 ? '점수 증가 없음' : '최근 2회 체크 기준',
    previousScore: previous.score,
    scoreDelta,
    scorePerHour: scoreDelta / timeDeltaHours,
    timeDeltaHours,
  }
}

function getPrediction(records, currentScore, seasonEndAt, checkedAt) {
  const seasonEndTime = toTime(seasonEndAt)
  const checkedTime = toTime(checkedAt)
  const validRecords = getValidRecords(records)

  if (seasonEndTime === null || checkedTime === null) {
    return {
      basis: '시즌 종료 시간 확인 불가',
      previousScore: validRecords.at(-2)?.score ?? null,
      projectedFinalScore: null,
      remainingHours: null,
      scoreDelta: null,
      scorePerHour: null,
      timeDeltaHours: null,
    }
  }

  const remainingHours = Math.max(0, (seasonEndTime - checkedTime) / 36e5)
  const rate =
    calculateRate(validRecords, 60 * 60 * 1000, 15 * 60 * 1000) ||
    calculateRate(validRecords, 15 * 60 * 1000, 3 * 60 * 1000) ||
    calculateRecentPairRate(validRecords)

  if (!rate) {
    return {
      basis: validRecords.length < 2 ? '기록 부족' : '예측 불가',
      previousScore: validRecords.at(-2)?.score ?? null,
      projectedFinalScore: null,
      remainingHours,
      scoreDelta: null,
      scorePerHour: null,
      timeDeltaHours: null,
    }
  }

  return {
    ...rate,
    projectedFinalScore: Math.round(Number(currentScore) + rate.scorePerHour * remainingHours),
    remainingHours,
  }
}

export function readScoreHistory(guildName) {
  if (typeof window === 'undefined') return {}

  try {
    return JSON.parse(window.localStorage.getItem(getHistoryKey(guildName)) || '{}')
  } catch {
    return {}
  }
}

export function writeScoreHistory(guildName, history) {
  window.localStorage.setItem(getHistoryKey(guildName), JSON.stringify(history))
}

export function clearScoreHistory(guildName) {
  window.localStorage.removeItem(getHistoryKey(guildName))
}

export function clearAllScoreHistory(guildNames) {
  guildNames.forEach((guildName) => clearScoreHistory(guildName))
}

export function compareAndSaveScoreHistory(guildName, members, options = {}) {
  const previousHistory = readScoreHistory(guildName)
  const checkedAt = options.checkedAt || nowIso()
  const checkedTime = toTime(checkedAt) || Date.now()
  const seasonEndAt = options.seasonEndAt || null
  const playerRecords = options.playerRecords || {}
  const hasExistingHistory = Object.keys(previousHistory).length > 0
  const nextHistory = {}

  members.forEach((member) => {
    const previous = previousHistory[member.nickname]
    const previousRecords = normalizeRecords(previous)
    const previousScore = getValidRecords(previousRecords).at(-1)?.score
    const playerRecord = playerRecords[member.nickname] || {}
    const currentRecord = {
      apiDate: playerRecord.apiDate || null,
      checkedAt,
      guildName,
      nickname: member.nickname,
      score: Number(member.score),
      seasonEndAt,
      wave: typeof playerRecord.wave === 'number' ? playerRecord.wave : null,
    }
    const records = [...previousRecords, currentRecord].filter((record) => {
      const recordTime = toTime(record.checkedAt)
      return isValidScoreRecord(record) && recordTime !== null && checkedTime - recordTime <= MAX_RECORD_AGE_MS
    })
    const isNewDuringSeason = Boolean(previous?.isNewDuringSeason) || (!previous && hasExistingHistory)
    const firstSeenAt = isNewDuringSeason ? previous?.firstSeenAt || checkedAt : null
    const scoreDelta = typeof previousScore === 'number' ? Number(member.score) - previousScore : null
    const stagnantCount =
      scoreDelta === 0 && previous?.stagnantCount ? previous.stagnantCount + 1 : scoreDelta === 0 ? 1 : 0
    const prediction = getPrediction(records, Number(member.score), seasonEndAt, checkedAt)

    nextHistory[member.nickname] = {
      currentScore: Number(member.score),
      firstSeenAt,
      increasedBy: scoreDelta ?? 0,
      isNewDuringSeason,
      lastCheckedAt: checkedAt,
      lastIncreasedAt: scoreDelta > 0 ? checkedAt : previous?.lastIncreasedAt || null,
      nickname: member.nickname,
      prediction,
      previousScore: typeof previousScore === 'number' ? previousScore : Number(member.score),
      records,
      stagnantCount,
      status:
        scoreDelta === null
          ? '신규 데이터'
          : scoreDelta > 0
            ? '증가'
            : scoreDelta === 0
              ? '점수 정체'
              : '점수 감소 감지',
    }
  })

  writeScoreHistory(guildName, nextHistory)
  return nextHistory
}

export function mergeMembersWithHistory(members, history, cutScore) {
  return members.map((member) => {
    const record = history[member.nickname]
    const stagnantCount = record?.stagnantCount || 0
    const isBelowCut = member.score < cutScore
    const status = isBelowCut && stagnantCount >= 3 ? 'Defeat 의심' : record?.status || '신규 데이터'

    return {
      ...member,
      history: {
        firstSeenAt: record?.firstSeenAt || null,
        increasedBy: record?.increasedBy ?? 0,
        isNewDuringSeason: Boolean(record?.isNewDuringSeason),
        lastCheckedAt: record?.lastCheckedAt || null,
        lastIncreasedAt: record?.lastIncreasedAt || null,
        prediction: record?.prediction || null,
        previousScore: record?.previousScore ?? member.score,
        records: normalizeRecords(record),
        stagnantCount,
        status,
      },
    }
  })
}
