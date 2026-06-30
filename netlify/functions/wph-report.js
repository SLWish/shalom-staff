import { selectRows } from './_shared/supabaseRest.js'

const REPORT_GUILDS = ['ShaLom', 'ShaLom2', 'ShaLom3']
const LOOKBACK_HOURS = 18
const REPORT_MINUTE = 55
const PRIMARY_SOURCE_MINUTE_MIN = 53
const PRIMARY_SOURCE_MINUTE_MAX = 54
const SECONDARY_SOURCE_MINUTE_MIN = 55
const SECONDARY_SOURCE_MINUTE_MAX = 56
const FALLBACK_SOURCE_MINUTE_MIN = 49
const FALLBACK_SOURCE_MINUTE_MAX = 50
const INTERVAL_COUNT = 4
const GUILD_RANKING_URL = 'https://raongames.com/growcastle/restapi/season/now/guilds'
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

function formatSlotKey(date) {
  return date.toISOString()
}

function getReportSlotInfo(capturedAt) {
  const capturedTime = toTime(capturedAt)
  if (capturedTime === null) return null

  const capturedDate = new Date(capturedTime)
  const capturedMinute = capturedDate.getUTCMinutes()
  const isPrimary = capturedMinute >= PRIMARY_SOURCE_MINUTE_MIN && capturedMinute <= PRIMARY_SOURCE_MINUTE_MAX
  const isSecondary = capturedMinute >= SECONDARY_SOURCE_MINUTE_MIN && capturedMinute <= SECONDARY_SOURCE_MINUTE_MAX
  const isFallback = capturedMinute >= FALLBACK_SOURCE_MINUTE_MIN && capturedMinute <= FALLBACK_SOURCE_MINUTE_MAX
  if (!isPrimary && !isSecondary && !isFallback) return null

  const slot = new Date(capturedTime)
  slot.setUTCMinutes(REPORT_MINUTE, 0, 0)
  return {
    sourcePriority: isPrimary ? 0 : isSecondary ? 1 : 2,
    slot,
  }
}

function groupRows(rows) {
  const grouped = new Map()

  rows.forEach((row) => {
    const slotInfo = getReportSlotInfo(row.captured_at)
    if (!slotInfo) return

    const slotKey = formatSlotKey(slotInfo.slot)
    const key = `${row.guild_name}__${slotKey}__${row.captured_at}`
    if (!grouped.has(key)) {
      grouped.set(key, {
        capturedAt: row.captured_at,
        guildName: row.guild_name,
        rows: [],
        seasonKey: row.season_key,
        slotAt: slotKey,
        slotTime: slotInfo.slot.getTime(),
        sourcePriority: slotInfo.sourcePriority,
      })
    }
    grouped.get(key).rows.push(row)
  })

  return [...grouped.values()]
}

function chooseSnapshots(rows) {
  const grouped = groupRows(rows)
  const byGuild = {}

  REPORT_GUILDS.forEach((guildName) => {
    const guildSnapshots = grouped
      .filter((snapshot) => snapshot.guildName === guildName)
      .reduce((selected, snapshot) => {
        const current = selected[snapshot.slotAt]
        const snapshotDistance = Math.abs(toTime(snapshot.capturedAt) - snapshot.slotTime)
        const currentDistance = current ? Math.abs(toTime(current.capturedAt) - current.slotTime) : Infinity
        if (
          !current ||
          snapshot.sourcePriority < current.sourcePriority ||
          (snapshot.sourcePriority === current.sourcePriority && snapshotDistance < currentDistance)
        ) {
          selected[snapshot.slotAt] = snapshot
        }
        return selected
      }, {})

    byGuild[guildName] = Object.values(guildSnapshots)
      .sort((a, b) => a.slotTime - b.slotTime)
      .slice(-(INTERVAL_COUNT + 1))
  })

  return byGuild
}

function getDownMinutes(row) {
  const apiTime = toTime(row.api_date)
  const capturedTime = toTime(row.captured_at)
  if (apiTime === null || capturedTime === null || capturedTime < apiTime) return null
  return Math.floor((capturedTime - apiTime) / 60000)
}

