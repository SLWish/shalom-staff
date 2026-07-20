import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KST_TIME_ZONE = 'Asia/Seoul'
const DEFAULT_GUILDS = ['ShaLom', 'ShaLom2', 'ShaLom3', 'ShaLom4']
const CHECKPOINT_MINUTES = [10, 25, 40, 55]
const API_BASE_URL = 'https://raongames.com/growcastle/restapi/season/now/guilds'
const POLL_INTERVAL_MS = getPositiveNumber(process.env.WPH_POLL_SECONDS, 10) * 1000
const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000
const SEASON_END_BUFFER_MS = 5 * 60 * 1000
const ONE_SECOND_MS = 1000
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.resolve(process.env.WPH_OUTPUT_DIR || path.join(projectRoot, 'WPH-records'))
const stopRequestPath = path.join(outputDirectory, '.stop-request')
const uploadUrl = process.env.WPH_UPLOAD_URL || 'https://shalom-staff.netlify.app/.netlify/functions/local-wph'
const selectedGuilds = getSelectedGuilds(process.env.WPH_GUILDS)
const runOnce = process.argv.includes('--once')

function getPositiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function getSelectedGuilds(value) {
  if (!value) return DEFAULT_GUILDS
  const names = value.split(',').map((name) => name.trim()).filter(Boolean)
  return names.length > 0 ? [...new Set(names)] : DEFAULT_GUILDS
}

function toTime(value) {
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function normalizeApiDate(value) {
  if (!value) return null
  const text = String(value)
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
  const normalized = text.includes('T') && !hasTimezone ? `${text}Z` : text
  const time = toTime(normalized)
  return time === null ? null : new Date(time).toISOString()
}

function getKstParts(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: KST_TIME_ZONE,
    year: 'numeric',
  }).formatToParts(new Date(value))
  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

export function formatKstDate(value) {
  const parts = getKstParts(value)
  return `${parts.year}.${parts.month}.${parts.day}`
}

export function formatKstTime(value) {
  const parts = getKstParts(value)
  return `${parts.hour}:${parts.minute}:${parts.second}`
}

export function formatKstDateTime(value) {
  return `${formatKstDate(value)} ${formatKstTime(value)}`
}

export function getNextCheckpointTime(referenceTime, includeRecent = false) {
  const shifted = new Date(referenceTime + 9 * 60 * 60 * 1000)
  const minute = shifted.getUTCMinutes()
  const elapsedInMinute = shifted.getUTCSeconds() * 1000 + shifted.getUTCMilliseconds()

  if (includeRecent && CHECKPOINT_MINUTES.includes(minute) && elapsedInMinute <= Math.max(30000, POLL_INTERVAL_MS * 2)) {
    return referenceTime - elapsedInMinute
  }

  const hourStart = referenceTime - minute * 60000 - elapsedInMinute
  const nextMinute = CHECKPOINT_MINUTES.find((checkpointMinute) => checkpointMinute > minute)
  if (nextMinute !== undefined) return hourStart + nextMinute * 60000
  return hourStart + 60 * 60000 + CHECKPOINT_MINUTES[0] * 60000
}

export function getNextHourStartTime(referenceTime, includeRecent = false) {
  let checkpointTime = getNextCheckpointTime(referenceTime, includeRecent)
  while (Number(getKstParts(checkpointTime).minute) !== 55) {
    checkpointTime = getNextCheckpointTime(checkpointTime + ONE_SECOND_MS)
  }
  return checkpointTime
}

function getSeasonKey(startAt, endAt) {
  return `${String(startAt).slice(0, 10)}_${String(endAt).slice(0, 10)}`
}

function createSeasonMeta(startAt, rawEndAt) {
  const startTime = toTime(startAt)
  const rawEndTime = toTime(rawEndAt)
  if (startTime === null || rawEndTime === null) return null

  const endTime = rawEndTime - SEASON_END_BUFFER_MS
  const normalizedStart = new Date(startTime).toISOString()
  const normalizedEnd = new Date(endTime).toISOString()
  return {
    endAt: normalizedEnd,
    key: getSeasonKey(normalizedStart, normalizedEnd),
    rawEndAt: new Date(rawEndTime).toISOString(),
    startAt: normalizedStart,
    transitionAt: normalizedEnd,
  }
}

