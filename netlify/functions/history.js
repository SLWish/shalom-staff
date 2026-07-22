import { selectRows } from './_shared/supabaseRest.js'

const ARCHIVE_TARGET_TOLERANCE_MS = 10 * 60 * 1000
const LOCAL_ROSTER_GUILD_NAME = '__local_roster__'
const ACTIVE_GUILD_NAMES = new Set(['ShaLom', 'ShaLom2', 'ShaLom3', 'ShaLom4'])
const REST_GUILD_NAMES = new Set(['ShaLom5', 'ShaLom6'])
const TRACKED_GUILD_NAMES = new Set([...ACTIVE_GUILD_NAMES, ...REST_GUILD_NAMES])

function json(statusCode, body) {
  return {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    statusCode,
  }
}

function latestByGuild(rows) {
  const result = {}
  rows.forEach((row) => {
    if (!result[row.guild_name]) result[row.guild_name] = row
  })
  return Object.values(result)
}

function previousByGuild(rows, latestGuilds) {
  const latestCapturedAtByGuild = Object.fromEntries(latestGuilds.map((guild) => [guild.guild_name, guild.captured_at]))
  const result = {}

  rows.forEach((row) => {
    if (result[row.guild_name] || row.captured_at === latestCapturedAtByGuild[row.guild_name]) return
    result[row.guild_name] = row
  })

  return Object.values(result)
}

function groupSnapshotsByGuild(rows) {
  return rows.reduce((groups, row) => {
    groups[row.guild_name] = [...(groups[row.guild_name] || []), row]
    return groups
  }, {})
}

export function getNewMemberCandidates(currentMembers, baselineMembers) {
  const baselineNicknames = new Set(baselineMembers.map((member) => member.nickname).filter(Boolean))
  return currentMembers.filter((member) => member.nickname && !baselineNicknames.has(member.nickname))
}

export function classifyGuildArrival(targetGuildName, previousGuildName) {
  if (!previousGuildName) return 'new'
  if (ACTIVE_GUILD_NAMES.has(targetGuildName) && REST_GUILD_NAMES.has(previousGuildName)) return 'returning'
  if (ACTIVE_GUILD_NAMES.has(targetGuildName) && previousGuildName === targetGuildName) return 'returning'
  return 'transfer'
}