function buildGuildReportWithMeta(guildName, snapshots, guildMeta) {
  const latestSnapshot = snapshots.at(-1)
  const firstSnapshot = snapshots[0]
  const bySlot = snapshots.map((snapshot) => ({
    ...snapshot,
    members: Object.fromEntries(snapshot.rows.map((row) => [row.nickname, row])),
  }))

  if (!latestSnapshot || snapshots.length < 2) {
    return {
      guildName,
      members: [],
      slotCount: snapshots.length,
      windowEndAt: latestSnapshot?.slotAt || null,
      windowStartAt: firstSnapshot?.slotAt || null,
    }
  }

  const seasonEndTime = toTime(guildMeta?.seasonEndAt)
  const latestSlotTime = latestSnapshot.slotTime
  const elapsedHours = Math.max(0, (latestSnapshot.slotTime - firstSnapshot.slotTime) / 36e5)
  const remainingHours =
    seasonEndTime !== null && latestSlotTime !== null ? Math.max(0, (seasonEndTime - latestSlotTime) / 36e5) : null

  const latestMembers = latestSnapshot.rows
  const members = latestMembers
    .map((latestRow) => {
      const hourly = []
      let skippedIntervals = 0
      for (let index = 1; index < bySlot.length; index += 1) {
        const previous = bySlot[index - 1].members[latestRow.nickname]
        const current = bySlot[index].members[latestRow.nickname]
        const previousWave = Number(previous?.wave)
        const currentWave = Number(current?.wave)
        const waveDelta = Number.isFinite(previousWave) && Number.isFinite(currentWave) ? Math.max(0, currentWave - previousWave) : null
        if (waveDelta !== null && waveDelta > MAX_NORMAL_WPH) {
          skippedIntervals += 1
          hourly.push(null)
        } else {
          hourly.push(waveDelta)
        }
      }

      const validHourly = hourly.filter((value) => typeof value === 'number')
      const averageWph = validHourly.length > 0 ? Math.round(validHourly.reduce((sum, value) => sum + value, 0) / validHourly.length) : null
      const startRow = bySlot.find((slot) => slot.members[latestRow.nickname])?.members[latestRow.nickname] || null
      const startWave = typeof startRow?.wave === 'number' ? startRow.wave : null
      const endWave = typeof latestRow.wave === 'number' ? latestRow.wave : null
      const startScore = typeof startRow?.score === 'number' ? startRow.score : null
      const currentScore = typeof latestRow.score === 'number' ? latestRow.score : null
      const scoreDelta =
        typeof startScore === 'number' && typeof currentScore === 'number' ? Math.max(0, currentScore - startScore) : null
      const scorePerHour = scoreDelta !== null && elapsedHours > 0 ? scoreDelta / elapsedHours : null
      const projectedFinalScore =
        typeof currentScore === 'number' && typeof scorePerHour === 'number' && typeof remainingHours === 'number'
          ? Math.round(currentScore + scorePerHour * remainingHours)
          : null
      const downMinutes = getDownMinutes(latestRow)
      const skips = skippedIntervals + validHourly.filter((value) => averageWph && value > averageWph * 1.35).length

      return {
        averageWph,
        currentScore,
        downMinutes,
        endWave,
        hourly,
        nickname: latestRow.nickname,
        projectedFinalScore,
        score: latestRow.score,
        scoreDelta,
        scorePerHour,
        skips,
        startScore,
        startWave,
      }
    })
    .sort((a, b) => (b.averageWph || 0) - (a.averageWph || 0) || (b.endWave || 0) - (a.endWave || 0))

  return {
    guildName,
    members,
    slotCount: snapshots.length,
    windowEndAt: latestSnapshot.slotAt,
    windowStartAt: firstSnapshot.slotAt,
  }
}

function getLatestGuildMeta(rows) {
  return rows.reduce((selected, row) => {
    if (!row.guild_name) return selected
    const currentTime = toTime(selected[row.guild_name]?.captured_at)
    const rowTime = toTime(row.captured_at)
    if (rowTime !== null && (currentTime === null || rowTime > currentTime)) {
      selected[row.guild_name] = {
        captured_at: row.captured_at,
        seasonEndAt: row.raw_json?.seasonEndAt || null,
      }
    }
    return selected
  }, {})
}

async function fetchGuildRanks() {
  try {
    const response = await fetch(GUILD_RANKING_URL, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return {}
    const payload = await response.json()
    const list = payload?.result?.list || payload?.list || []
    return Object.fromEntries(
      list
        .filter((guild) => REPORT_GUILDS.includes(guild.name))
        .map((guild) => [guild.name, Number(guild.rank) || null]),
    )
  } catch {
    return {}
  }
}

export async function handler() {
  try {
    const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString()
    const [rows, guildRows, ranks] = await Promise.all([
      selectRows(
        `member_snapshots?select=guild_name,nickname,score,wave,api_date,captured_at,season_key&guild_name=in.(${REPORT_GUILDS.join(',')})&captured_at=gte.${encodeURIComponent(since)}&order=captured_at.desc&limit=3000`,
      ),
      selectRows(
        `guild_snapshots?select=guild_name,captured_at,raw_json&guild_name=in.(${REPORT_GUILDS.join(',')})&captured_at=gte.${encodeURIComponent(since)}&order=captured_at.desc&limit=100`,
      ),
      fetchGuildRanks(),
    ])
    const snapshotsByGuild = chooseSnapshots(rows)
    const guildMeta = getLatestGuildMeta(guildRows)
    const guilds = Object.fromEntries(
      REPORT_GUILDS.map((guildName) => {
        const report = buildGuildReportWithMeta(guildName, snapshotsByGuild[guildName] || [], guildMeta[guildName])
        return [guildName, { ...report, rank: ranks[guildName] || null }]
      }),
    )

    return json(200, {
      generatedAt: new Date().toISOString(),
      guilds,
      reportMinute: REPORT_MINUTE,
    })
  } catch (error) {
    return json(500, { error: error.message || 'WPH report failed' })
  }
}