export function predictNextSeason(meta) {
  const startTime = toTime(meta?.startAt)
  const rawEndTime = toTime(meta?.rawEndAt)
  if (startTime === null || rawEndTime === null) return null

  const cycleMs = rawEndTime + ONE_SECOND_MS - startTime
  const nextStart = new Date(startTime + cycleMs).toISOString()
  const nextRawEnd = new Date(rawEndTime + cycleMs).toISOString()
  return createSeasonMeta(nextStart, nextRawEnd)
}

export function getSeasonFileName(meta) {
  return `${formatKstDate(meta.startAt)} - ${formatKstDate(meta.endAt)}.txt`
}

function getMemberKey(guildName, nickname) {
  return `${guildName}\u0000${nickname}`
}

function splitMemberKey(key) {
  const [guildName, nickname] = key.split('\u0000')
  return { guildName, nickname }
}

export function summarizeScoreDeltas(deltas) {
  const positive = deltas.map(Number).filter((delta) => Number.isFinite(delta) && delta > 0)
  const total = positive.reduce((sum, delta) => sum + delta, 0)
  if (positive.length === 0) return { autoExtra: 0, baseCount: 0, baseJump: null, crystalExtra: 0, total }

  const smallCounts = new Map()
  positive.filter((delta) => delta >= 1 && delta <= 9).forEach((delta) => {
    smallCounts.set(delta, (smallCounts.get(delta) || 0) + 1)
  })

  const minimumUsefulCount = Math.max(2, Math.ceil(positive.length * 0.05))
  const frequentSmall = [...smallCounts.entries()]
    .filter(([, count]) => count >= minimumUsefulCount)
    .sort((a, b) => a[0] - b[0])
  const mostCommonSmall = [...smallCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  const baseJump = frequentSmall[0]?.[0] ?? mostCommonSmall[0]?.[0] ?? null
  if (baseJump === null) return { autoExtra: total, baseCount: 0, baseJump: null, crystalExtra: 0, total }

  let autoExtra = 0
  let baseCount = 0
  let crystalExtra = 0

  positive.forEach((delta) => {
    if (delta < baseJump) {
      autoExtra += delta
      return
    }

    baseCount += 1
    const extra = delta - baseJump
    if (delta >= 10) {
      const crystalJump = [30, 20, 10].find((jump) => delta >= jump && delta - jump <= 2)
      if (crystalJump) {
        crystalExtra += crystalJump - baseJump
        autoExtra += delta - crystalJump
      } else {
        crystalExtra += extra
      }
    } else {
      autoExtra += extra
    }
  })

  return { autoExtra, baseCount, baseJump, crystalExtra, total }
}

export function formatScoreBreakdown(deltas) {
  const detail = summarizeScoreDeltas(deltas)
  if (detail.baseJump === null || detail.baseCount === 0) return String(detail.total)

  const parts = [`${detail.baseCount}x${detail.baseJump}`]
  if (detail.crystalExtra > 0) parts.push(String(detail.crystalExtra))
  if (detail.autoExtra > 0) parts.push(String(detail.autoExtra))
  return parts.join('+')
}

export function isCrystalSkipDelta(delta) {
  const value = Number(delta)
  return [30, 20, 10].some((jump) => value >= jump && value - jump <= 2)
}

function parseKstDateTime(value) {
  const match = String(value).match(/^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!match) return null
  return toTime(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+09:00`)
}

function parseChangeLine(line) {
  const separatorIndex = line.indexOf(' | ')
  if (separatorIndex < 0 || !/^\d{2}:\d{2}:\d{2}$/.test(line.slice(0, separatorIndex))) return []

  return line
    .slice(separatorIndex + 3)
    .split('; ')
    .map((entry) => entry.match(/^([^/]+)\/(.+?) \+([\d,]+) \(/))
    .filter(Boolean)
    .map((match) => ({
      delta: Number(match[3].replaceAll(',', '')),
      key: getMemberKey(match[1], match[2]),
    }))
    .filter((change) => Number.isFinite(change.delta) && change.delta > 0)
}

export function parseRecorderText(text) {
  const seasonSkips = new Map()
  let windowDeltas = new Map()
  let windowStartedAt = null

  String(text).split(/\r?\n/).forEach((line) => {
    const windowMatch = line.match(/^\[1시간 기준\] (\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}) \| 55분 시작$/)
    if (windowMatch) {
      windowStartedAt = parseKstDateTime(windowMatch[1])
      windowDeltas = new Map()
      return
    }

    parseChangeLine(line).forEach(({ delta, key }) => {
      if (isCrystalSkipDelta(delta)) seasonSkips.set(key, (seasonSkips.get(key) || 0) + 1)
      if (windowStartedAt !== null) {
        if (!windowDeltas.has(key)) windowDeltas.set(key, [])
        windowDeltas.get(key).push(delta)
      }
    })
  })

  return { seasonSkips, windowDeltas, windowStartedAt }
}

async function readRecorderHistory(filePath) {
  const text = await readFile(filePath, 'utf8').catch(() => '')
  return parseRecorderText(text)
}

export function isSeasonScoreReset(previousScores, currentScores) {
  let decreased = 0
  let matched = 0

  currentScores.forEach((score, key) => {
    const previous = previousScores.get(key)
    if (!Number.isFinite(previous) || !Number.isFinite(score)) return
    matched += 1
    if (score < previous) decreased += 1
  })

  if (matched === 0) return false
  return decreased >= Math.max(1, Math.ceil(matched * 0.3))
}

async function fetchGuild(guildName) {
  const url = `${API_BASE_URL}/${encodeURIComponent(guildName)}?t=${Date.now()}`
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
  })
  if (!response.ok) throw new Error(`${guildName} API ${response.status}`)

  const payload = await response.json()
  const list = payload?.result?.list
  const date = payload?.result?.date
  if (!Array.isArray(list) || !date?.start || !date?.end) throw new Error(`${guildName} API 형식 확인 실패`)

  return {
    guildName,
    members: list
      .map((member) => ({ nickname: String(member?.name || '').trim(), score: Number(member?.score) }))
      .filter((member) => member.nickname && Number.isFinite(member.score)),
    season: createSeasonMeta(normalizeApiDate(date.start), normalizeApiDate(date.end)),
  }
}

async function fetchGuilds() {
  const settled = await Promise.allSettled(selectedGuilds.map(fetchGuild))
  const guilds = []
  const errors = []

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') guilds.push(result.value)
    else errors.push(`${selectedGuilds[index]}: ${result.reason?.message || '조회 실패'}`)
  })

  if (guilds.length === 0) throw new Error(errors.join(', ') || '모든 길드 API 조회 실패')
  return { errors, guilds }
}

function createScoreMap(guilds) {
  const scores = new Map()
  guilds.forEach((guild) => {
    guild.members.forEach((member) => scores.set(getMemberKey(guild.guildName, member.nickname), member.score))
  })
  return scores
}

function getPrimarySeason(guilds) {
  return guilds.find((guild) => guild.season)?.season || null
}

async function fileExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function appendText(filePath, text) {
  await appendFile(filePath, text, 'utf8')
}

async function ensureSeasonFile(meta, reason) {
  await mkdir(outputDirectory, { recursive: true })
  const filePath = path.join(outputDirectory, getSeasonFileName(meta))
  const exists = await fileExists(filePath)
  if (!exists) {
    const header = [
      'ShaLom WPH 기록',
      `시즌: ${formatKstDate(meta.startAt)} - ${formatKstDate(meta.endAt)}`,
      `확인 주기: ${POLL_INTERVAL_MS / 1000}초`,
      '',
    ].join('\r\n')
    await writeFile(filePath, header, 'utf8')
  }
  await appendText(filePath, `[기록기 시작] ${formatKstDateTime(Date.now())}${reason ? ` | ${reason}` : ''}\r\n`)
  return filePath
}

async function renameSeasonFile(currentPath, meta) {
  const nextPath = path.join(outputDirectory, getSeasonFileName(meta))
  if (currentPath === nextPath || await fileExists(nextPath)) return nextPath
  await rename(currentPath, nextPath)
  return nextPath
}

function createWindow(startedAt, scores) {
  return {
    deltas: new Map(),
    startedAt,
    startScores: new Map(scores),
  }
}

function addDelta(windowState, key, delta) {
  if (!windowState.deltas.has(key)) windowState.deltas.set(key, [])
  windowState.deltas.get(key).push(delta)
}

function formatChangeLine(now, changes) {
  const details = changes.map((change) => {
    const member = splitMemberKey(change.key)
    return `${member.guildName}/${member.nickname} +${change.delta.toLocaleString('en-US')} (${change.previous.toLocaleString('en-US')}→${change.current.toLocaleString('en-US')})`
  })
  return `${formatKstTime(now)} | ${details.join('; ')}\r\n`
}

export function buildReport(windowState, currentScores, endedAt, label = '1시간 WPH', seasonSkipTotals = new Map()) {
  const elapsedMinutes = Math.max(0, (endedAt - windowState.startedAt) / 60000)
  const byGuild = new Map(selectedGuilds.map((guildName) => [guildName, []]))
  const reportMembers = []

  currentScores.forEach((currentScore, key) => {
    const startScore = windowState.startScores.get(key)
    if (!Number.isFinite(startScore) || currentScore < startScore) return
    const { guildName, nickname } = splitMemberKey(key)
    if (!byGuild.has(guildName)) byGuild.set(guildName, [])
    const scoreDelta = currentScore - startScore
    const deltas = windowState.deltas.get(key) || []
    const member = {
      detail: formatScoreBreakdown(deltas),
      guildName,
      hourlySkips: deltas.filter(isCrystalSkipDelta).length,
      nickname,
      scoreDelta,
      seasonSkips: seasonSkipTotals.get(key) || 0,
      wph: scoreDelta,
    }
    byGuild.get(guildName).push(member)
    reportMembers.push(member)
  })

  const lines = [
    '',
    `[${label}] ${formatKstDateTime(windowState.startedAt)} ~ ${formatKstDateTime(endedAt)} (${Math.round(elapsedMinutes)}분)`,
  ]

  byGuild.forEach((members, guildName) => {
    lines.push(`[${guildName}]`)
    members
      .sort((a, b) => b.scoreDelta - a.scoreDelta || a.nickname.localeCompare(b.nickname))
      .forEach((member, index) => {
        lines.push(`${index + 1}. ${member.nickname} | ${member.detail} = ${member.scoreDelta.toLocaleString('en-US')} WPH`)
      })
  })
  lines.push('')
  return {
    endedAt,
    members: reportMembers,
    startedAt: windowState.startedAt,
    text: `${lines.join('\r\n')}\r\n`,
  }
}

async function getCollectSecret() {
  if (process.env.COLLECT_SECRET) return process.env.COLLECT_SECRET
  const envText = await readFile(path.join(projectRoot, '.env'), 'utf8').catch(() => '')
  const line = envText.split(/\r?\n/).find((entry) => entry.trim().startsWith('COLLECT_SECRET='))
  if (!line) return null
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '') || null
}

async function uploadReport(report, activeSeason, slotAt, collectSecret) {
  if (!collectSecret || report.members.length === 0) return { skipped: true }
  const response = await fetch(uploadUrl, {
    body: JSON.stringify({
      members: report.members.map((member) => ({
        detail: member.detail,
        guildName: member.guildName,
        hourlySkips: member.hourlySkips,
        nickname: member.nickname,
        seasonSkips: member.seasonSkips,
        wph: member.wph,
      })),
      seasonKey: activeSeason.meta.key,
      slotAt: new Date(slotAt).toISOString(),
      windowStartAt: new Date(report.startedAt).toISOString(),
    }),
    headers: {
      Authorization: `Bearer ${collectSecret}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `웹 업로드 실패 ${response.status}`)
  return payload
}

async function acquireLock() {
  await mkdir(outputDirectory, { recursive: true })
  await rm(stopRequestPath, { force: true })
  const lockPath = path.join(outputDirectory, '.recorder.lock')

  try {
    const handle = await open(lockPath, 'wx')
    await handle.writeFile(String(process.pid), 'utf8')
    await handle.close()
    return lockPath
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const previousPid = Number(await readFile(lockPath, 'utf8').catch(() => ''))
    let running = false
    if (Number.isInteger(previousPid) && previousPid > 0) {
      try {
        process.kill(previousPid, 0)
        running = true
      } catch {
        running = false
      }
    }
    if (running) throw new Error('WPH 기록기가 이미 실행 중입니다.')
    await rm(lockPath, { force: true })
    return acquireLock()
  }
}

async function main() {
  const lockPath = await acquireLock()
  const collectSecret = await getCollectSecret()
  let stopped = false
  let active = null
  let lastHeartbeatAt = 0
  let lastScores = new Map()
  let oldSeasonScores = new Map()
  let nextCheckpointAt = null
  let restoredWindow = null
  let seasonSkipTotals = new Map()
  let windowState = null

  const stop = async () => {
    if (stopped) return
    stopped = true
    if (active?.filePath) await appendText(active.filePath, `[기록기 종료] ${formatKstDateTime(Date.now())}\r\n`)
    await rm(lockPath, { force: true })
  }

  process.once('SIGINT', () => void stop())
  process.once('SIGTERM', () => void stop())

  async function activateSeason(meta, reason, awaitingReset = false) {
    if (active?.filePath && windowState && lastScores.size > 0) {
      const elapsed = Date.now() - windowState.startedAt
      if (elapsed >= 60000) {
        const label = elapsed >= 55 * 60 * 1000 ? '1시간 WPH' : '마지막 구간'
        const report = buildReport(windowState, lastScores, Date.now(), label, seasonSkipTotals)
        await appendText(active.filePath, report.text)
        if (label === '1시간 WPH') {
          try {
            await uploadReport(report, active, active.meta.transitionAt, collectSecret)
            await appendText(active.filePath, `[웹 반영 완료] ${formatKstDateTime(Date.now())}\r\n`)
          } catch (error) {
            await appendText(active.filePath, `[웹 반영 오류] ${formatKstDateTime(Date.now())} | ${error.message}\r\n`)
          }
        }
      }
      await appendText(active.filePath, `[시즌 기록 종료] ${formatKstDateTime(Date.now())}\r\n`)
    }

    const filePath = await ensureSeasonFile(meta, reason)
    const recorderHistory = await readRecorderHistory(filePath)
    active = { awaitingReset, filePath, meta }
    lastScores = new Map()
    nextCheckpointAt = null
    restoredWindow = recorderHistory.windowStartedAt === null ? null : recorderHistory
    seasonSkipTotals = recorderHistory.seasonSkips
    windowState = null
    lastHeartbeatAt = Date.now()
    console.log(`[WPH] ${getSeasonFileName(meta)} 기록 시작`)
  }

  while (!stopped) {
    if (await fileExists(stopRequestPath)) {
      await rm(stopRequestPath, { force: true })
      break
    }

    const tickStartedAt = Date.now()
    try {
      const { errors, guilds } = await fetchGuilds()
      const apiSeason = getPrimarySeason(guilds)
      const currentScores = createScoreMap(guilds)

      if (!active) {
        if (!apiSeason) throw new Error('시즌 날짜 확인 실패')
        const transitionTime = toTime(apiSeason.transitionAt)
        if (transitionTime !== null && tickStartedAt >= transitionTime) {
          oldSeasonScores = new Map(currentScores)
          await activateSeason(predictNextSeason(apiSeason), '시즌 종료 기준 즉시 생성', true)
        } else {
          await activateSeason(apiSeason, '현재 시즌 연결')
        }
      }

      if (!active.awaitingReset && apiSeason && apiSeason.key !== active.meta.key) {
        oldSeasonScores = new Map(lastScores)
        await activateSeason(apiSeason, 'API 새 시즌 확인', true)
      }

      const transitionTime = toTime(active.meta.transitionAt)
      if (!active.awaitingReset && transitionTime !== null && tickStartedAt >= transitionTime) {
        oldSeasonScores = new Map(lastScores.size > 0 ? lastScores : currentScores)
        const nextSeason = predictNextSeason(active.meta)
        await activateSeason(nextSeason, '경고 기록 저장 시각과 함께 다음 시즌 생성', true)
      }

      if (active.awaitingReset) {
        const apiMovedToActiveSeason = apiSeason?.key === active.meta.key
        const scoreReset = isSeasonScoreReset(oldSeasonScores, currentScores)
        if (apiMovedToActiveSeason || scoreReset) {
          if (apiMovedToActiveSeason) {
            active.meta = apiSeason
            active.filePath = await renameSeasonFile(active.filePath, apiSeason)
          }
          active.awaitingReset = false
          lastScores = new Map([...currentScores.keys()].map((key) => [key, 0]))
          windowState = createWindow(tickStartedAt, lastScores)
          nextCheckpointAt = getNextCheckpointTime(tickStartedAt)
          await appendText(active.filePath, `[새 시즌 시작 확인] ${formatKstDateTime(tickStartedAt)} | 0점부터 이어서 기록\r\n`)
        }
      }

      if (!active.awaitingReset) {
        if (lastScores.size === 0) {
          lastScores = new Map(currentScores)
          nextCheckpointAt = getNextCheckpointTime(tickStartedAt, true)
          const memberCount = [...currentScores.keys()].length
          const canRestoreWindow =
            restoredWindow?.windowStartedAt !== null &&
            tickStartedAt - restoredWindow.windowStartedAt >= 0 &&
            tickStartedAt - restoredWindow.windowStartedAt < 70 * 60 * 1000
          if (canRestoreWindow) {
            const startScores = new Map(currentScores)
            restoredWindow.windowDeltas.forEach((deltas, key) => {
              const current = currentScores.get(key)
              if (Number.isFinite(current)) startScores.set(key, current - deltas.reduce((sum, delta) => sum + delta, 0))
            })
            windowState = {
              deltas: restoredWindow.windowDeltas,
              startedAt: restoredWindow.windowStartedAt,
              startScores,
            }
            await appendText(
              active.filePath,
              `[측정 재개] ${formatKstDateTime(tickStartedAt)} | ${formatKstTime(restoredWindow.windowStartedAt)} 기준 복원 | 시즌 skip 복원\r\n`,
            )
          } else {
            await appendText(
              active.filePath,
              `[측정 시작] ${formatKstDateTime(tickStartedAt)} | 길드원 ${memberCount}명 | 첫 1시간 시작 ${formatKstTime(getNextHourStartTime(tickStartedAt, true))}\r\n`,
            )
          }
          restoredWindow = null
        } else {
          const changes = []
          currentScores.forEach((current, key) => {
            const previous = lastScores.get(key)
            if (!Number.isFinite(previous)) {
              lastScores.set(key, current)
              windowState?.startScores.set(key, current)
              return
            }
            const delta = current - previous
            if (delta > 0) {
              changes.push({ current, delta, key, previous })
              if (windowState) addDelta(windowState, key, delta)
              if (isCrystalSkipDelta(delta)) seasonSkipTotals.set(key, (seasonSkipTotals.get(key) || 0) + 1)
            } else if (delta < 0) {
              windowState?.startScores.set(key, current)
              windowState?.deltas.delete(key)
            }
            lastScores.set(key, current)
          })

          if (changes.length > 0) await appendText(active.filePath, formatChangeLine(tickStartedAt, changes))
        }

        if (nextCheckpointAt !== null && tickStartedAt >= nextCheckpointAt) {
          const checkpointMinute = Number(getKstParts(nextCheckpointAt).minute)
          if (checkpointMinute === 55) {
            if (windowState) {
              const report = buildReport(windowState, currentScores, tickStartedAt, '1시간 WPH', seasonSkipTotals)
              await appendText(active.filePath, report.text)
              try {
                await uploadReport(report, active, nextCheckpointAt, collectSecret)
                await appendText(active.filePath, `[웹 반영 완료] ${formatKstDateTime(tickStartedAt)}\r\n`)
              } catch (error) {
                await appendText(active.filePath, `[웹 반영 오류] ${formatKstDateTime(tickStartedAt)} | ${error.message}\r\n`)
              }
              console.log(`[WPH] ${formatKstDateTime(tickStartedAt)} 1시간 결과 저장`)
            }
            windowState = createWindow(tickStartedAt, currentScores)
            await appendText(active.filePath, `[1시간 기준] ${formatKstDateTime(tickStartedAt)} | 55분 시작\r\n`)
          } else if (windowState) {
            await appendText(active.filePath, `[15분 체크] ${formatKstDateTime(tickStartedAt)} | ${checkpointMinute}분\r\n`)
          }
          nextCheckpointAt = getNextCheckpointTime(nextCheckpointAt + ONE_SECOND_MS)
        }
      }

      if (errors.length > 0) await appendText(active.filePath, `[API 일부 오류] ${formatKstTime(tickStartedAt)} | ${errors.join(', ')}\r\n`)
      if (tickStartedAt - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
        const status = active.awaitingReset ? '새 시즌 점수 초기화 확인 중' : '정상'
        await appendText(active.filePath, `[정상 확인] ${formatKstTime(tickStartedAt)} | ${status}\r\n`)
        lastHeartbeatAt = tickStartedAt
      }
    } catch (error) {
      console.error(`[WPH] ${formatKstDateTime(Date.now())} ${error.message}`)
      if (active?.filePath) await appendText(active.filePath, `[오류] ${formatKstDateTime(Date.now())} | ${error.message}\r\n`)
    }

    if (runOnce) break
    const remaining = Math.max(0, POLL_INTERVAL_MS - (Date.now() - tickStartedAt))
    await new Promise((resolve) => setTimeout(resolve, remaining))
  }

  await stop()
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(`[WPH] ${error.message}`)
    process.exitCode = 1
  })
}
