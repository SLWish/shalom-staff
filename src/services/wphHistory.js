const KEY_PREFIX = 'shalomInfo_wphHistory_'
const CHECKPOINT_MINUTES = [10, 25, 40, 55]

function getHistoryKey(guildName) {
  return `${KEY_PREFIX}${guildName}`
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatCheckpointKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function getCandidateCheckpoints(baseDate) {
  const candidates = []
  const base = new Date(baseDate)

  for (let hourOffset = -3; hourOffset <= 3; hourOffset += 1) {
    for (const minute of CHECKPOINT_MINUTES) {
      const candidate = new Date(base)
      candidate.setHours(base.getHours() + hourOffset, minute, 0, 0)
      candidates.push(candidate)
    }
  }

  return candidates
}

export function getNearestCheckpoint(date = new Date()) {
  const candidates = getCandidateCheckpoints(date)
  const nearest = candidates.reduce((best, candidate) => {
    const currentDistance = Math.abs(candidate.getTime() - date.getTime())
    const bestDistance = Math.abs(best.getTime() - date.getTime())
    return currentDistance < bestDistance ? candidate : best
  }, candidates[0])

  return {
    date: nearest,
    key: formatCheckpointKey(nearest),
  }
}

export function getNextCheckpoint(date = new Date()) {
  const candidates = getCandidateCheckpoints(date)
    .filter((candidate) => candidate.getTime() > date.getTime())
    .sort((a, b) => a.getTime() - b.getTime())

  return {
    date: candidates[0],
    key: formatCheckpointKey(candidates[0]),
  }
}

export function readWphHistory(guildName) {
  if (typeof window === 'undefined') {
    return { checkpoints: {} }
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(getHistoryKey(guildName)) || '{"checkpoints":{}}')
    return {
      checkpoints: parsed.checkpoints || {},
    }
  } catch {
    return { checkpoints: {} }
  }
}

export function writeWphHistory(guildName, history) {
  window.localStorage.setItem(getHistoryKey(guildName), JSON.stringify(history))
}

export function clearWphHistory(guildName) {
  window.localStorage.removeItem(getHistoryKey(guildName))
}

function getPreviousCheckpoint(history, checkpointKey) {
  const keys = Object.keys(history.checkpoints || {})
    .filter((key) => key !== checkpointKey)
    .sort()

  return keys.length > 0 ? history.checkpoints[keys[keys.length - 1]] : null
}

function getStatus(record, previousRecord) {
  if (record.fetchStatus === 'error') {
    return '불러오기 실패'
  }

  if (!record.wave && record.wave !== 0) {
    return '기록 부족'
  }

  if (!previousRecord || (!previousRecord.wave && previousRecord.wave !== 0)) {
    return '계산 대기'
  }

  if (record.wave > previousRecord.wave) {
    return '증가 중'
  }

  if (record.wave === previousRecord.wave) {
    return '정체'
  }

  return '기록 부족'
}

export function saveWphCheckpoint(guildName, checkpointKey, records) {
  const history = readWphHistory(guildName)
  const previousCheckpoint = getPreviousCheckpoint(history, checkpointKey)
  const previousRecords = previousCheckpoint?.records || {}
  const currentRecords = {}

  records.forEach((record) => {
    const previous = previousRecords[record.nickname]
    const waveDelta =
      previous && typeof record.wave === 'number' && typeof previous.wave === 'number'
        ? record.wave - previous.wave
        : null
    const scoreDelta =
      previous && typeof record.score === 'number' && typeof previous.score === 'number'
        ? record.score - previous.score
        : null
    const wph = typeof waveDelta === 'number' && waveDelta >= 0 ? waveDelta * 4 : null

    currentRecords[record.nickname] = {
      ...record,
      checkpointKey,
      scoreDelta,
      waveDelta,
      wph,
      wphStatus: getStatus(record, previous),
    }
  })

  const nextHistory = {
    checkpoints: {
      ...history.checkpoints,
      [checkpointKey]: {
        checkpointKey,
        records: currentRecords,
        savedAt: new Date().toISOString(),
      },
    },
  }

  writeWphHistory(guildName, nextHistory)
  return nextHistory
}

export function getLatestWphRecords(guildName) {
  const history = readWphHistory(guildName)
  const latestKey = Object.keys(history.checkpoints || {}).sort().at(-1)

  if (!latestKey) {
    return {}
  }

  return history.checkpoints[latestKey]?.records || {}
}