async function getJoinedMembers(latestGuilds, latestMemberRows) {
  const joinedMembers = []
  const seasonKeys = [...new Set(latestGuilds.map((guild) => guild.season_key).filter(Boolean))]
  const localEventPages = await Promise.all(
    seasonKeys.map((seasonKey) =>
      selectRows(
        `member_snapshots?select=captured_at,season_key,raw_json&guild_name=eq.${LOCAL_ROSTER_GUILD_NAME}&season_key=eq.${encodeURIComponent(seasonKey)}&order=captured_at.asc&limit=500`,
      ),
    ),
  )
  const localJoinByMember = new Map()
  const localJoinHistoryByNickname = new Map()
  localEventPages.flat().forEach((row) => {
    const event = row.raw_json || {}
    if (event.event !== 'joined' || !event.guildName || !event.nickname) return
    const key = `${row.season_key}:${event.guildName}:${event.nickname}`
    if (!localJoinByMember.has(key)) localJoinByMember.set(key, event)
    const history = localJoinHistoryByNickname.get(event.nickname) || []
    history.push(event)
    localJoinHistoryByNickname.set(event.nickname, history)
  })

  for (const guild of latestGuilds) {
    if (!guild.season_key) continue

    const [baselineGuild] = await selectRows(
      `guild_snapshots?select=captured_at&guild_name=eq.${encodeURIComponent(guild.guild_name)}&season_key=eq.${encodeURIComponent(guild.season_key)}&member_count=gt.0&order=captured_at.asc&limit=1`,
    )
    if (!baselineGuild?.captured_at) continue

    const baselineMembers = await selectRows(
      `member_snapshots?select=nickname&guild_name=eq.${encodeURIComponent(guild.guild_name)}&captured_at=eq.${encodeURIComponent(baselineGuild.captured_at)}`,
    )
    const currentMembers = latestMemberRows.filter((member) => member.guild_name === guild.guild_name)
    const candidates = getNewMemberCandidates(currentMembers, baselineMembers)
    const firstSeenRows = await Promise.all(
      candidates.map((member) => {
        const localJoin = localJoinByMember.get(`${guild.season_key}:${guild.guild_name}:${member.nickname}`)
        if (localJoin?.observedAt) {
          return [{ captured_at: localJoin.observedAt, score: localJoin.score, source: localJoin.source }]
        }
        return selectRows(
          `member_snapshots?select=captured_at,score&guild_name=eq.${encodeURIComponent(guild.guild_name)}&season_key=eq.${encodeURIComponent(guild.season_key)}&nickname=eq.${encodeURIComponent(member.nickname)}&order=captured_at.asc&limit=1`,
        )
      }),
    )
    const priorGuildRows = await Promise.all(
      candidates.map((member, index) => {
        const firstSeen = firstSeenRows[index]?.[0]
        if (!firstSeen?.captured_at) return []
        const firstSeenTime = new Date(firstSeen.captured_at).getTime()
        const previousLocalJoin = (localJoinHistoryByNickname.get(member.nickname) || [])
          .filter((event) => TRACKED_GUILD_NAMES.has(event.guildName) && new Date(event.observedAt).getTime() < firstSeenTime)
          .sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime())[0]
        if (previousLocalJoin) {
          return [{ captured_at: previousLocalJoin.observedAt, guild_name: previousLocalJoin.guildName }]
        }
        return selectRows(
          `member_snapshots?select=guild_name,captured_at&nickname=eq.${encodeURIComponent(member.nickname)}&captured_at=lt.${encodeURIComponent(firstSeen.captured_at)}&guild_name=neq.__local_wph__&guild_name=neq.${LOCAL_ROSTER_GUILD_NAME}&order=captured_at.desc&limit=20`,
        )
      }),
    )

    candidates.forEach((member, index) => {
      const firstSeen = firstSeenRows[index]?.[0]
      if (!firstSeen?.captured_at) return
      const previousGuild = priorGuildRows[index]?.find((row) => TRACKED_GUILD_NAMES.has(row.guild_name))
      joinedMembers.push({
        arrivalType: classifyGuildArrival(guild.guild_name, previousGuild?.guild_name || null),
        guildName: guild.guild_name,
        joinedAt: firstSeen.captured_at,
        nickname: member.nickname,
        previousGuildName: previousGuild?.guild_name || null,
        previousSeenAt: previousGuild?.captured_at || null,
        scoreAtJoin: Number(firstSeen.score) || 0,
        seasonKey: guild.season_key,
        source: firstSeen.source || 'server-snapshot',
      })
    })
  }

  return joinedMembers.sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime())
}

function getDepartedMembers(previousMembers, latestMembers, latestGuild) {
  const latestNicknames = new Set(latestMembers.map((member) => member.nickname).filter(Boolean))

  return previousMembers
    .filter((member) => member.nickname && !latestNicknames.has(member.nickname))
    .map((member) => ({
      departedAt: latestGuild.captured_at,
      guildName: member.guild_name,
      lastSeenAt: member.captured_at,
      nickname: member.nickname,
      score: member.score,
    }))
}

function dedupeDepartures(departures, currentNicknamesByGuild) {
  const byMember = new Map()

  departures.forEach((member) => {
    if (!member.nickname || currentNicknamesByGuild[member.guildName]?.has(member.nickname)) return
    const key = `${member.guildName}:${member.nickname}`
    const current = byMember.get(key)
    if (!current || new Date(member.departedAt).getTime() > new Date(current.departedAt).getTime()) {
      byMember.set(key, member)
    }
  })

  return [...byMember.values()].sort((a, b) => new Date(b.departedAt).getTime() - new Date(a.departedAt).getTime())
}

function normalizeArchive(archive) {
  return {
    ...(archive.archive_json || {}),
    id: archive.id,
    savedAt: archive.saved_at,
    saveType: archive.save_type,
    seasonEndAt: archive.season_end_at,
    seasonKey: archive.season_key,
    seasonStartAt: archive.season_start_at,
    totalFailedCount: archive.total_failed_count,
  }
}

