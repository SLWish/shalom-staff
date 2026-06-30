import { selectRows } from './_shared/supabaseRest.js'

const REPORT_GUILDS = ['ShaLom', 'ShaLom2', 'ShaLom3']
const MAX_SEASONS = 5
const REPORT_MINUTE = 55
const PRIMARY_SOURCE_MINUTE_MIN = 53
const PRIMARY_SOURCE_MINUTE_MAX = 56
const FALLBACK_SOURCE_MINUTE_MIN = 49
const FALLBACK_SOURCE_MINUTE_MAX = 50
const MAX_NORMAL_WPH = 3000

function json(statusCode, body) {
  return {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    statusCode,
  }
}

function toTime(value) {
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function getSlotInfo(capturedAt) {
  const capturedTime = toTime(capturedAt)
  if (capturedTime === null) return null

  const capturedDate = new Date(capturedTime)
  const minute = capturedDate.getUTCMinutes()
  const isPrimary = minute >= PRIMARY_SOURCE_MINUTE_MIN && minute <= PRIMARY_SOURCE_MINUTE_MAX
  const isFallback = minute >= FALLBACK_SOURCE_MINUTE_MIN && minute <= FALLBACK_SOURCE_MINUTE_MAX
  if (!isPrimary && !isFallback) return null

  const slot = new Date(capturedTime)
  slot.setUTCMinutes(REPORT_MINUTE, 0, 0)

  return {
    priority: isPrimary ? 0 : 1,
    slotAt: slot.toISOString(),
    slotTime: slot.getTime(),
  }
}

function getKstDayKey(value) {
  const time = toTime(value)
  if (time === null) return 'unknown'
  const date = new Date(time + 9 * 60 * 60 * 1000)
  return date.toISOString().slice(0, 10)
}

function getSeasonLabel(row) {
  const start = row.season_start_at || row.raw_json?.seasonStartAt || String(row.season_key || '').split('_')[0]
  const end = row.season_end_at || row.raw_json?.seasonEndAt || String(row.season_key || '').split('_')[1]
  return {
    endAt: row.season_end_at || row.raw_json?.seasonEndAt || null,
    label: `${String(start).slice(5, 10).replace('-', '. ')}. ~ ${String(end).slice(5, 10).replace('-', '. ')}.`,
    seasonKey: row.season_key,
    startAt: row.season_start_at || row.raw_json?.seasonStartAt || null,
  }
}

function getSeasonList(rows) {
  const seen = new Set()
  const seasons = []

  rows.forEach((row) => {
    if (!row.season_key || seen.has(row.season_key)) return
    seen.add(row.season_key)
    seasons.push(getSeasonLabel(row))
  })

  return seasons.slice(0, MAX_SEASONS)
}

function chooseSnapshots(rows) {
  const selected = {}

  rows.forEach((row) => {
    const slotInfo = getSlotInfo(row.captured_at)
    if (!slotInfo || !REPORT_GUILDS.includes(row.guild_name)) return

    const key = `${row.guild_name}__${slotInfo.slotAt}__${row.nickname}`
    const current = selected[key]
    const rowDistance = Math.abs(toTime(row.captured_at) - slotInfo.slotTime)
    const currentDistance = current ? Math.abs(toTime(current.captured_at) - slotInfo.slotTime) : Infinity

    if (
      !current ||
      slotInfo.priority < current.sourcePriority ||
      (slotInfo.priority === current.sourcePriority && rowDistance < currentDistance)
    ) {
      selected[key] = {
        ...row,
        slotAt: slotInfo.slotAt,
        slotTime: slotInfo.slotTime,
        sourcePriority: slotInfo.priority,
      }
    }
  })

  return Object.values(selected).sort((a, b) => a.slotTime - b.slotTime)
}

function createDayBuckets(dayKeys, value = 0) {
  return Object.fromEntries(dayKeys.map((dayKey) => [dayKey, value]))
}

function getAverage(values) {
  const valid = values.filter((value) => typeof value === 'number' && Number.isFinite(value))
  return valid.length > 0 ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0
}

function round(value, digits = 1) {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function buildMemberSummary(nickname, rows, dayKeys) {
  const ordered = [...rows].sort((a, b) => a.slotTime - b.slotTime)
  const intervals = []

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    const previousWave = Number(previous.wave)
    const currentWave = Number(current.wave)
    const deltaHours = (current.slotTime - previous.slotTime) / 36e5
    if (!Number.isFinite(previousWave) || !Number.isFinite(currentWave) || deltaHours <= 0) continue

    const waveDelta = Math.max(0, currentWave - previousWave)
    const wph = waveDelta / deltaHours
    if (wph > MAX_NORMAL_WPH) continue

    intervals.push({
      dayKey: getKstDayKey(current.slotAt),
      hours: deltaHours,
      waveDelta,
      wph,
    })
  }

  const activeIntervals = intervals.filter((interval) => interval.waveDelta > 0)
  const averageWph = getAverage(activeIntervals.map((interval) => interval.wph))
  const dayWph = createDayBuckets(dayKeys, null)
  const passiveHours = createDayBuckets(dayKeys, 0)
  const skipHours = createDayBuckets(dayKeys, 0)
  const orangeHours = createDayBuckets(dayKeys, 0)
  const downHours = createDayBuckets(dayKeys, 0)
  const belowPassiveHours = createDayBuckets(dayKeys, 0)

  dayKeys.forEach((dayKey) => {
    const dayIntervals = activeIntervals.filter((interval) => interval.dayKey === dayKey)
    dayWph[dayKey] = dayIntervals.length > 0 ? Math.round(getAverage(dayIntervals.map((interval) => interval.wph))) : 0
  })

  intervals.forEach((interval) => {
    if (!dayKeys.includes(interval.dayKey)) return
    if (interval.waveDelta === 0) {
      downHours[interval.dayKey] += interval.hours
      return
    }

    if (averageWph > 0 && interval.wph >= averageWph + 300) orangeHours[interval.dayKey] += interval.hours
    else if (averageWph > 0 && interval.wph >= averageWph + 30) skipHours[interval.dayKey] += interval.hours
    else if (averageWph > 0 && interval.wph <= averageWph - 30) belowPassiveHours[interval.dayKey] += interval.hours
    else passiveHours[interval.dayKey] += interval.hours
  })

  const firstRow = ordered[0]
  const lastRow = ordered.at(-1)
  const totalWaves = intervals.reduce((sum, interval) => sum + interval.waveDelta, 0)
  const skipIntervals = intervals.filter((interval) => averageWph > 0 && interval.wph >= averageWph + 30)

  return {
    averageWph: Math.round(averageWph),
    belowPassiveHours: round(Object.values(belowPassiveHours).reduce((sum, value) => sum + value, 0), 2),
    belowPassiveHoursByDay: dayKeys.map((dayKey) => round(belowPassiveHours[dayKey], 2)),
    downHours: round(Object.values(downHours).reduce((sum, value) => sum + value, 0), 2),
    downHoursByDay: dayKeys.map((dayKey) => round(downHours[dayKey], 2)),
    endWave: Number(lastRow?.wave) || 0,
    nickname,
    orangeHours: round(Object.values(orangeHours).reduce((sum, value) => sum + value, 0), 2),
    orangeHoursByDay: dayKeys.map((dayKey) => round(orangeHours[dayKey], 2)),
    passiveHours: round(Object.values(passiveHours).reduce((sum, value) => sum + value, 0), 2),
    passiveHoursByDay: dayKeys.map((dayKey) => round(passiveHours[dayKey], 2)),
    passiveWphByDay: dayKeys.map((dayKey) => dayWph[dayKey] || 0),
    skipHours: round(Object.values(skipHours).reduce((sum, value) => sum + value, 0), 2),
    skipHoursByDay: dayKeys.map((dayKey) => round(skipHours[dayKey], 2)),
    skipWph: Math.round(getAverage(skipIntervals.map((interval) => interval.wph))),
    skipWphByDay: dayKeys.map((dayKey) => {
      const dayIntervals = skipIntervals.filter((interval) => interval.dayKey === dayKey)
      return dayIntervals.length > 0 ? Math.round(getAverage(dayIntervals.map((interval) => interval.wph))) : 0
    }),
    startWave: Number(firstRow?.wave) || 0,
    totalWaves,
  }
}

function buildGuildSummary(guildName, rows, dayKeys) {
  const byMember = rows.reduce((grouped, row) => {
    if (!grouped[row.nickname]) grouped[row.nickname] = []
    grouped[row.nickname].push(row)
    return grouped
  }, {})

  const members = Object.entries(byMember)
    .map(([nickname, memberRows]) => buildMemberSummary(nickname, memberRows, dayKeys))
    .filter((member) => member.totalWaves > 0 || member.endWave > 0)
    .sort((a, b) => b.totalWaves - a.totalWaves || b.averageWph - a.averageWph)

  return {
    guildName,
    guildAverageWph: Math.round(getAverage(members.map((member) => member.averageWph))),
    guildBelowPassiveHours: round(members.reduce((sum, member) => sum + member.belowPassiveHours, 0), 2),
    guildDownHours: round(members.reduce((sum, member) => sum + member.downHours, 0), 2),
    guildOrangeHours: round(members.reduce((sum, member) => sum + member.orangeHours, 0), 2),
    guildPassiveHours: round(members.reduce((sum, member) => sum + member.passiveHours, 0), 2),
    guildSkipHours: round(members.reduce((sum, member) => sum + member.skipHours, 0), 2),
    guildSkipWph: Math.round(getAverage(members.map((member) => member.skipWph).filter((value) => value > 0))),
    guildTotalWaves: members.reduce((sum, member) => sum + member.totalWaves, 0),
    members,
  }
}

function buildSummary(season, rows) {
  const snapshots = chooseSnapshots(rows)
  const dayKeys = [...new Set(snapshots.map((row) => getKstDayKey(row.slotAt)))].slice(0, 5)
  const guilds = Object.fromEntries(
    REPORT_GUILDS.map((guildName) => [
      guildName,
      buildGuildSummary(
        guildName,
        snapshots.filter((row) => row.guild_name === guildName),
        dayKeys,
      ),
    ]),
  )

  return {
    dayKeys,
    generatedAt: new Date().toISOString(),
    guilds,
    season,
  }
}

export async function handler(event) {
  try {
    const guildFilter = REPORT_GUILDS.join(',')
    const seasonRows = await selectRows(
      `guild_snapshots?select=guild_name,season_key,captured_at,raw_json&guild_name=in.(${guildFilter})&order=captured_at.desc&limit=600`,
    )
    const seasons = getSeasonList(seasonRows)
    const requestedSeasonKey = event.queryStringParameters?.seasonKey
    const selectedSeason = seasons.find((season) => season.seasonKey === requestedSeasonKey) || seasons[0] || null

    if (!selectedSeason) {
      return json(200, { seasons: [], summary: null })
    }

    const rows = await selectRows(
      `member_snapshots?select=guild_name,nickname,wave,score,captured_at,api_date,season_key&guild_name=in.(${guildFilter})&season_key=eq.${encodeURIComponent(selectedSeason.seasonKey)}&order=captured_at.asc&limit=12000`,
    )

    return json(200, {
      seasons,
      summary: buildSummary(selectedSeason, rows),
    })
  } catch (error) {
    return json(500, { error: error.message || 'Season summary failed' })
  }
}
