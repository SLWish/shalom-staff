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
const LOCAL_WPH_GUILD_NAME = '__local_wph__'
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

function getSkipCount(hourlyValues, averageWph) {
  if (typeof averageWph !== 'number' || averageWph <= 0) return 0
  return hourlyValues.reduce((sum, value) => {
    if (typeof value !== 'number' || value < averageWph + 30) return sum
    return sum + Math.floor((value - averageWph) / 30)
  }, 0)
}

function getAutoFit(autoExtra, scoreDelta) {
  const ratio = autoExtra / scoreDelta
  const expectedRatios = [
    { label: 'none', ratio: 0 },
    { label: 'orc', ratio: 0.2 },
    { label: 'female', ratio: 0.4 },
    { label: 'orc+female', ratio: 0.6 },
  ]
  return expectedRatios
    .map((expected) => ({
      ...expected,
      error: Math.abs(ratio - expected.ratio),
    }))
    .sort((a, b) => a.error - b.error)[0]
}

function getAutoTolerance(scoreDelta) {
  if (scoreDelta >= 150) return 0.07
  if (scoreDelta >= 80) return 0.1
  return 0.14
}

function pushCrystalFits(candidates, baseJump, remainder, scoreDelta) {
  const units = [
    { countKey: 'crystal10', value: 10 - baseJump },
    { countKey: 'crystal20', value: 20 - baseJump },
    { countKey: 'crystal30', value: 30 - baseJump },
  ].filter((unit) => unit.value > 0)

  const max10 = Math.min(20, Math.floor(remainder / (units[0]?.value || Infinity)))
  const max20 = Math.min(20, Math.floor(remainder / (units[1]?.value || Infinity)))
  const max30 = Math.min(20, Math.floor(remainder / (units[2]?.value || Infinity)))
  const tolerance = getAutoTolerance(scoreDelta)

  for (let crystal10 = 0; crystal10 <= max10; crystal10 += 1) {
    for (let crystal20 = 0; crystal20 <= max20; crystal20 += 1) {
      for (let crystal30 = 0; crystal30 <= max30; crystal30 += 1) {
        const crystalExtra =
          crystal10 * (10 - baseJump) +
          crystal20 * (20 - baseJump) +
          crystal30 * (30 - baseJump)
        if (crystalExtra > remainder) continue

        const autoExtra = remainder - crystalExtra
        const autoFit = getAutoFit(autoExtra, scoreDelta)
        const validAuto = autoFit.error <= tolerance
        const crystalCount = crystal10 + crystal20 + crystal30
        const nonThirtyCrystalCount = crystal10 + crystal20
        const thirtyOnlyBonus = crystalCount > 0 && nonThirtyCrystalCount === 0 ? -0.025 : 0
        const score =
          autoFit.error +
          (validAuto ? 0 : 0.35) +
          crystalCount * 0.002 +
          nonThirtyCrystalCount * 0.08 +
          thirtyOnlyBonus +
          (6 - baseJump) * 0.04 +
          (autoExtra > scoreDelta * 0.75 ? 0.18 : 0)

        candidates.push({
          autoExtra,
          autoFit,
          baseJump,
          crystal10,
          crystal20,
          crystal30,
          crystalExtra,
          score,
          validAuto,
        })
      }
    }
  }
}

function decomposeWaveDetail(waveDelta, scoreDelta) {
  const candidates = []

  for (let baseJump = 6; baseJump >= 3; baseJump -= 1) {
    const baseWave = scoreDelta * baseJump
    const remainder = waveDelta - baseWave
    if (remainder < 0) continue

    pushCrystalFits(candidates, baseJump, remainder, scoreDelta)
  }

  return candidates.sort(
    (a, b) =>
      a.score - b.score ||
      b.baseJump - a.baseJump ||
      a.crystal10 + a.crystal20 + a.crystal30 - (b.crystal10 + b.crystal20 + b.crystal30) ||
      a.crystalExtra - b.crystalExtra,
  )[0]
}

function isPlausibleDetailScoreDelta(waveDelta, scoreDelta) {
  if (typeof scoreDelta !== 'number' || scoreDelta <= 0) return false
  if (scoreDelta > waveDelta / 3) return false
  if (scoreDelta < waveDelta / 8) return false
  return true
}

