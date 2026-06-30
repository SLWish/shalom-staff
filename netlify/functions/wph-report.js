import { selectRows } from './_shared/supabaseRest.js'

const REPORT_GUILDS = ['ShaLom', 'ShaLom2', 'ShaLom3']
const LOOKBACK_HOURS = 18
const REPORT_MINUTE = 55
const SOURCE_MINUTE_MIN = 53
const INTERVAL_COUNT = 4

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

function getReportSlot(capturedAt) {
  const capturedTime = toTime(capturedAt)
  if (capturedTime === null) return null

  const capturedDate = new Date(capturedTime)
  if (capturedDate.getUTCMinutes() < SOURCE_MINUTE_MIN) return null

  const slot = new Date(capturedTime)
  slot.setUTCMinutes(REPORT_MINUTE, 0, 0)
  return slot
}

function groupRows(rows) {
  const grouped = new Map()

  rows.forEach((row) => {
    const slot = getReportSlot(row.captured_at)
    if (!slot) return

    const slotKey = formatSlotKey(slot)
    const key = `${row.guild_name}__${slotKey}__${row.captured_at}`
    if (!grouped.has(key)) {
      grouped.set(key, {
        capturedAt: row.captured_at,
        guildName: row.guild_name,
        rows: [],
        slotAt: slotKey,
        slotTime: slot.getTime(),
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
        if (!current || snapshotDistance < currentDistance) selected[snapshot.slotAt] = snapshot
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

function buildGuildReport(guildName, snapshots) {
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

  const latestMembers = latestSnapshot.rows
  const members = latestMembers
    .map((latestRow) => {
      const hourly = []
      for (let index = 1; index < bySlot.length; index += 1) {
        const previous = bySlot[index - 1].members[latestRow.nickname]
        const current = bySlot[index].members[latestRow.nickname]
        const previousWave = Number(previous?.wave)
        const currentWave = Number(current?.wave)
        hourly.push(Number.isFinite(previousWave) && Number.isFinite(currentWave) ? Math.max(0, currentWave - previousWave) : null)
      }

      const validHourly = hourly.filter((value) => typeof value === 'number')
      const averageWph = validHourly.length > 0 ? Math.round(validHourly.reduce((sum, value) => sum + value, 0) / validHourly.length) : null
      const startRow = bySlot.find((slot) => slot.members[latestRow.nickname])?.members[latestRow.nickname] || null
      const startWave = typeof startRow?.wave === 'number' ? startRow.wave : null
      const endWave = typeof latestRow.wave === 'number' ? latestRow.wave : null
      const downMinutes = getDownMinutes(latestRow)
      const skips = validHourly.filter((value) => averageWph && value > averageWph * 1.35).length

      return {
        averageWph,
        downMinutes,
        endWave,
        hourly,
        nickname: latestRow.nickname,
        score: latestRow.score,
        skips,
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

export async function handler() {
  try {
    const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString()
    const rows = await selectRows(
      `member_snapshots?select=guild_name,nickname,score,wave,api_date,captured_at&guild_name=in.(${REPORT_GUILDS.join(',')})&captured_at=gte.${encodeURIComponent(since)}&order=captured_at.asc&limit=3000`,
    )
    const snapshotsByGuild = chooseSnapshots(rows)
    const guilds = Object.fromEntries(REPORT_GUILDS.map((guildName) => [guildName, buildGuildReport(guildName, snapshotsByGuild[guildName] || [])]))

    return json(200, {
      generatedAt: new Date().toISOString(),
      guilds,
      reportMinute: REPORT_MINUTE,
    })
  } catch (error) {
    return json(500, { error: error.message || 'WPH report failed' })
  }
}
