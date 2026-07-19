import { selectRows } from './_shared/supabaseRest.js'

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

async function getPreviousSeasonScores(archive) {
  if (!archive?.season_key) return []

  const archiveJson = archive.archive_json || {}
  const capturedAt = archiveJson.recoveredFromSnapshotAt || archiveJson.savedAt || archive.saved_at
  const capturedFilter = capturedAt ? `&captured_at=eq.${encodeURIComponent(capturedAt)}` : ''
  let members = await selectRows(
    `member_snapshots?select=guild_name,nickname,score,captured_at,season_key&season_key=eq.${encodeURIComponent(archive.season_key)}${capturedFilter}&limit=200`,
  )

  if (members.length === 0) {
    members = await selectRows(
      `member_snapshots?select=guild_name,nickname,score,captured_at,season_key&season_key=eq.${encodeURIComponent(archive.season_key)}&order=captured_at.desc&limit=200`,
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

    const archives = await selectRows('season_archives?select=*&order=saved_at.desc&limit=3')
    const previousSeasonScores = await getPreviousSeasonScores(archives[0])

    return json(200, {
      archives: archives.map(normalizeArchive),
      departures: dedupeDepartures(departures, currentNicknamesByGuild),
      guilds: latestGuilds,
      members: latestMemberRows,
      previousSeasonScores,
    })
  } catch (error) {
    return json(500, { error: error.message || 'History fetch failed' })
  }
}