function toTime(value) {
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function isFinalizedArchive(archive) {
  const archiveJson = archive.archive_json || {}
  const archiveTargetTime = toTime(archive.archive_target_at || archiveJson.archiveTargetAt)
  const savedTime = toTime(archive.saved_at || archiveJson.savedAt)
  const seasonEndTime = toTime(archive.season_end_at || archiveJson.seasonEndAt)
  if (archiveTargetTime === null || savedTime === null || seasonEndTime === null) return false

  return savedTime >= archiveTargetTime - ARCHIVE_TARGET_TOLERANCE_MS && savedTime <= seasonEndTime + ARCHIVE_TARGET_TOLERANCE_MS
}

async function getPreviousSeasonScores(archive) {
  if (!archive?.season_key) return []

  const archiveJson = archive.archive_json || {}
  const capturedAt = archiveJson.recoveredFromSnapshotAt || archiveJson.savedAt || archive.saved_at
  const capturedFilter = capturedAt ? `&captured_at=eq.${encodeURIComponent(capturedAt)}` : ''
  let members = await selectRows(
    `member_snapshots?select=guild_name,nickname,score,captured_at,season_key&season_key=eq.${encodeURIComponent(archive.season_key)}&guild_name=neq.__local_wph__&guild_name=neq.${LOCAL_ROSTER_GUILD_NAME}${capturedFilter}&limit=200`,
  )

  if (members.length === 0) {
    members = await selectRows(
      `member_snapshots?select=guild_name,nickname,score,captured_at,season_key&season_key=eq.${encodeURIComponent(archive.season_key)}&guild_name=neq.__local_wph__&guild_name=neq.${LOCAL_ROSTER_GUILD_NAME}&order=captured_at.desc&limit=200`,
    )
  }

  return members
    .filter((member) => member.nickname)
    .map((member) => ({
      capturedAt: member.captured_at,
      guildName: member.guild_name,
      nickname: member.nickname,
      score: Number(member.score) || 0,
      seasonKey: member.season_key,
    }))
}

export async function handler() {
  try {
    const guildRows = await selectRows('guild_snapshots?select=*&order=captured_at.desc&limit=160')
    const latestGuilds = latestByGuild(guildRows)
    const previousGuilds = previousByGuild(guildRows, latestGuilds)
    const snapshotsByGuild = groupSnapshotsByGuild(guildRows)
    const currentNicknamesByGuild = {}
    const latestMemberRows = []
    const departures = []

    for (const guild of latestGuilds) {
      const snapshots = (snapshotsByGuild[guild.guild_name] || []).slice(0, 12)
      const memberSnapshots = await Promise.all(
        snapshots.map((snapshot) =>
          selectRows(
            `member_snapshots?select=*&guild_name=eq.${encodeURIComponent(snapshot.guild_name)}&captured_at=eq.${encodeURIComponent(snapshot.captured_at)}&order=score.desc`,
          ),
        ),
      )

      const members = memberSnapshots[0] || []
      currentNicknamesByGuild[guild.guild_name] = new Set(members.map((member) => member.nickname).filter(Boolean))
      latestMemberRows.push(...members)

      const previousGuild = previousGuilds.find((row) => row.guild_name === guild.guild_name)
      if (previousGuild?.captured_at) {
        const previousMembers = memberSnapshots[snapshots.findIndex((snapshot) => snapshot.captured_at === previousGuild.captured_at)] || []
        departures.push(...getDepartedMembers(previousMembers, members, guild))
      }

      for (let index = 0; index < memberSnapshots.length - 1; index += 1) {
        departures.push(...getDepartedMembers(memberSnapshots[index + 1], memberSnapshots[index], snapshots[index]))
      }
    }

    const archiveRows = await selectRows('season_archives?select=*&order=saved_at.desc&limit=8')
    const archives = archiveRows.filter(isFinalizedArchive).slice(0, 3)
    const joinedMembers = await getJoinedMembers(latestGuilds, latestMemberRows)
    const previousSeasonScores = await getPreviousSeasonScores(archives[0])

    return json(200, {
      archives: archives.map(normalizeArchive),
      departures: dedupeDepartures(departures, currentNicknamesByGuild),
      guilds: latestGuilds,
      joinedMembers,
      members: latestMemberRows,
      previousSeasonScores,
    })
  } catch (error) {
    return json(500, { error: error.message || 'History fetch failed' })
  }
}