function formatWaveDetail(waveDelta, scoreDelta) {
  if (typeof waveDelta !== 'number') return '0'
  if (!isPlausibleDetailScoreDelta(waveDelta, scoreDelta)) return String(waveDelta)

  const detail = decomposeWaveDetail(waveDelta, scoreDelta)
  if (!detail) return String(waveDelta)

  const parts = [`${scoreDelta}x${detail.baseJump}`]
  if (detail.crystalExtra > 0) parts.push(String(detail.crystalExtra))
  if (detail.autoExtra > 0) parts.push(String(detail.autoExtra))
  return parts.join('+')
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
      for (let index = 1; index < bySlot.length; index += 1) {
        const previous = bySlot[index - 1].members[latestRow.nickname]
        const current = bySlot[index].members[latestRow.nickname]
        const previousWave = Number(previous?.wave)
        const currentWave = Number(current?.wave)
        const previousScore = Number(previous?.score)
        const currentScoreForSlot = Number(current?.score)
        const previousPersonalScore = Number(previous?.raw_json?.personalScore)
        const currentPersonalScore = Number(current?.raw_json?.personalScore)
        const waveDelta = Number.isFinite(previousWave) && Number.isFinite(currentWave) ? Math.max(0, currentWave - previousWave) : null
        const scoreDeltaForSlot =
          Number.isFinite(previousScore) && Number.isFinite(currentScoreForSlot) ? Math.max(0, currentScoreForSlot - previousScore) : null
        const personalScoreDeltaForSlot =
          Number.isFinite(previousPersonalScore) && Number.isFinite(currentPersonalScore)
            ? Math.max(0, currentPersonalScore - previousPersonalScore)
            : null
        if (waveDelta !== null && waveDelta > MAX_NORMAL_WPH) {
          hourly.push({ scoreDelta: scoreDeltaForSlot, detailScoreDelta: personalScoreDeltaForSlot, slotAt: bySlot[index].slotAt, waveDelta: null })
        } else {
          hourly.push({ scoreDelta: scoreDeltaForSlot, detailScoreDelta: personalScoreDeltaForSlot, slotAt: bySlot[index].slotAt, waveDelta })
        }
      }

      const hourlyValues = hourly.map((item) => item.waveDelta)
      const validHourly = hourlyValues.filter((value) => typeof value === 'number')
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
      const skips = getSkipCount(validHourly, averageWph)

      return {
        averageWph,
        currentScore,
        detailHourly: hourly.map((item) => formatWaveDetail(item.waveDelta, item.detailScoreDelta)),
        downMinutes,
        endWave,
        hourly: hourlyValues,
        hourlySlots: hourly.map((item) => item.slotAt),
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
    seasonEndAt: guildMeta?.seasonEndAt || null,
    seasonStartAt: guildMeta?.seasonStartAt || null,
    slotCount: snapshots.length,
    windowEndAt: latestSnapshot.slotAt,
    windowStartAt: firstSnapshot.slotAt,
  }
}

function getHourKey(value) {
  const time = toTime(value)
  return time === null ? null : new Date(time).toISOString().slice(0, 13)
}

function getSeasonKey(startAt, endAt) {
  if (!startAt || !endAt) return null
  return `${String(startAt).slice(0, 10)}_${String(endAt).slice(0, 10)}`
}

export function mergeLocalWph(report, localRows) {
  if (!report?.members?.length || !localRows.length) return report
  const rowsByNickname = localRows.reduce((grouped, row) => {
    const raw = row.raw_json || {}
    if (raw.guildName !== report.guildName || !raw.nickname) return grouped
    if (row.season_key !== getSeasonKey(report.seasonStartAt, report.seasonEndAt)) return grouped
    if (!grouped[raw.nickname]) grouped[raw.nickname] = []
    grouped[raw.nickname].push({
      detail: String(raw.detail || row.score || 0),
      seasonSkips: Number(raw.seasonSkips),
      slotAt: row.captured_at,
      value: Number(raw.wph ?? row.score),
    })
    return grouped
  }, {})

  return {
    ...report,
    members: report.members.map((member) => {
      const entries = new Map()
      member.hourly.forEach((value, index) => {
        const slotAt = member.hourlySlots?.[index]
        const key = getHourKey(slotAt)
        if (!key) return
        entries.set(key, { detail: member.detailHourly?.[index] || String(value ?? 0), slotAt, value })
      })
      ;(rowsByNickname[member.nickname] || []).forEach((entry) => {
        const key = getHourKey(entry.slotAt)
        if (key && Number.isFinite(entry.value)) entries.set(key, entry)
      })

      const merged = [...entries.values()]
        .sort((a, b) => toTime(a.slotAt) - toTime(b.slotAt))
        .slice(-INTERVAL_COUNT)
      const validValues = merged.map((entry) => entry.value).filter(Number.isFinite)
      const latestSeasonSkips = [...(rowsByNickname[member.nickname] || [])]
        .filter((entry) => Number.isFinite(entry.seasonSkips))
        .sort((a, b) => toTime(b.slotAt) - toTime(a.slotAt))[0]?.seasonSkips
      return {
        ...member,
        averageWph:
          validValues.length > 0
            ? Math.round(validValues.reduce((sum, value) => sum + value, 0) / validValues.length)
            : member.averageWph,
        detailHourly: merged.map((entry) => entry.detail),
        hourly: merged.map((entry) => entry.value),
        hourlySlots: merged.map((entry) => entry.slotAt),
        skips: Number.isFinite(latestSeasonSkips) ? latestSeasonSkips : member.skips,
      }
    }),
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
        seasonStartAt: row.raw_json?.seasonStartAt || null,
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
    const [rows, guildRows, localWphRows, ranks] = await Promise.all([
      selectRows(
        `member_snapshots?select=guild_name,nickname,score,wave,api_date,captured_at,season_key,raw_json&guild_name=in.(${REPORT_GUILDS.join(',')})&captured_at=gte.${encodeURIComponent(since)}&order=captured_at.desc&limit=3000`,
      ),
      selectRows(
        `guild_snapshots?select=guild_name,captured_at,raw_json&guild_name=in.(${REPORT_GUILDS.join(',')})&captured_at=gte.${encodeURIComponent(since)}&order=captured_at.desc&limit=100`,
      ),
      selectRows(
        `member_snapshots?select=captured_at,score,season_key,raw_json&guild_name=eq.${encodeURIComponent(LOCAL_WPH_GUILD_NAME)}&order=captured_at.desc&limit=500`,
      ),
      fetchGuildRanks(),
    ])
    const snapshotsByGuild = chooseSnapshots(rows)
    const guildMeta = getLatestGuildMeta(guildRows)
    const guilds = Object.fromEntries(
      REPORT_GUILDS.map((guildName) => {
        const report = buildGuildReportWithMeta(guildName, snapshotsByGuild[guildName] || [], guildMeta[guildName])
        return [guildName, { ...mergeLocalWph(report, localWphRows), rank: ranks[guildName] || null }]
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
